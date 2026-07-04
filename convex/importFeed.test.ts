/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { dayKey, TIER_LIMITS } from "./limits";

const modules = import.meta.glob("./**/*.ts");

// The import → feed loop (task 2): a LinkedIn export upload must produce a
// ranked feed on its own — computeEdges plus a rank pass are scheduled by the
// import itself, connectors rank by goal fit when the user has zero leads,
// embeds cache in personVectors, and a capped run degrades to tieStrength.

async function newUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|s1` }) };
}

// A minimal LinkedIn data-export ZIP: Connections.csv with the real header
// (and the "Notes:" preamble LinkedIn prepends).
function connectionsZip(
  rows: {
    first: string;
    last: string;
    url?: string;
    company?: string;
    position?: string;
  }[],
): Blob {
  const csv = [
    "Notes:",
    '"When exporting your connection data, you may be missing information"',
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    ...rows.map(
      (r) =>
        `${r.first},${r.last},${r.url ?? ""},,${r.company ?? ""},${r.position ?? ""},01 Jan 2026`,
    ),
  ].join("\n");
  const zip = zipSync({ "Connections.csv": strToU8(csv) });
  return new Blob([zip.slice().buffer]);
}

// Full-width sparse vectors (personVectors' index is 1536-dim).
const DIM = 1536;
function vecOf(components: Record<number, number>): number[] {
  const v = new Array(DIM).fill(0);
  for (const [i, x] of Object.entries(components)) v[Number(i)] = x;
  return v;
}

// Embedding stub that routes by input text, so goal fit is deterministic:
// the ICP and Alice point the same way, Bob is orthogonal. Chat-completions
// (the connector reconnect-opener draft) returns a fixed opener and counts
// its calls in `chat`.
function openaiFetchStub(embedInputs: string[], chat: { n: number }) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("api.openai.com/v1/embeddings")) {
      const input = (JSON.parse(String(init?.body)) as { input: string }).input;
      embedInputs.push(input);
      const embedding = input.includes("AI infra founders")
        ? vecOf({ 0: 1 }) // the ICP text
        : input.includes("Alice")
          ? vecOf({ 0: 0.95, 1: 0.3 }) // strong goal fit
          : vecOf({ 2: 1 }); // orthogonal → neutral fit
      return new Response(JSON.stringify({ data: [{ embedding }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("api.openai.com/v1/chat/completions")) {
      chat.n++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opener: "Great to reconnect, would love your read on who to meet",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
}

test("imported connectors-only network yields ranked feed rows", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "import-rank@example.com");
  const icpId = await t.run(async (ctx) =>
    ctx.db.insert("icp", {
      userId,
      text: "Meet AI infra founders",
      source: {},
    }),
  );
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(
      connectionsZip([
        {
          first: "Alice",
          last: "Adams",
          url: "https://www.linkedin.com/in/alice",
          company: "DeepStack",
          position: "AI Founder",
        },
        {
          first: "Bob",
          last: "Brown",
          url: "https://www.linkedin.com/in/bob",
          company: "LedgerCo",
          position: "Accountant",
        },
      ]),
    ),
  );

  const embedInputs: string[] = [];
  const chat = { n: 0 };
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", openaiFetchStub(embedInputs, chat));
  vi.useFakeTimers();
  try {
    const res = await as.action(api.linkedinImport.parseLinkedInExport, {
      storageId,
    });
    expect(res).toEqual({ imported: 2, skipped: 0 });
    // Drain the scheduled pipeline: afterImport → computeEdges → rank.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  // The rank pass embedded the ICP and both connectors.
  expect(embedInputs.some((i) => i.includes("AI infra founders"))).toBe(true);
  expect(embedInputs.some((i) => i.includes("Alice Adams"))).toBe(true);
  expect(embedInputs.some((i) => i.includes("Bob Brown"))).toBe(true);
  // The agent is visible: a reconnect opener was drafted for the top
  // connectors (2 people ≤ CONNECTOR_OPENERS_PER_RUN, so both).
  expect(chat.n).toBe(2);

  // Connector recommendations were written for this icp, carrying openers.
  const recs = await t.run(async (ctx) =>
    ctx.db
      .query("recommendations")
      .withIndex("by_icp_and_kind", (q) =>
        q.eq("icpId", icpId).eq("kind", "connector"),
      )
      .collect(),
  );
  expect(recs.length).toBe(2);
  expect(recs.every((r) => r.opener.length > 0)).toBe(true);

  // The feed ranks by goal fit: Alice (aligned with the ICP) above Bob, and
  // surfaces the drafted opener on the row.
  const rows = await as.query(api.feed.list, {});
  expect(rows.length).toBe(2);
  expect(rows.every((r) => r.kind === "connector")).toBe(true);
  expect(rows[0].name).toBe("Alice Adams");
  expect(rows[1].name).toBe("Bob Brown");
  expect(rows[0].score).toBeGreaterThan(rows[1].score);
  expect(rows[0].opener && rows[0].opener.length > 0).toBe(true);
});

test("capped import still yields feed rows via tieStrength ordering", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "import-capped@example.com");

  // A REAL-looking key, so any attempted OpenAI call reaches the counting
  // fetch stub instead of dying earlier in apiKey() — otherwise
  // networkCalls === 0 would hold even with the reserve gate deleted.
  let networkCalls = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    networkCalls++;
    throw new Error("no network calls allowed when capped");
  });
  vi.useFakeTimers();
  try {
    const icpId = await t.run(async (ctx) => {
      const icpId = await ctx.db.insert("icp", {
        userId,
        text: "Meet AI infra founders",
        source: {},
      });
      // Today's embed AND judge budgets are already fully spent, so the rank
      // pass can neither embed nor draft an opener — it must fully degrade.
      await ctx.db.insert("usage", {
        userId,
        day: dayKey(Date.now()),
        judge: TIER_LIMITS.free.judge,
        embed: TIER_LIMITS.free.embed,
        scrape: 0,
      });
      return icpId;
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(
        connectionsZip([
          {
            first: "Han",
            last: "Wang",
            url: "https://www.linkedin.com/in/han",
            company: "Mintlify",
          },
          {
            first: "Mia",
            last: "Reyes",
            url: "https://www.linkedin.com/in/mia",
            company: "Stripe",
          },
          {
            first: "Zed",
            last: "Klein",
            url: "https://www.linkedin.com/in/zed",
            company: "Vercel",
          },
        ]),
      ),
    );
    const res = await as.action(api.linkedinImport.parseLinkedInExport, {
      storageId,
    });
    expect(res).toEqual({ imported: 3, skipped: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // afterImport swallows rank errors by design, so prove the capped rank
    // DEGRADES (returns) rather than throws by running it directly, and that
    // it reports exactly the skipped work: the icp embed + 3 person embeds.
    const out = await t.action(internal.rank.rebuild, { icpId });
    expect(out).toEqual({
      scored: 0,
      judged: 0,
      judgeDegraded: 0,
      embedsSkipped: 4,
    });
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  // Fully capped: not a single OpenAI call was attempted, no recommendations
  // were written, and the usage counters did not move past the cap.
  expect(networkCalls).toBe(0);
  const recCount = await t.run(async (ctx) =>
    (await ctx.db.query("recommendations").collect()).length,
  );
  expect(recCount).toBe(0);
  const embedUsed = await t.run(async (ctx) => {
    const rows = await ctx.db.query("usage").collect();
    return rows.reduce((sum, r) => sum + r.embed, 0);
  });
  expect(embedUsed).toBe(TIER_LIMITS.free.embed);

  // Tie strengths arrive later (e.g. messages.csv ingest) — the degraded
  // feed must order by them. Assigned OUT of insertion order so a stable
  // sort on equal scores can't pass this vacuously.
  await t.run(async (ctx) => {
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const tie: Record<string, number> = {
      "Han Wang": 0.1,
      "Mia Reyes": 0.9,
      "Zed Klein": 0.5,
    };
    for (const p of persons) {
      await ctx.db.patch(p._id, { tieStrength: tie[p.name] });
    }
  });

  const rows = await as.query(api.feed.list, {});
  expect(rows.map((r) => r.name)).toEqual(["Mia Reyes", "Zed Klein", "Han Wang"]);
  const scores = rows.map((r) => r.score);
  expect(scores[0]).toBeGreaterThan(scores[1]);
  expect(scores[1]).toBeGreaterThan(scores[2]);
});

test("re-import embeds nothing that is already cached", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "import-cache@example.com");
  const icpId = await t.run(async (ctx) =>
    ctx.db.insert("icp", {
      userId,
      text: "Meet AI infra founders",
      source: {},
    }),
  );
  const people = [
    {
      first: "Alice",
      last: "Adams",
      url: "https://www.linkedin.com/in/alice",
      company: "DeepStack",
      position: "AI Founder",
    },
    {
      first: "Bob",
      last: "Brown",
      url: "https://www.linkedin.com/in/bob",
      company: "LedgerCo",
      position: "Accountant",
    },
  ];

  const embedInputs: string[] = [];
  const chat = { n: 0 };
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", openaiFetchStub(embedInputs, chat));
  vi.useFakeTimers();
  try {
    const first = await t.run(async (ctx) =>
      ctx.storage.store(connectionsZip(people)),
    );
    const res1 = await as.action(api.linkedinImport.parseLinkedInExport, {
      storageId: first,
    });
    expect(res1).toEqual({ imported: 2, skipped: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // First pass embedded the ICP + both people; everything is now cached.
    expect(embedInputs.length).toBe(3);

    embedInputs.length = 0;
    const second = await t.run(async (ctx) =>
      ctx.storage.store(connectionsZip(people)),
    );
    const res2 = await as.action(api.linkedinImport.parseLinkedInExport, {
      storageId: second,
    });
    // Dedup by LinkedIn URL: nothing new lands in the graph…
    expect(res2).toEqual({ imported: 0, skipped: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // …and the re-ranked pass embeds NOTHING: ICP vector and person vectors
    // are all cached (opener drafts are chat calls, not embeddings).
    expect(embedInputs.length).toBe(0);

    // afterImport swallows rank errors, so embedInputs === 0 alone can't
    // distinguish "cached" from "the second pass crashed before embedding".
    // Run the rank directly: it must COMPLETE, score both people from cache
    // (embed nothing) and draft an opener for each (judged: 2).
    const out = await t.action(internal.rank.rebuild, { icpId });
    expect(out).toEqual({
      scored: 2,
      judged: 2,
      judgeDegraded: 0,
      embedsSkipped: 0,
    });
    expect(embedInputs.length).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  // The graph holds exactly the two people and the feed still ranks them.
  const personCount = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("persons")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).length,
  );
  expect(personCount).toBe(2);
  const rows = await as.query(api.feed.list, {});
  expect(rows.map((r) => r.name)).toEqual(["Alice Adams", "Bob Brown"]);
});
