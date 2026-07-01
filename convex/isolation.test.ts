/// <reference types="vite/client" />
// Phase C hard gate: two users, each with a full seeded network, both ranked —
// and NO query or action lets one read or write the other's persons, edges,
// recommendations, feed, or feedback, including direct cross-user id lookups.
import { convexTest, type TestConvex } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { DEMO_EMAIL } from "./devSeed";

const modules = import.meta.glob("./**/*.ts");

// personVectors carries a 1536-dim vector index — build full-width sparse vectors.
const DIM = 1536;
function vec(hot: number): number[] {
  const a = new Array(DIM).fill(0);
  a[hot % DIM] = 1;
  return a;
}

type Tester = TestConvex<typeof schema>;

type World = {
  userId: Id<"users">;
  as: ReturnType<Tester["withIdentity"]>;
  icpId: Id<"icp">;
  personIds: Set<Id<"persons">>;
  leadIds: Id<"persons">[];
  connectorIds: Id<"persons">[];
};

// One user's world: the real seeded network (leads, connectors, bridge edges,
// an icp), plus cached vectors so the REAL ranking pipeline runs with zero
// OpenAI calls (judgeTopN: 0 skips the LLM judge; everything else is live).
async function buildWorld(
  t: Tester,
  email: string,
  vecOffset: number,
): Promise<World> {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  await t.mutation(internal.devSeed.seedNetwork, { userId });
  const seeded = await t.run(async (ctx) => {
    const icp = await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    await ctx.db.patch(icp!._id, { vector: vec(vecOffset) });
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const leadIds: Id<"persons">[] = [];
    const connectorIds: Id<"persons">[] = [];
    let i = 1;
    for (const p of persons) {
      if (p.role === "lead") {
        leadIds.push(p._id);
        await ctx.db.insert("personVectors", {
          personId: p._id,
          embedding: vec(vecOffset + i++),
        });
      } else if (!p.isSelf) {
        connectorIds.push(p._id);
      }
    }
    // t.run results must be Convex values — return the ids as arrays.
    return {
      icpId: icp!._id,
      allPersonIds: persons.map((p) => p._id),
      leadIds,
      connectorIds,
    };
  });
  return {
    userId,
    as: t.withIdentity({ subject: `${userId}|s1` }),
    icpId: seeded.icpId,
    personIds: new Set(seeded.allPersonIds),
    leadIds: seeded.leadIds,
    connectorIds: seeded.connectorIds,
  };
}

// The judge loop's write, minus the LLM call — this IS internal.rank's
// recommendation write path.
async function writeTopRecommendation(
  t: Tester,
  icpId: Id<"icp">,
  personId: Id<"persons">,
  score: number,
) {
  await t.mutation(internal.rank.writeRecommendation, {
    icpId,
    personId,
    score,
    whyBullets: [{ text: "Strong fit", confidence: 0.9 }],
    how: ["Ask a mutual for a warm intro"],
    opener: "Hi",
    unlocksIds: [],
  });
}

test("two seeded users: edges + ranking run for both, and every surface stays inside the owner's graph", async () => {
  const t = convexTest(schema, modules);
  const A = await buildWorld(t, "alice@example.com", 0);
  const B = await buildWorld(t, "bob@example.com", 500);

  // ── the daily pipeline runs for BOTH users ──
  // Both networks use the same company names, so any cross-user leak in the
  // edge builder would bridge A's connectors to B's leads here.
  await t.action(internal.edges.computeEdges, { userId: A.userId });
  await t.action(internal.edges.computeEdges, { userId: B.userId });
  const ra = await t.action(internal.rank.rebuild, {
    icpId: A.icpId,
    judgeTopN: 0,
  });
  const rb = await t.action(internal.rank.rebuild, {
    icpId: B.icpId,
    judgeTopN: 0,
  });
  // Each rank scored exactly the owner's leads — none of the other user's.
  expect(ra.scored).toBe(A.leadIds.length);
  expect(rb.scored).toBe(B.leadIds.length);

  // ── every edge stays within one owner's graph ──
  const edges = await t.run(async (ctx) => ctx.db.query("edges").collect());
  expect(edges.length).toBeGreaterThan(0);
  for (const e of edges) {
    const owner = A.personIds.has(e.from) ? A : B;
    expect(owner.personIds.has(e.from)).toBe(true);
    expect(owner.personIds.has(e.to)).toBe(true);
    expect(e.userId).toBe(owner.userId);
  }

  // ── the ranker's read returns only the owner's people ──
  const dataA = await t.query(internal.rank.rankData, { icpId: A.icpId });
  const dataB = await t.query(internal.rank.rankData, { icpId: B.icpId });
  expect(dataA!.leads.length).toBeGreaterThan(0);
  for (const lead of dataA!.leads) {
    expect(A.personIds.has(lead.id)).toBe(true);
    expect(B.personIds.has(lead.id)).toBe(false);
  }
  for (const lead of dataB!.leads) {
    expect(B.personIds.has(lead.id)).toBe(true);
  }

  // ── recommendations written through the pipeline land on their owner ──
  const topA = dataA!.leads[0].id;
  const topB = dataB!.leads[0].id;
  await writeTopRecommendation(t, A.icpId, topA, 92);
  await writeTopRecommendation(t, B.icpId, topB, 88);
  const recs = await t.run(async (ctx) =>
    ctx.db.query("recommendations").collect(),
  );
  expect(recs.find((r) => r.personId === topA)?.userId).toBe(A.userId);
  expect(recs.find((r) => r.personId === topB)?.userId).toBe(B.userId);

  // ── feed: each user sees ONLY their own people, including their rec ──
  const feedA = await A.as.query(api.feed.list, { limit: 50 });
  const feedB = await B.as.query(api.feed.list, { limit: 50 });
  expect(feedA.length).toBeGreaterThan(0);
  expect(feedB.length).toBeGreaterThan(0);
  for (const row of feedA) {
    expect(A.personIds.has(row.id)).toBe(true);
    expect(B.personIds.has(row.id)).toBe(false);
  }
  for (const row of feedB) {
    expect(B.personIds.has(row.id)).toBe(true);
  }
  expect(feedA.some((r) => r.id === topA && r.score === 92)).toBe(true);
  expect(feedB.some((r) => r.id === topB && r.score === 88)).toBe(true);
  const idsA = new Set(feedA.map((r) => r.id));
  expect(feedB.some((r) => idsA.has(r.id))).toBe(false);

  // ── icp: latest is the caller's own ──
  expect((await A.as.query(api.icp.latest, {}))?._id).toBe(A.icpId);
  expect((await B.as.query(api.icp.latest, {}))?._id).toBe(B.icpId);

  // ── graph: a connector's fan-out never crosses into the other graph ──
  const gA = await A.as.query(api.graph.pathForPerson, {
    personId: A.connectorIds[0],
  });
  expect(gA.kind).toBe("connector");
  if (gA.kind === "connector") {
    expect(gA.unlocks.length).toBeGreaterThan(0);
    for (const u of gA.unlocks) {
      expect(A.personIds.has(u.id)).toBe(true);
      expect(B.personIds.has(u.id)).toBe(false);
    }
  }
  // ...and a lead's bridging connectors are the owner's too.
  const gLead = await A.as.query(api.graph.pathForPerson, { personId: topA });
  if (gLead.kind === "lead") {
    for (const c of gLead.connectors) {
      expect(A.personIds.has(c.id)).toBe(true);
    }
  }

  // ── feedback: votes stay within the voter's graph and ranking nudge ──
  await A.as.mutation(api.feedback.vote, {
    icpId: A.icpId,
    personId: topA,
    vote: "up",
  });
  expect(await A.as.query(api.feedback.forIcp, { icpId: A.icpId })).toEqual([
    { personId: topA, vote: "up" },
  ]);
  // B reading A's icp id gets nothing.
  expect(await B.as.query(api.feedback.forIcp, { icpId: A.icpId })).toEqual([]);
  // A's vote never bends B's ranking vector.
  const nudgeB = await t.query(internal.rank.voteVectors, { icpId: B.icpId });
  expect(nudgeB.up).toEqual([]);
  expect(nudgeB.down).toEqual([]);
});

test("denied: direct cross-user id lookups on every surface, and signed-out callers get nothing", async () => {
  const t = convexTest(schema, modules);
  const A = await buildWorld(t, "alice@example.com", 0);
  const B = await buildWorld(t, "bob@example.com", 500);

  // A query with the OTHER user's person id is denied outright, both directions.
  await expect(
    A.as.query(api.graph.pathForPerson, { personId: B.leadIds[0] }),
  ).rejects.toThrow(/not found/i);
  await expect(
    B.as.query(api.graph.pathForPerson, { personId: A.connectorIds[0] }),
  ).rejects.toThrow(/not found/i);

  // Voting with the other user's icp id — denied.
  await expect(
    A.as.mutation(api.feedback.vote, {
      icpId: B.icpId,
      personId: B.leadIds[0],
      vote: "up",
    }),
  ).rejects.toThrow(/not found/i);
  // Voting with your OWN icp but the other user's person — denied.
  await expect(
    A.as.mutation(api.feedback.vote, {
      icpId: A.icpId,
      personId: B.leadIds[0],
      vote: "up",
    }),
  ).rejects.toThrow(/not found/i);
  // Reading the other user's votes by their icp id — empty, never their data.
  expect(await A.as.query(api.feedback.forIcp, { icpId: B.icpId })).toEqual([]);

  // The ranking write path refuses a foreign person on your icp.
  await expect(
    t.mutation(internal.rank.writeRecommendation, {
      icpId: A.icpId,
      personId: B.leadIds[0],
      score: 99,
      whyBullets: [],
      how: [],
      opener: "",
      unlocksIds: [],
    }),
  ).rejects.toThrow(/not found/i);

  // Signed-out callers: empty feed, no icp, and id lookups rejected.
  expect(await t.query(api.feed.list, {})).toEqual([]);
  expect(await t.query(api.icp.latest, {})).toBeNull();
  await expect(
    t.query(api.graph.pathForPerson, { personId: A.leadIds[0] }),
  ).rejects.toThrow(/Not authenticated/);
});

test("extension HTTP routes: anonymous callers are rejected outright; only the shared token reaches the demo graph", async () => {
  const t = convexTest(schema, modules);
  const A = await buildWorld(t, "alice@example.com", 0);
  // B's world exists purely as bait: none of it may surface below.
  await buildWorld(t, "bob@example.com", 500);

  // Open deploy (no token set): anonymous calls are rejected, fail-closed. The
  // demo graph is publicly READABLE (api.demo.*), so no anonymous path may
  // write into it — and the rejected call must not even create the demo user.
  const anonLeads = await t.fetch("/extension/leads", { method: "GET" });
  expect(anonLeads.status).toBe(401);
  const anonPost = await t.fetch("/extension/mutuals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leadSlug: "x",
      mutuals: [{ name: "Mutual One", slug: "mutual-one" }],
    }),
  });
  expect(anonPost.status).toBe(401);
  await t.run(async (ctx) => {
    const demo = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
      .unique();
    expect(demo).toBeNull();
  });

  vi.stubEnv("WARMLINE_EXTENSION_TOKEN", "secret");
  try {
    // With the token set, a missing or wrong bearer is rejected outright.
    const leads401 = await t.fetch("/extension/leads", { method: "GET" });
    expect(leads401.status).toBe(401);
    const mutuals401 = await t.fetch("/extension/mutuals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong",
      },
      body: JSON.stringify({ leadSlug: "x", mutuals: [] }),
    });
    expect(mutuals401.status).toBe(401);

    // A token-authorized POST whose leadSlug COLLIDES with one of A's leads:
    // the write must land on the demo account as new rows, never patch A's graph.
    const aLead = await t.run(async (ctx) => (await ctx.db.get(A.leadIds[0]))!);
    const aEdgesBefore = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("edges")
            .withIndex("by_user", (q) => q.eq("userId", A.userId))
            .collect()
        ).length,
    );
    const postRes = await t.fetch("/extension/mutuals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      },
      body: JSON.stringify({
        leadSlug: aLead.linkedinUrl,
        leadName: aLead.name,
        mutuals: [{ name: "Mutual One", slug: "mutual-one" }],
      }),
    });
    expect(postRes.status).toBe(200);
    expect(await postRes.json()).toEqual({ edges: 1 });

    await t.run(async (ctx) => {
      const demo = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
        .unique();
      expect(demo).not.toBeNull();
      // Every row the route created belongs to the demo account.
      const demoPersons = await ctx.db
        .query("persons")
        .withIndex("by_user", (q) => q.eq("userId", demo!._id))
        .collect();
      expect(demoPersons.map((p) => p.linkedinUrl).sort()).toEqual(
        [aLead.linkedinUrl, "mutual-one"].sort(),
      );
      const demoEdges = await ctx.db
        .query("edges")
        .withIndex("by_user", (q) => q.eq("userId", demo!._id))
        .collect();
      expect(demoEdges.length).toBe(1);
      // A's graph is untouched: same person doc, no status stamp, no new edges.
      const aLeadAfter = await ctx.db.get(A.leadIds[0]);
      expect(aLeadAfter?.userId).toBe(A.userId);
      expect(aLeadAfter?.mutualsStatus).toBeUndefined();
      const aPersons = await ctx.db
        .query("persons")
        .withIndex("by_user", (q) => q.eq("userId", A.userId))
        .collect();
      expect(aPersons.length).toBe(A.personIds.size);
      const aEdges = await ctx.db
        .query("edges")
        .withIndex("by_user", (q) => q.eq("userId", A.userId))
        .collect();
      expect(aEdges.length).toBe(aEdgesBefore);
    });

    // The token-authorized pending-leads crawl serves ONLY the demo graph,
    // whose one lead was just crawled ('done') — so nothing is pending, and in
    // particular none of A's or B's dozens of uncrawled leads ever surface.
    const pending = await t.fetch("/extension/leads", {
      method: "GET",
      headers: { Authorization: "Bearer secret" },
    });
    expect(await pending.json()).toEqual({ leads: [] });
  } finally {
    vi.unstubAllEnvs();
  }
});

test("icp.embedIcp: only the authenticated owner reaches the embed; anyone else is denied before any OpenAI call", async () => {
  const t = convexTest(schema, modules);
  const A = await buildWorld(t, "alice@example.com", 0);
  const B = await buildWorld(t, "bob@example.com", 500);

  // Anonymous caller: rejected at the auth gate. No OPENAI_API_KEY is set in
  // tests, so reaching the embed would fail with a DIFFERENT error — the
  // /Not authenticated/ match proves the gate fires first.
  await expect(
    t.action(api.icp.embedIcp, { icpId: A.icpId }),
  ).rejects.toThrow(/Not authenticated/);

  // A signed-in NON-owner: denied exactly like a missing doc, so the public
  // action can't be used to probe which icp ids exist.
  await expect(
    B.as.action(api.icp.embedIcp, { icpId: A.icpId }),
  ).rejects.toThrow(/not found/i);

  // The owner passes the gate: with OpenAI stubbed, the embed runs and the
  // vector lands on the owner's icp — and only there.
  const bVectorBefore = await t.run(
    async (ctx) => (await ctx.db.get(B.icpId))!.vector,
  );
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ data: [{ embedding: vec(7) }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  try {
    const res = await A.as.action(api.icp.embedIcp, { icpId: A.icpId });
    expect(res.dims).toBe(DIM);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(A.icpId))!.vector).toEqual(vec(7));
      expect((await ctx.db.get(B.icpId))!.vector).toEqual(bVectorBefore);
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
