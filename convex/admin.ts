import { internalAction, internalQuery } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { embed } from "./openai";

// One-time admin embed backfill for a NAMED user. Fully embeds every person in
// that user's graph under an explicitly raised per-invocation ceiling — far
// above the everyday RANK_EMBEDS_PER_RUN, which is deliberately left untouched
// so normal ranking budgets are unchanged. Internal only: invoked by the owner
// from the CLI (`npx convex run admin:embedBackfill '{"email":"..."}'`).
//
// Two-phase by design: the first call (no `confirm`) reports the person count
// and the estimated OpenAI cost and embeds NOTHING; only a second call with
// `confirm: true` actually spends. This backfill bypasses the daily embed
// reserve on purpose (that's the "raised ceiling") and does NOT record against
// the user's daily metering, so it never starves their normal ranking.

// text-embedding-3-small: $0.02 per 1M tokens (verified against OpenAI pricing,
// July 2026). Tokens are estimated at ~4 characters/token, the standard rule of
// thumb, summed over each person's short "name — headline — company" text.
const EMBED_PRICE_PER_1M_USD = 0.02;
const CHARS_PER_TOKEN = 4;

// Raised per-invocation ceiling. High enough to cover a personal account in one
// run while staying well inside an action's 10-minute limit. Override with the
// `ceiling` arg if a truly large account needs a different bound.
const BACKFILL_CEILING = 5000;

function personText(p: {
  name: string;
  headline: string | null;
  company: string | null;
}): string {
  return [p.name, p.headline, p.company].filter(Boolean).join(" — ");
}

export const userByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    return user?._id ?? null;
  },
});

// One page of a user's persons, each flagged with whether it already has a
// cached vector. Drives both the estimate (count the missing) and the run.
export const personsPage = internalQuery({
  args: { userId: v.id("users"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.id("persons"),
        name: v.string(),
        headline: v.union(v.string(), v.null()),
        company: v.union(v.string(), v.null()),
        hasVector: v.boolean(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .paginate(args.paginationOpts);
    const items = [];
    for (const p of page.page) {
      const vec = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .first();
      items.push({
        id: p._id,
        name: p.name,
        headline: p.headline ?? null,
        company: p.company ?? null,
        hasVector: Boolean(vec),
      });
    }
    return {
      page: items,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const embedBackfill = internalAction({
  args: {
    email: v.string(),
    confirm: v.optional(v.boolean()),
    ceiling: v.optional(v.number()),
  },
  returns: v.object({
    user: v.string(),
    totalPersons: v.number(),
    alreadyEmbedded: v.number(),
    toEmbed: v.number(),
    estTokens: v.number(),
    estCostUsd: v.number(),
    ceiling: v.number(),
    ran: v.boolean(),
    embedded: v.number(),
    failed: v.number(),
    remaining: v.number(),
    note: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.admin.userByEmail, {
      email: args.email,
    });
    if (userId === null) throw new Error(`No user with email ${args.email}`);

    // Scan every person, collecting those without a cached vector.
    const missing: {
      id: Id<"persons">;
      name: string;
      headline: string | null;
      company: string | null;
    }[] = [];
    let totalPersons = 0;
    let estTokens = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: {
        page: {
          id: Id<"persons">;
          name: string;
          headline: string | null;
          company: string | null;
          hasVector: boolean;
        }[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.admin.personsPage, {
        userId,
        paginationOpts: { numItems: 200, cursor },
      });
      totalPersons += page.page.length;
      for (const p of page.page) {
        if (p.hasVector) continue;
        missing.push({ id: p.id, name: p.name, headline: p.headline, company: p.company });
        estTokens += Math.ceil(personText(p).length / CHARS_PER_TOKEN);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    const toEmbed = missing.length;
    const alreadyEmbedded = totalPersons - toEmbed;
    // Embeddings are cheap; keep 8 decimals so a small-but-real estimate never
    // rounds to a misleading $0.00.
    const estCostUsd =
      Math.round((estTokens / 1_000_000) * EMBED_PRICE_PER_1M_USD * 1e8) / 1e8;
    const ceiling = Math.max(0, Math.floor(args.ceiling ?? BACKFILL_CEILING));

    const base = {
      user: args.email,
      totalPersons,
      alreadyEmbedded,
      toEmbed,
      estTokens,
      estCostUsd,
      ceiling,
    };

    // Phase 1: estimate only. Nothing is embedded until the owner approves.
    if (!args.confirm) {
      return {
        ...base,
        ran: false,
        embedded: 0,
        failed: 0,
        remaining: toEmbed,
        note:
          toEmbed === 0
            ? "Every person already has a vector; nothing to backfill"
            : `Estimate only — re-run with confirm: true to embed ${Math.min(
                toEmbed,
                ceiling,
              )} people (~$${estCostUsd.toFixed(6)})`,
      };
    }

    // Phase 2: embed up to the ceiling. A single flaky embed is skipped, never
    // aborts the run; whatever succeeds is cached.
    let embedded = 0;
    let failed = 0;
    for (const m of missing.slice(0, ceiling)) {
      try {
        const vec = await embed(personText(m));
        await ctx.runMutation(internal.rank.upsertVector, {
          personId: m.id,
          embedding: vec,
        });
        embedded++;
      } catch (err) {
        console.error(`embedBackfill: embed failed for ${m.id}`, err);
        failed++;
      }
    }
    const remaining = toEmbed - embedded;
    return {
      ...base,
      ran: true,
      embedded,
      failed,
      remaining,
      note:
        remaining > 0
          ? `Embedded ${embedded}; ${remaining} still missing (raise ceiling or re-run)`
          : `Embedded ${embedded}; every person now has a vector`,
    };
  },
});
