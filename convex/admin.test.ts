/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Task: one-time admin embed backfill for a named user. Two-phase — the
// estimate call embeds nothing and reports count + cost; only confirm: true
// spends, under a raised per-invocation ceiling. RANK_EMBEDS_PER_RUN is
// untouched (asserted by leaving it out entirely and using a small ceiling).

async function seedPersons(
  t: ReturnType<typeof convexTest>,
  userId: string,
  n: number,
) {
  await t.run(async (ctx) => {
    for (let i = 0; i < n; i++) {
      await ctx.db.insert("persons", {
        userId: userId as never,
        name: `Person ${i}`,
        headline: "Engineer",
        company: "Acme",
        isSelf: false,
        role: "connector",
        relationshipToYou: "connected",
      });
    }
  });
}

test("embedBackfill: estimate phase counts people and cost, embeds nothing", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "owner@example.com" }),
  );
  await seedPersons(t, userId, 3);

  let fetched = false;
  vi.stubGlobal("fetch", async () => {
    fetched = true;
    throw new Error("no OpenAI during estimate");
  });
  let res;
  try {
    res = await t.action(internal.admin.embedBackfill, {
      email: "owner@example.com",
    });
  } finally {
    vi.unstubAllGlobals();
  }
  expect(fetched).toBe(false);
  expect(res.ran).toBe(false);
  expect(res.totalPersons).toBe(3);
  expect(res.toEmbed).toBe(3);
  expect(res.alreadyEmbedded).toBe(0);
  expect(res.estTokens).toBeGreaterThan(0);
  expect(res.estCostUsd).toBeGreaterThan(0);
  expect(res.embedded).toBe(0);

  // No vectors were written.
  const vectors = await t.run(async (ctx) =>
    ctx.db.query("personVectors").collect(),
  );
  expect(vectors.length).toBe(0);
});

test("embedBackfill: confirm phase embeds every missing person under the ceiling", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "owner2@example.com" }),
  );
  await seedPersons(t, userId, 3);

  vi.stubEnv("OPENAI_API_KEY", "oa-test");
  vi.stubGlobal("fetch", async () => {
    return new Response(
      JSON.stringify({ data: [{ embedding: Array(1536).fill(0.01) }] }),
      { status: 200 },
    );
  });
  let res;
  try {
    res = await t.action(internal.admin.embedBackfill, {
      email: "owner2@example.com",
      confirm: true,
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(res.ran).toBe(true);
  expect(res.embedded).toBe(3);
  expect(res.failed).toBe(0);
  expect(res.remaining).toBe(0);

  const vectors = await t.run(async (ctx) =>
    ctx.db.query("personVectors").collect(),
  );
  expect(vectors.length).toBe(3);

  // A second confirm run finds everyone already embedded — nothing to do.
  vi.stubEnv("OPENAI_API_KEY", "oa-test");
  vi.stubGlobal("fetch", async () => {
    throw new Error("should not embed again");
  });
  try {
    const again = await t.action(internal.admin.embedBackfill, {
      email: "owner2@example.com",
      confirm: true,
    });
    expect(again.toEmbed).toBe(0);
    expect(again.embedded).toBe(0);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test("embedBackfill: ceiling bounds one invocation and reports the remainder", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "owner3@example.com" }),
  );
  await seedPersons(t, userId, 4);

  vi.stubEnv("OPENAI_API_KEY", "oa-test");
  vi.stubGlobal("fetch", async () => {
    return new Response(
      JSON.stringify({ data: [{ embedding: Array(1536).fill(0.01) }] }),
      { status: 200 },
    );
  });
  let res;
  try {
    res = await t.action(internal.admin.embedBackfill, {
      email: "owner3@example.com",
      confirm: true,
      ceiling: 2,
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(res.embedded).toBe(2);
  expect(res.remaining).toBe(2);
});

test("embedBackfill: unknown email throws", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.action(internal.admin.embedBackfill, { email: "nobody@example.com" }),
  ).rejects.toThrow(/No user/);
});
