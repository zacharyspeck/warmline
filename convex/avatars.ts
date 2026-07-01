import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Resolve a profile-pic URL. When a Fiber key is present, try Fiber KitchenSink
// (LinkedIn) first; otherwise fall back to unavatar by X handle, then unavatar by
// LinkedIn slug. Returns the first that yields an image, else undefined (the UI
// then shows initials). A missing FIBER_API_KEY never throws — it just skips Fiber.
async function resolvePic(
  apiKey: string | undefined,
  slug?: string,
  xHandle?: string,
): Promise<string | undefined> {
  if (apiKey && slug) {
    try {
      const res = await fetch("https://api.fiber.ai/v1/kitchen-sink/person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          profileIdentifier: { identifier: "linkedinSlug", value: slug },
        }),
      });
      if (res.ok) {
        const pic = findProfilePic(await res.json());
        if (pic) return pic;
      }
    } catch {
      /* fall through to unavatar */
    }
  }
  const probe = async (u: string): Promise<string | undefined> => {
    try {
      const r = await fetch(u);
      if (r.ok && r.headers.get("content-type")?.startsWith("image")) return u;
    } catch {
      /* ignore */
    }
    return undefined;
  };
  if (xHandle) {
    const u = await probe(
      `https://unavatar.io/twitter/${xHandle.replace(/^@/, "")}?fallback=false`,
    );
    if (u) return u;
  }
  if (slug) {
    return probe(`https://unavatar.io/linkedin/${slug}?fallback=false`);
  }
  return undefined;
}

// Profile-picture enrichment. For the top people (by tie strength) that have a
// LinkedIn slug or X handle but no avatar yet, resolve their picture (Fiber when
// keyed, else unavatar), download it, and cache it ONCE in Convex storage
// (LinkedIn blocks hotlinking, so store the bytes, not the URL).

function findProfilePic(obj: unknown, depth = 0): string | undefined {
  if (depth > 8 || obj === null || typeof obj !== "object") return undefined;
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    if (
      (k === "profile_pic" || k === "profilePic" || k === "profilePicture") &&
      typeof val === "string" &&
      val.startsWith("http")
    )
      return val;
    if (typeof val === "object") {
      const found = findProfilePic(val, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export const needingAvatars = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  returns: v.array(
    v.object({
      id: v.id("persons"),
      slug: v.optional(v.string()),
      xHandle: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const leads = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", args.userId).eq("role", "lead"),
      )
      .take(400);
    const connectors = await ctx.db
      .query("persons")
      .withIndex("by_user_and_role", (q) =>
        q.eq("userId", args.userId).eq("role", "connector"),
      )
      .take(400);
    // Include self; anyone with a LinkedIn slug OR an X handle can be resolved.
    return [...leads, ...connectors]
      .filter((p) => !p.avatarUrl && (!!p.linkedinUrl || !!p.xHandle))
      .sort((a, b) => (b.tieStrength ?? 0) - (a.tieStrength ?? 0))
      .slice(0, args.limit)
      .map((p) => ({ id: p._id, slug: p.linkedinUrl, xHandle: p.xHandle }));
  },
});

export const setAvatar = internalMutation({
  args: {
    personId: v.id("persons"),
    userId: v.id("users"),
    url: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.personId);
    if (!p || p.userId !== args.userId) throw new Error("Person not found");
    await ctx.db.patch(args.personId, { avatarUrl: args.url });
    return null;
  },
});

// Helper: resolve + download + cache a person's avatar. Returns true on success.
async function storeAvatar(
  ctx: ActionCtx,
  apiKey: string | undefined,
  userId: Id<"users">,
  personId: Id<"persons">,
  slug?: string,
  xHandle?: string,
): Promise<boolean> {
  try {
    const picUrl = await resolvePic(apiKey, slug, xHandle);
    if (!picUrl) return false;
    const img = await fetch(picUrl);
    if (!img.ok) return false;
    const storageId = await ctx.storage.store(await img.blob());
    const url = await ctx.storage.getUrl(storageId);
    if (!url) return false;
    await ctx.runMutation(internal.avatars.setAvatar, {
      personId,
      userId,
      url,
    });
    return true;
  } catch {
    return false;
  }
}

// Enrich one user's top people by tie strength. Runs per user on the daily cron
// and by hand via `npx convex run avatars:enrichTop`. Uses Fiber when
// FIBER_API_KEY is set, else unavatar; a missing key degrades instead of throwing.
export const enrichTop = internalAction({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  returns: v.object({
    done: v.number(),
    failed: v.number(),
    keyed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const apiKey = process.env.FIBER_API_KEY;
    const targets: {
      id: Id<"persons">;
      slug?: string;
      xHandle?: string;
    }[] = await ctx.runQuery(internal.avatars.needingAvatars, {
      userId: args.userId,
      limit: args.limit ?? 40,
    });
    let done = 0;
    let failed = 0;
    for (const t of targets) {
      if (await storeAvatar(ctx, apiKey, args.userId, t.id, t.slug, t.xHandle))
        done++;
      else failed++;
    }
    return { done, failed, keyed: !!apiKey };
  },
});

// Enrich exactly the people currently in one user's feed (targets the visible
// rows, not top-by-tie). Run via `npx convex run avatars:enrichFeed`.
export const enrichFeed = internalAction({
  args: { userId: v.id("users") },
  returns: v.object({
    done: v.number(),
    failed: v.number(),
    keyed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const apiKey = process.env.FIBER_API_KEY;
    const rows = await ctx.runQuery(internal.feed.listForUser, {
      userId: args.userId,
      limit: 40,
    });
    let done = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.avatarUrl) continue;
      if (
        await storeAvatar(
          ctx,
          apiKey,
          args.userId,
          r.id,
          r.linkedinUrl,
          r.xHandle,
        )
      )
        done++;
      else failed++;
    }
    return { done, failed, keyed: !!apiKey };
  },
});
