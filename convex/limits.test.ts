/// <reference types="vite/client" />
// Phase E hard gate: cost caps. Budgets are reserved before any OpenAI call,
// caps degrade instead of throwing, absent config fails closed to zero, and
// the daily cron completes its cycle no matter how many users are capped.
// No real OpenAI calls anywhere: every test either stubs the key empty with
// a throw-and-count fetch (proving zero calls regardless of the runner's
// env) or stubs fetch with a fake response and counts the calls.
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import {
  GLOBAL_LIMITS,
  SCRAPE_PER_USER,
  TIER_LIMITS,
  dayKey,
} from "./limits";

const modules = import.meta.glob("./**/*.ts");

// Pin the clock mid-day UTC for every test in this file: usage.reserve
// recomputes dayKey(Date.now()) on its own, so a real-clock UTC-midnight
// rollover mid-test (5pm in Phoenix) would hand the run a fresh day of budget
// and flake the cap assertions. Only Date is faked — real timers keep
// convex-test's async machinery live.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// personVectors carries a 1536-dim vector index — build full-width sparse vectors.
const DIM = 1536;
function vec(hot: number): number[] {
  const a = new Array(DIM).fill(0);
  a[hot % DIM] = 1;
  return a;
}

// Mirrors rank.ts DEFAULT_JUDGE_TOP_N (private there, like rank.test's VOTE_NUDGE).
const JUDGE_TOP_N = 12;

type Tester = TestConvex<typeof schema>;

// A ranked-ready world: seeded network, icp vector set, every lead's person
// vector cached — so a rebuild needs zero embeds and the judge loop is the
// only thing that could spend.
async function seedWorld(t: Tester, email: string, vecOffset: number) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  await t.mutation(internal.devSeed.seedNetwork, { userId });
  const icpId = await t.run(async (ctx) => {
    const icp = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    await ctx.db.patch(icp!._id, { vector: vec(vecOffset) });
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let i = 1;
    for (const p of persons) {
      if (p.role === "lead") {
        await ctx.db.insert("personVectors", {
          personId: p._id,
          embedding: vec(vecOffset + i++),
        });
      }
    }
    return icp!._id;
  });
  return {
    userId,
    icpId,
    as: t.withIdentity({ subject: `${userId}|s1` }),
  };
}

async function recsFor(t: Tester, icpId: Id<"icp">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("recommendations")
      .withIndex("by_icp_and_score", (q) => q.eq("icpId", icpId))
      .collect(),
  );
}

test("reserve: call N+1 is rejected once N is spent, and batch grants are partial", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "cap@example.com" }),
  );

  // One-at-a-time up to the flat per-user scrape cap: N grants, call N+1 gets 0.
  for (let i = 0; i < SCRAPE_PER_USER; i++) {
    const { granted } = await t.mutation(internal.usage.reserve, {
      userId,
      category: "scrape",
      count: 1,
    });
    expect(granted).toBe(1);
  }
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "scrape",
      count: 1,
    }),
  ).toEqual({ granted: 0 });

  // Batch reservations grant PARTIALLY down to the cap, then zero.
  const judgeCap = TIER_LIMITS.free.judge;
  const first = await t.mutation(internal.usage.reserve, {
    userId,
    category: "judge",
    count: judgeCap - 5,
  });
  expect(first.granted).toBe(judgeCap - 5);
  const second = await t.mutation(internal.usage.reserve, {
    userId,
    category: "judge",
    count: 20,
  });
  expect(second.granted).toBe(5); // only what's left
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "judge",
      count: 1,
    }),
  ).toEqual({ granted: 0 });

  // Nonsense counts are fail-closed, not errors.
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "embed",
      count: 0,
    }),
  ).toEqual({ granted: 0 });
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "embed",
      count: -3,
    }),
  ).toEqual({ granted: 0 });
});

test("fail-closed: an unknown tier or a missing user means zero budget", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "vip@example.com", tier: "enterprise" }),
  );

  // "enterprise" is not in convex/limits.ts TIER_LIMITS: judge and embed
  // budgets are ZERO — absent config never means unlimited.
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "judge",
      count: 1,
    }),
  ).toEqual({ granted: 0 });
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "embed",
      count: 1,
    }),
  ).toEqual({ granted: 0 });

  // A deleted user reserves nothing either.
  await t.run(async (ctx) => ctx.db.delete(userId));
  expect(
    await t.mutation(internal.usage.reserve, {
      userId,
      category: "scrape",
      count: 1,
    }),
  ).toEqual({ granted: 0 });
});

test("a fully capped user's rebuild completes: degraded copy, kept cache, zero OpenAI calls", async () => {
  const t = convexTest(schema, modules);
  const A = await seedWorld(t, "alice@example.com", 0);

  // One lead loses its cached vector so the embed path is exercised too.
  const { strippedLeadId, leadCount } = await t.run(async (ctx) => {
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", A.userId))
      .collect();
    const leads = persons.filter((p) => p.role === "lead");
    const lead = leads[0];
    const pv = await ctx.db
      .query("personVectors")
      .withIndex("by_person", (q) => q.eq("personId", lead._id))
      .unique();
    await ctx.db.delete(pv!._id);
    return { strippedLeadId: lead._id, leadCount: leads.length };
  });

  // Exhaust A's ENTIRE daily judge + embed budget up front.
  await t.run(async (ctx) => {
    await ctx.db.insert("usage", {
      userId: A.userId,
      day: dayKey(Date.now()),
      judge: TIER_LIMITS.free.judge,
      embed: TIER_LIMITS.free.embed,
      scrape: 0,
    });
  });

  // The zero-calls proof is ENFORCED, not inherited from the host shell: the
  // key is stubbed empty (apiKey() throws on any attempt) and every fetch
  // throws loudly and is counted — a rebuild that reaches the network cannot
  // pass this test, whatever env the runner has exported.
  let networkCalls = 0;
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", async () => {
    networkCalls++;
    throw new Error("unexpected network call in a fully capped rebuild");
  });
  let res;
  try {
    res = await t.action(internal.rank.rebuild, { icpId: A.icpId });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(networkCalls).toBe(0);
  expect(res.judged).toBe(0);
  expect(res.judgeDegraded).toBe(JUDGE_TOP_N);
  expect(res.embedsSkipped).toBe(1); // the stripped lead kept a neutral fit
  // EVERY seeded lead was scored — the vectorless one was degraded to a
  // neutral goal-fit, not ejected from the pipeline.
  expect(res.scored).toBe(leadCount);

  // Every top row was still written — heuristic copy, marked for re-judge.
  const recs = await recsFor(t, A.icpId);
  expect(recs.length).toBe(JUDGE_TOP_N);
  for (const r of recs) {
    expect(r.judged).toBe(false);
    expect(r.whyBullets.length).toBeGreaterThan(0);
    expect(r.how.length).toBeGreaterThan(0);
    expect(r.opener).toBe("");
  }
  // The capped embed truly never ran: the stripped lead STILL has no cached
  // vector after the rebuild.
  const pvAfter = await t.run(async (ctx) =>
    ctx.db
      .query("personVectors")
      .withIndex("by_person", (q) => q.eq("personId", strippedLeadId))
      .unique(),
  );
  expect(pvAfter).toBeNull();

  // The feed renders the degraded rows like any others.
  const feed = await A.as.query(api.feed.list, { limit: 50 });
  expect(feed.length).toBeGreaterThan(0);
  expect(feed.some((row) => row.why.length > 0)).toBe(true);

  // And not one unit of budget moved past the caps.
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("usage")
      .withIndex("by_user_and_day", (q) =>
        q.eq("userId", A.userId).eq("day", dayKey(Date.now())),
      )
      .collect(),
  );
  expect(rows.length).toBe(1);
  expect(rows[0].judge).toBe(TIER_LIMITS.free.judge);
  expect(rows[0].embed).toBe(TIER_LIMITS.free.embed);
});

test("simulated cron cycle: the global judge cap halts spend across users and every user still completes", async () => {
  const t = convexTest(schema, modules);
  const A = await seedWorld(t, "alice@example.com", 0);
  const B = await seedWorld(t, "bob@example.com", 500);

  // The fleet already burned today's ENTIRE global judge budget.
  await t.run(async (ctx) => {
    await ctx.db.insert("usageGlobal", {
      day: dayKey(Date.now()),
      judge: GLOBAL_LIMITS.judge,
      embed: 0,
      scrape: 0,
    });
  });

  // Run the cron's real per-user entry point for both users. refreshOneUser
  // also probes avatar hosts (unavatar), so network is stubbed: avatar probes
  // get an instant 404, while any OpenAI call THROWS and is counted — recs
  // only land if the judge was never reached.
  let openaiCalls = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("api.openai.com")) {
      openaiCalls++;
      throw new Error("unexpected OpenAI call");
    }
    return new Response("not an image", { status: 404 });
  });
  try {
    await t.action(internal.crons.refreshOneUser, { userId: A.userId });
    await t.action(internal.crons.refreshOneUser, { userId: B.userId });
  } finally {
    vi.unstubAllGlobals();
  }
  expect(openaiCalls).toBe(0);

  // Both users finished the cycle on cached data with degraded copy.
  for (const world of [A, B]) {
    const recs = await recsFor(t, world.icpId);
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(r.judged).toBe(false);
    const feed = await world.as.query(api.feed.list, { limit: 50 });
    expect(feed.length).toBeGreaterThan(0);
  }

  // The global counter never moved past its cap, and neither user spent a
  // single judge slot.
  const day = dayKey(Date.now());
  const g = await t.run(async (ctx) =>
    ctx.db
      .query("usageGlobal")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique(),
  );
  expect(g!.judge).toBe(GLOBAL_LIMITS.judge);
  const perUser = await t.run(async (ctx) =>
    ctx.db
      .query("usage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect(),
  );
  for (const row of perUser) expect(row.judge).toBe(0);

  // ...and the cycle's summary line still logs cleanly.
  await t.mutation(internal.usage.logDailySummary, {});
});

test("cron judge rules: per-run cap, only new or changed rows, capped rows re-judged when budget returns", async () => {
  const t = convexTest(schema, modules);
  const A = await seedWorld(t, "alice@example.com", 0);

  // Stub the judge (chat completions) and count calls. Vectors are all
  // cached, so fetch here can ONLY be the judge.
  let judgeCalls = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    judgeCalls++;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                why: [{ text: "Fits your ICP", confidence: "high" }],
                how: ["Ask a mutual connection for a warm intro"],
                opener: "Saw your recent work",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  try {
    // Run 1, cron-style with a per-run cap of 5: exactly 5 judge calls, the
    // other 7 top rows written degraded.
    const run1 = await t.action(internal.rank.rebuild, {
      icpId: A.icpId,
      maxJudge: 5,
      skipUnchanged: true,
    });
    expect(run1.judged).toBe(5);
    expect(run1.judgeDegraded).toBe(JUDGE_TOP_N - 5);
    expect(judgeCalls).toBe(5);

    // Run 2, same args, nothing changed: the 5 judged rows SKIP (unchanged
    // score), and the budgeted slots go to the still-degraded rows instead.
    const run2 = await t.action(internal.rank.rebuild, {
      icpId: A.icpId,
      maxJudge: 5,
      skipUnchanged: true,
    });
    expect(run2.judged).toBe(5);
    expect(run2.judgeDegraded).toBe(JUDGE_TOP_N - 10);
    expect(judgeCalls).toBe(10);

    // Total spend recorded: 10 judge slots, nothing else.
    const day = dayKey(Date.now());
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("usage")
        .withIndex("by_user_and_day", (q) =>
          q.eq("userId", A.userId).eq("day", day),
        )
        .unique(),
    );
    expect(row!.judge).toBe(10);
    expect(row!.embed).toBe(0);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
