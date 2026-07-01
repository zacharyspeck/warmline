/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("backfillToDemo stamps the demo userId on pre-multi-user rows", async () => {
  const t = convexTest(schema, modules);
  // Rows that predate multi-user (no userId — valid while the field is optional).
  await t.run(async (ctx) => {
    const p = await ctx.db.insert("persons", {
      name: "Old Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    await ctx.db.insert("icp", { text: "Old goal", source: {} });
    await ctx.db.insert("recommendations", {
      personId: p,
      icpId: await ctx.db.insert("icp", { text: "x", source: {} }),
      kind: "lead",
      score: 50,
      whyBullets: [],
      how: [],
      opener: "",
      unlocksIds: [],
    });
  });

  const userId = await t.mutation(internal.devSeed.getOrCreateDemoUser, {});
  const counts = await t.mutation(internal.devSeed.backfillToDemo, { userId });
  expect(counts.persons).toBe(1);
  expect(counts.icp).toBe(2);
  expect(counts.recommendations).toBe(1);

  // every row now belongs to the demo user
  const persons = await t.run((ctx) => ctx.db.query("persons").collect());
  expect(persons.every((p) => p.userId === userId)).toBe(true);

  // idempotent: a second run stamps nothing
  const again = await t.mutation(internal.devSeed.backfillToDemo, { userId });
  expect(again.persons).toBe(0);
  expect(again.icp).toBe(0);
});

test("seedNetwork produces a substantive, ranked-feed-ready network", async () => {
  const t = convexTest(schema, modules);
  const res = await t.mutation(internal.devSeed.seedNetwork, {});
  expect(res.leads).toBeGreaterThanOrEqual(20);
  expect(res.edges).toBeGreaterThan(0);

  const rows = await t.query(api.feed.list, { limit: 40 });
  // a healthy feed, not three rows
  expect(rows.length).toBeGreaterThanOrEqual(20);
  expect(rows.length).toBeLessThanOrEqual(50);
  // connectors surface their fan-out as a warm path, and a gatekeeper exists
  expect(
    rows.some((r) => r.kind === "connector" && r.mutualsTotal > 0),
  ).toBe(true);
  expect(rows.some((r) => r.gatekeeper)).toBe(true);
  // leads carry their bridging connectors as mutuals
  expect(rows.some((r) => r.kind === "lead" && r.mutuals.length > 0)).toBe(true);
});
