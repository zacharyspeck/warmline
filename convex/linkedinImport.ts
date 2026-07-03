import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { unzipSync, strFromU8 } from "fflate";
import { parseConnections, type ConnRow } from "./linkedinCsv";
import { Id } from "./_generated/dataModel";
import { CRON_JUDGE_PER_RUN } from "./limits";

// Parse an uploaded LinkedIn data export (the ZIP from "Download larger data
// archive") and turn Connections.csv into the CALLER's `persons` rows — your
// 1st-degree connections, the largest pool of warm intros. Stable, well-known
// schema: First Name, Last Name, URL, Email Address, Company, Position, Connected On.
export const parseLinkedInExport = action({
  args: { storageId: v.id("_storage") },
  returns: v.object({ imported: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("Upload not found in storage");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(bytes);
    const key = Object.keys(files).find((k) => /connections\.csv$/i.test(k));
    if (!key) throw new Error("Connections.csv not found in the export ZIP");

    const rows = parseConnections(strFromU8(files[key]));
    let imported = 0;
    let skipped = 0;
    // Batch to stay well under Convex's per-call argument size limit.
    for (let i = 0; i < rows.length; i += 200) {
      const res = await ctx.runMutation(
        internal.linkedinImport.importConnections,
        { userId, rows: rows.slice(i, i + 200) },
      );
      imported += res.imported;
      skipped += res.skipped;
    }
    // The import is complete: kick the pipeline that turns it into a feed —
    // bridges + unlock values, then a rank pass — instead of waiting a day
    // for the cron. Scheduled so the upload response returns immediately.
    await ctx.scheduler.runAfter(0, internal.linkedinImport.afterImport, {
      userId,
    });
    return { imported, skipped };
  },
});

// Post-import pipeline: computeEdges, then a rank pass on the newest goal.
// Spend goes through the same Phase E reserves and per-run judge cap as the
// daily cron; each step is best-effort so a failure never strands the other.
export const afterImport = internalAction({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await ctx.runAction(internal.edges.computeEdges, {
        userId: args.userId,
      });
    } catch (err) {
      console.error(`afterImport: computeEdges failed for ${args.userId}`, err);
    }
    try {
      const icp = await ctx.runQuery(internal.icp.latestForUser, {
        userId: args.userId,
      });
      if (icp)
        await ctx.runAction(internal.rank.rebuild, {
          icpId: icp._id,
          maxJudge: CRON_JUDGE_PER_RUN,
          skipUnchanged: true,
        });
    } catch (err) {
      console.error(`afterImport: rank failed for ${args.userId}`, err);
    }
    return null;
  },
});

const connectionRow = v.object({
  name: v.string(),
  headline: v.optional(v.string()),
  company: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
});

// Insert connections as the owner's `persons`, deduped by LinkedIn URL within
// their graph. Internal — only the parse action calls it.
export const importConnections = internalMutation({
  args: { userId: v.id("users"), rows: v.array(connectionRow) },
  returns: v.object({ imported: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    let imported = 0;
    let skipped = 0;
    for (const row of args.rows) {
      if (!row.name) {
        skipped++;
        continue;
      }
      if (await isDuplicate(ctx, args.userId, row)) {
        skipped++;
        continue;
      }
      await ctx.db.insert("persons", {
        userId: args.userId,
        name: row.name,
        headline: row.headline,
        company: row.company,
        linkedinUrl: row.linkedinUrl,
        isSelf: false,
        role: "connector",
        relationshipToYou: "connected",
      });
      imported++;
    }
    return { imported, skipped };
  },
});

// Dedup an incoming connection against the owner's existing persons: by LinkedIn
// URL when present (precise), else by name within the same company (URL is
// missing on a minority of rows; without this, re-uploading would duplicate them).
async function isDuplicate(
  ctx: MutationCtx,
  userId: Id<"users">,
  row: ConnRow,
): Promise<boolean> {
  if (row.linkedinUrl) {
    const byUrl = await ctx.db
      .query("persons")
      .withIndex("by_user_and_linkedinUrl", (q) =>
        q.eq("userId", userId).eq("linkedinUrl", row.linkedinUrl),
      )
      .first();
    return byUrl !== null;
  }
  if (row.company) {
    // Iterate with early exit — a bounded take() would stop deduping once a
    // company's roster outgrows the bound.
    const sameCompany = ctx.db
      .query("persons")
      .withIndex("by_user_and_company", (q) =>
        q.eq("userId", userId).eq("company", row.company),
      );
    for await (const p of sameCompany) {
      if (p.name === row.name) return true;
    }
  }
  return false;
}
