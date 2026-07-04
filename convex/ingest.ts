import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./authz";

// Ingest for the CALLER's own graph. Every mutation requires a signed-in user
// and stamps their userId on each row, so unauthenticated or cross-user bulk
// writes are impossible. (scripts/seed.mjs predates auth and can no longer call
// these — the in-app LinkedIn upload is the real ingest path.)

async function findPerson(
  ctx: MutationCtx,
  userId: Id<"users">,
  linkedinUrl?: string,
  xHandle?: string,
): Promise<Doc<"persons"> | null> {
  if (linkedinUrl) {
    const p = await ctx.db
      .query("persons")
      .withIndex("by_user_and_linkedinUrl", (q) =>
        q.eq("userId", userId).eq("linkedinUrl", linkedinUrl),
      )
      .first();
    if (p) return p;
  }
  if (xHandle) {
    const p = await ctx.db
      .query("persons")
      .withIndex("by_user_and_xHandle", (q) =>
        q.eq("userId", userId).eq("xHandle", xHandle),
      )
      .first();
    if (p) return p;
  }
  return null;
}

// Dedup a target with no slug against the caller's existing persons by name
// within the same company (case-insensitive). Mirrors linkedinImport's
// company-scan dedup: iterate with an early exit so it stays correct even
// when a company's roster outgrows any bounded take().
async function findByNameCompany(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: string,
  company: string,
): Promise<Doc<"persons"> | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const sameCompany = ctx.db
    .query("persons")
    .withIndex("by_user_and_company", (q) =>
      q.eq("userId", userId).eq("company", company),
    );
  for await (const p of sameCompany) {
    if (p.name.trim().toLowerCase() === target) return p;
  }
  return null;
}

// Fill only fields that are currently empty; never clobber existing data.
function fillMissing(
  existing: Doc<"persons">,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(incoming)) {
    if (val === undefined) continue;
    if ((existing as Record<string, unknown>)[k] === undefined) patch[k] = val;
  }
  return patch;
}

export const ingestSelf = mutation({
  args: {
    name: v.string(),
    linkedinUrl: v.optional(v.string()),
    xHandle: v.optional(v.string()),
  },
  returns: v.id("persons"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await findPerson(
      ctx,
      userId,
      args.linkedinUrl,
      args.xHandle,
    );
    if (existing) {
      await ctx.db.patch(existing._id, { isSelf: true });
      return existing._id;
    }
    return await ctx.db.insert("persons", {
      userId,
      name: args.name,
      linkedinUrl: args.linkedinUrl,
      xHandle: args.xHandle,
      isSelf: true,
      role: "connector",
      relationshipToYou: "connected",
    });
  },
});

const connectionRow = v.object({
  name: v.string(),
  headline: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  xHandle: v.optional(v.string()),
  tieStrength: v.optional(v.number()),
});

// Your real 1st-degree connections → role connector, relationshipToYou connected.
export const ingestConnections = mutation({
  args: { rows: v.array(connectionRow) },
  returns: v.object({ inserted: v.number(), patched: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    let inserted = 0;
    let patched = 0;
    for (const row of args.rows) {
      const existing = await findPerson(
        ctx,
        userId,
        row.linkedinUrl,
        row.xHandle,
      );
      if (existing) {
        const patch = fillMissing(existing, {
          headline: row.headline,
          company: row.company,
          xHandle: row.xHandle,
        });
        if (row.tieStrength !== undefined) patch.tieStrength = row.tieStrength;
        // These rows come from your real connections export → by definition connected.
        if (existing.relationshipToYou !== "connected")
          patch.relationshipToYou = "connected";
        if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch);
        patched++;
      } else {
        await ctx.db.insert("persons", {
          userId,
          name: row.name,
          headline: row.headline,
          company: row.company,
          linkedinUrl: row.linkedinUrl,
          xHandle: row.xHandle,
          tieStrength: row.tieStrength,
          isSelf: false,
          role: "connector",
          relationshipToYou: "connected",
        });
        inserted++;
      }
    }
    return { inserted, patched };
  },
});

const leadRow = v.object({
  name: v.string(),
  linkedinUrl: v.optional(v.string()),
  xHandle: v.optional(v.string()),
  eventName: v.optional(v.string()),
  eventDate: v.optional(v.number()),
  confidence: v.optional(v.number()),
});

async function upsertEvent(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: string,
  date?: number,
): Promise<Id<"events">> {
  const existing = await ctx.db
    .query("events")
    .withIndex("by_user_and_name", (q) =>
      q.eq("userId", userId).eq("name", name),
    )
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("events", { userId, name, date });
}

// Config Leads rows → role lead. If already a connection, keep connected + promote to lead.
export const ingestLeads = mutation({
  args: { rows: v.array(leadRow) },
  returns: v.object({ leads: v.number(), attendances: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    let leads = 0;
    let attendances = 0;
    for (const row of args.rows) {
      const existing = await findPerson(
        ctx,
        userId,
        row.linkedinUrl,
        row.xHandle,
      );
      let personId: Id<"persons">;
      if (existing) {
        // A lead you already know (the verified overlaps). Promote to lead, keep connected.
        await ctx.db.patch(existing._id, { role: "lead" });
        personId = existing._id;
      } else {
        personId = await ctx.db.insert("persons", {
          userId,
          name: row.name,
          linkedinUrl: row.linkedinUrl,
          xHandle: row.xHandle,
          isSelf: false,
          role: "lead",
          relationshipToYou: "not_connected",
        });
      }
      leads++;

      if (row.eventName) {
        const eventId = await upsertEvent(
          ctx,
          userId,
          row.eventName,
          row.eventDate,
        );
        const already = await ctx.db
          .query("attendance")
          .withIndex("by_person_and_event", (q) =>
            q.eq("personId", personId).eq("eventId", eventId),
          )
          .first();
        if (!already) {
          await ctx.db.insert("attendance", {
            userId,
            personId,
            eventId,
            confidence: row.confidence ?? 1,
          });
          attendances++;
        }
      }
    }
    return { leads, attendances };
  },
});

const targetRow = v.object({
  name: v.string(),
  company: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
});

// Add specific target people from the Goals surface / feed empty area, one at
// a time or as a pasted list. Reuses ingestLeads' overlap logic: a target
// already in the network (matched by LinkedIn slug OR by name + company) is
// PROMOTED to a lead in place, never duplicated; a brand-new target is
// inserted as a not-connected lead. Then schedules the same post-import
// pipeline (computeEdges + a rank pass under the existing reserves) so
// shared-company connectors become bridges and warm paths appear.
export const addTargets = mutation({
  args: { rows: v.array(targetRow) },
  returns: v.object({ added: v.number(), promoted: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    let added = 0;
    let promoted = 0;
    let changed = false;
    for (const row of args.rows) {
      const name = row.name.trim();
      if (!name) continue;
      const company = row.company?.trim() || undefined;
      // Dedup by slug first (precise), then by name + company.
      let existing = await findPerson(ctx, userId, row.linkedinUrl);
      if (!existing && company) {
        existing = await findByNameCompany(ctx, userId, name, company);
      }
      if (existing) {
        const patch = fillMissing(existing, {
          company,
          linkedinUrl: row.linkedinUrl,
        });
        if (existing.role !== "lead") patch.role = "lead";
        if (Object.keys(patch).length) {
          await ctx.db.patch(existing._id, patch);
          changed = true;
        }
        promoted++;
      } else {
        await ctx.db.insert("persons", {
          userId,
          name,
          company,
          linkedinUrl: row.linkedinUrl,
          isSelf: false,
          role: "lead",
          relationshipToYou: "not_connected",
        });
        added++;
        changed = true;
      }
    }
    // Recompute bridges + re-rank so the new leads get warm paths, exactly as
    // a LinkedIn import does. Scheduled so the mutation returns immediately.
    if (changed) {
      await ctx.scheduler.runAfter(0, internal.linkedinImport.afterImport, {
        userId,
      });
    }
    return { added, promoted };
  },
});

// Dev reset — delete one bounded batch of the CALLER's rows across the Warmline
// tables; call in a loop until it returns 0. Feedback rows carry no userId, so
// they are reached through the caller's icps and cleared before persons go.
export const clearBatch = mutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    let deleted = 0;
    const icps = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    for (const icp of icps) {
      const votes = await ctx.db
        .query("feedback")
        .withIndex("by_icp", (q) => q.eq("icpId", icp._id))
        .take(300);
      for (const f of votes) {
        await ctx.db.delete(f._id);
        deleted++;
      }
    }
    const tables = [
      "recommendations",
      "attendance",
      "edges",
      "events",
    ] as const;
    for (const table of tables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(300);
      for (const r of rows) {
        await ctx.db.delete(r._id);
        deleted++;
      }
    }
    // Persons carry the rows that have no userId of their own: each person's
    // cached vector and any feedback pointing at it are drained BEFORE the
    // person goes, so a cleared batch never strands rows that delete-my-data
    // could no longer reach.
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    for (const p of persons) {
      const vectors = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .collect();
      for (const pv of vectors) {
        await ctx.db.delete(pv._id);
        deleted++;
      }
      for (;;) {
        const votes = await ctx.db
          .query("feedback")
          .withIndex("by_person", (q) => q.eq("personId", p._id))
          .take(100);
        if (!votes.length) break;
        for (const f of votes) {
          await ctx.db.delete(f._id);
          deleted++;
        }
        if (votes.length < 100) break;
      }
      await ctx.db.delete(p._id);
      deleted++;
    }
    return { deleted };
  },
});
