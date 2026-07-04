/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { dayKey, TIER_LIMITS, GLOBAL_LIMITS } from "./limits";

const modules = import.meta.glob("./**/*.ts");

// Task S1.2: adding target people promotes an existing person to a lead
// (never duplicates), forms shared-company bridges, and re-ranks — all
// without any OpenAI call (embed + judge budgets are pre-spent so the rank
// pass degrades; computeEdges never calls OpenAI anyway).

async function newUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|s1` }) };
}

// Pre-spend today's embed + judge budget so rank.rebuild degrades with zero
// OpenAI calls (the capped-degrade path), keeping the test network-free.
async function capOpenAI(t: ReturnType<typeof convexTest>, userId: string) {
  await t.run(async (ctx) => {
    const day = dayKey(Date.now());
    await ctx.db.insert("usage", {
      userId: userId as never,
      day,
      judge: TIER_LIMITS.free.judge,
      embed: TIER_LIMITS.free.embed,
      scrape: 0,
    });
    await ctx.db.insert("usageGlobal", {
      day,
      judge: GLOBAL_LIMITS.judge,
      embed: GLOBAL_LIMITS.embed,
      scrape: 0,
    });
  });
}

test("addTargets: a same-company colleague becomes a lead with a warm path", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "targets-bridge@example.com");
  await t.run(async (ctx) => {
    ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} });
    await ctx.db.insert("persons", {
      userId,
      name: "Bridge Person",
      company: "Acme",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.6,
    });
  });
  await capOpenAI(t, userId);

  let networkCalls = 0;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    networkCalls++;
    throw new Error("no OpenAI in this test");
  });
  vi.useFakeTimers();
  try {
    const res = await as.mutation(api.ingest.addTargets, {
      rows: [{ name: "Target Lead", company: "Acme" }],
    });
    expect(res).toEqual({ added: 1, promoted: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(networkCalls).toBe(0);

  // The new lead exists, and computeEdges bridged it to the same-company connector.
  const rows = await as.query(api.feed.list, {});
  const lead = rows.find((r) => r.name === "Target Lead");
  expect(lead).toBeDefined();
  expect(lead!.kind).toBe("lead");
  expect(lead!.mutuals.map((m) => m.name)).toContain("Bridge Person");
});

test("addTargets: an existing person is promoted, not duplicated (name + company)", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "targets-promote@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} });
    await ctx.db.insert("persons", {
      userId,
      name: "Jane Doe",
      company: "Globex",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
  });
  await capOpenAI(t, userId);

  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no OpenAI in this test");
  });
  vi.useFakeTimers();
  try {
    const res = await as.mutation(api.ingest.addTargets, {
      rows: [{ name: "Jane Doe", company: "Globex" }],
    });
    expect(res).toEqual({ added: 0, promoted: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  const persons = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(persons.length).toBe(1);
  expect(persons[0].role).toBe("lead");
  expect(persons[0].relationshipToYou).toBe("connected"); // still in-network
});

test("addTargets: rejects an over-large batch to keep reads bounded", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "targets-cap@example.com");
  await t.run(async (ctx) =>
    ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} }),
  );
  const rows = Array.from({ length: 101 }, (_, i) => ({
    name: `Person ${i}`,
    company: "BigCo",
  }));
  await expect(as.mutation(api.ingest.addTargets, { rows })).rejects.toThrow(
    /up to 100/,
  );
});

test("addTargets: dedupes by LinkedIn slug and promotes in place", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "targets-slug@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} });
    await ctx.db.insert("persons", {
      userId,
      name: "Sam Real Name",
      linkedinUrl: "https://linkedin.com/in/sam",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
  });
  await capOpenAI(t, userId);

  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no OpenAI in this test");
  });
  vi.useFakeTimers();
  try {
    const res = await as.mutation(api.ingest.addTargets, {
      rows: [
        { name: "Sam Pasted Differently", linkedinUrl: "https://linkedin.com/in/sam" },
      ],
    });
    expect(res).toEqual({ added: 0, promoted: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  const persons = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(persons.length).toBe(1);
  expect(persons[0].role).toBe("lead");
  // fillMissing never clobbers an existing name.
  expect(persons[0].name).toBe("Sam Real Name");
});
