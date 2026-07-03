/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { api } from "./_generated/api";
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
// the ICP and Alice point the same way, Bob is orthogonal.
function embeddingFetchStub(embedInputs: string[]) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes("api.openai.com/v1/embeddings"))
      throw new Error(`unexpected fetch in test: ${u}`);
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
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", embeddingFetchStub(embedInputs));
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

  // Connector recommendations were written for this icp.
  const recs = await t.run(async (ctx) =>
    ctx.db
      .query("recommendations")
      .withIndex("by_icp_and_kind", (q) =>
        q.eq("icpId", icpId).eq("kind", "connector"),
      )
      .collect(),
  );
  expect(recs.length).toBe(2);

  // The feed ranks by goal fit: Alice (aligned with the ICP) above Bob.
  const rows = await as.query(api.feed.list, {});
  expect(rows.length).toBe(2);
  expect(rows.every((r) => r.kind === "connector")).toBe(true);
  expect(rows[0].name).toBe("Alice Adams");
  expect(rows[1].name).toBe("Bob Brown");
  expect(rows[0].score).toBeGreaterThan(rows[1].score);
});

test("capped import still yields feed rows via tieStrength ordering", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "import-capped@example.com");

  let networkCalls = 0;
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", async () => {
    networkCalls++;
    throw new Error("no network calls allowed when capped");
  });
  vi.useFakeTimers();
  try {
    await t.run(async (ctx) => {
      await ctx.db.insert("icp", {
        userId,
        text: "Meet AI infra founders",
        source: {},
      });
      // Today's embed budget is already fully spent.
      await ctx.db.insert("usage", {
        userId,
        day: dayKey(Date.now()),
        judge: 0,
        embed: TIER_LIMITS.free.embed,
        scrape: 0,
      });
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
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  // Fully capped: the rank pass degraded without a single OpenAI call and
  // wrote no recommendations.
  expect(networkCalls).toBe(0);
  const recCount = await t.run(async (ctx) =>
    (await ctx.db.query("recommendations").collect()).length,
  );
  expect(recCount).toBe(0);

  // Tie strengths arrive later (e.g. messages.csv ingest) — the degraded
  // feed must order by them.
  await t.run(async (ctx) => {
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const tie: Record<string, number> = {
      "Han Wang": 0.9,
      "Mia Reyes": 0.5,
      "Zed Klein": 0.1,
    };
    for (const p of persons) {
      await ctx.db.patch(p._id, { tieStrength: tie[p.name] });
    }
  });

  const rows = await as.query(api.feed.list, {});
  expect(rows.map((r) => r.name)).toEqual(["Han Wang", "Mia Reyes", "Zed Klein"]);
  const scores = rows.map((r) => r.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
});

test("re-import embeds nothing that is already cached", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "import-cache@example.com");
  await t.run(async (ctx) =>
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
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", embeddingFetchStub(embedInputs));
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
    // are all cached.
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
