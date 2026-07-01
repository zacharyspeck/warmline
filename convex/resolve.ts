import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";

// Entity resolution. Merge rule (strict → loose):
//   1. exact linkedin slug  2. exact x handle  3. exact email
//   4. X-only row → Fiber twitterHandleToLinkedinUrl → slug → rule 1
//   5. name + same company (fuzzy) — NOT done here (false-merge risk).

function linkedinSlug(url?: string | null): string | undefined {
  if (!url) return undefined;
  const m = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

async function drainEdgesFrom(
  ctx: MutationCtx,
  dropId: Id<"persons">,
  keepId: Id<"persons">,
): Promise<number> {
  let n = 0;
  for (;;) {
    const b = await ctx.db
      .query("edges")
      .withIndex("by_from", (q) => q.eq("from", dropId))
      .take(200);
    if (!b.length) break;
    for (const r of b) {
      await ctx.db.patch(r._id, { from: keepId });
      n++;
    }
    if (b.length < 200) break;
  }
  return n;
}

async function drainEdgesTo(
  ctx: MutationCtx,
  dropId: Id<"persons">,
  keepId: Id<"persons">,
): Promise<number> {
  let n = 0;
  for (;;) {
    const b = await ctx.db
      .query("edges")
      .withIndex("by_to", (q) => q.eq("to", dropId))
      .take(200);
    if (!b.length) break;
    for (const r of b) {
      await ctx.db.patch(r._id, { to: keepId });
      n++;
    }
    if (b.length < 200) break;
  }
  return n;
}

async function drainPersonRef(
  ctx: MutationCtx,
  table: "attendance" | "recommendations",
  dropId: Id<"persons">,
  keepId: Id<"persons">,
): Promise<number> {
  let n = 0;
  for (;;) {
    const b =
      table === "attendance"
        ? await ctx.db
            .query("attendance")
            .withIndex("by_person", (q) => q.eq("personId", dropId))
            .take(200)
        : await ctx.db
            .query("recommendations")
            .withIndex("by_person", (q) => q.eq("personId", dropId))
            .take(200);
    if (!b.length) break;
    for (const r of b) {
      await ctx.db.patch(r._id, { personId: keepId });
      n++;
    }
    if (b.length < 200) break;
  }
  return n;
}

// Merge `drop` into `keep`: move all references, fill missing fields, delete drop.
async function mergeImpl(
  ctx: MutationCtx,
  keepId: Id<"persons">,
  dropId: Id<"persons">,
) {
  if (keepId === dropId) return { edges: 0, attendance: 0, recommendations: 0 };
  const keep = await ctx.db.get(keepId);
  const drop = await ctx.db.get(dropId);
  if (!keep || !drop) throw new Error("merge: person not found");
  // Two different users' rows must never fold into one graph.
  if (keep.userId !== drop.userId)
    throw new Error("merge: cross-user merge denied");

  const edges =
    (await drainEdgesFrom(ctx, dropId, keepId)) +
    (await drainEdgesTo(ctx, dropId, keepId));
  const attendance = await drainPersonRef(ctx, "attendance", dropId, keepId);
  const recommendations = await drainPersonRef(
    ctx,
    "recommendations",
    dropId,
    keepId,
  );

  // Fill fields the kept record is missing; a lead role wins over connector.
  const patch: Partial<Doc<"persons">> = {};
  for (const k of [
    "headline",
    "company",
    "linkedinUrl",
    "xHandle",
    "avatarUrl",
    "tieStrength",
    "unlockValue",
  ] as const) {
    if (keep[k] === undefined && drop[k] !== undefined)
      (patch as Record<string, unknown>)[k] = drop[k];
  }
  if (drop.role === "lead" && keep.role !== "lead") patch.role = "lead";
  if (drop.isSelf) patch.isSelf = true;
  if (Object.keys(patch).length) await ctx.db.patch(keepId, patch);

  await ctx.db.delete(dropId);
  return { edges, attendance, recommendations };
}

export const mergePersons = internalMutation({
  args: { keepId: v.id("persons"), dropId: v.id("persons") },
  returns: v.object({
    edges: v.number(),
    attendance: v.number(),
    recommendations: v.number(),
  }),
  handler: (ctx, args) => mergeImpl(ctx, args.keepId, args.dropId),
});

// Given a resolved (handle → slug) pair: set the slug on the OWNER's
// handle-person, and merge into their existing slug-person if one exists (keep
// the canonical slug one). Never looks outside the owner's graph.
export const setLinkedinAndMaybeMerge = internalMutation({
  args: { userId: v.id("users"), handle: v.string(), slug: v.string() },
  returns: v.object({
    action: v.union(
      v.literal("merged"),
      v.literal("patched"),
      v.literal("noop"),
    ),
  }),
  handler: async (ctx, args) => {
    const handlePerson = await ctx.db
      .query("persons")
      .withIndex("by_user_and_xHandle", (q) =>
        q.eq("userId", args.userId).eq("xHandle", args.handle),
      )
      .first();
    if (!handlePerson) return { action: "noop" as const };

    const slugPerson = await ctx.db
      .query("persons")
      .withIndex("by_user_and_linkedinUrl", (q) =>
        q.eq("userId", args.userId).eq("linkedinUrl", args.slug),
      )
      .first();

    if (slugPerson && slugPerson._id !== handlePerson._id) {
      await mergeImpl(ctx, slugPerson._id, handlePerson._id);
      return { action: "merged" as const };
    }
    await ctx.db.patch(handlePerson._id, { linkedinUrl: args.slug });
    return { action: "patched" as const };
  },
});

// Fiber X→LinkedIn bridge for ONE user's graph. Pass the X-only handles to
// resolve (e.g. the hero set). Needs FIBER_API_KEY in the Convex deployment env.
// Internal (dev tool): run via
//   npx convex run resolve:resolveXHandles '{"userId":"...","handles":[...]}'
export const resolveXHandles = internalAction({
  args: { userId: v.id("users"), handles: v.array(v.string()) },
  returns: v.object({
    merged: v.number(),
    patched: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    const apiKey = process.env.FIBER_API_KEY;
    if (!apiKey) throw new Error("FIBER_API_KEY not set on the Convex deploy");
    let merged = 0,
      patched = 0,
      failed = 0;
    for (const handle of args.handles) {
      try {
        const res = await fetch(
          "https://api.fiber.ai/v1/twitter-handle-to-linkedin/single",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, handle }),
          },
        );
        const data = (await res.json()) as {
          output?: { linkedInUrl?: string | null };
          linkedInUrl?: string | null;
        };
        const slug = linkedinSlug(
          data.output?.linkedInUrl ?? data.linkedInUrl ?? undefined,
        );
        if (!slug) {
          failed++;
          continue;
        }
        const r = await ctx.runMutation(
          internal.resolve.setLinkedinAndMaybeMerge,
          { userId: args.userId, handle, slug },
        );
        if (r.action === "merged") merged++;
        else if (r.action === "patched") patched++;
      } catch {
        failed++;
      }
    }
    return { merged, patched, failed };
  },
});
