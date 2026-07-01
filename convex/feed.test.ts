/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("fallback heuristic: sorts by score desc, excludes self, flags gatekeepers", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("persons", {
      name: "Me Myself",
      isSelf: true,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 1,
    });
    await ctx.db.insert("persons", {
      name: "Warm Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "connected",
      tieStrength: 0.9,
    });
    await ctx.db.insert("persons", {
      name: "Cold Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    await ctx.db.insert("persons", {
      name: "Big Connector",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.5,
      unlockValue: 10, // >= GATEKEEPER_MIN (8)
    });
    await ctx.db.insert("persons", {
      name: "Small Connector",
      isSelf: false,
      role: "connector",
      relationshipToYou: "not_connected",
      unlockValue: 3, // < 8
    });
  });

  const rows = await t.query(api.feed.list, {});

  // self is excluded
  expect(rows.find((r) => r.name === "Me Myself")).toBeUndefined();
  expect(rows.length).toBe(4);

  // sorted by score desc
  const scores = rows.map((r) => r.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));

  // gatekeeper flag from unlockValue threshold
  const big = rows.find((r) => r.name === "Big Connector");
  const small = rows.find((r) => r.name === "Small Connector");
  expect(big?.gatekeeper).toBe(true);
  expect(small?.gatekeeper).toBe(false);

  // warm connected lead outranks the cold one
  const warm = rows.find((r) => r.name === "Warm Lead");
  const cold = rows.find((r) => r.name === "Cold Lead");
  expect(warm!.score).toBeGreaterThan(cold!.score);
});

test("mutuals: a lead's row lists the connector bridged by a shared_company edge", async () => {
  const t = convexTest(schema, modules);
  const { leadId } = await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("persons", {
      name: "Target Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    const connectorId = await ctx.db.insert("persons", {
      name: "Bridge Person",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.6,
    });
    await ctx.db.insert("edges", {
      from: connectorId,
      to: leadId,
      type: "shared_company",
      confidence: 0.8,
      evidence: "Both at Stripe 2019-2021",
    });
    return { leadId };
  });

  const rows = await t.query(api.feed.list, {});
  const lead = rows.find((r) => r.id === leadId);
  expect(lead).toBeDefined();
  expect(lead!.mutuals.map((m) => m.name)).toContain("Bridge Person");
});

// Han Wang is a gatekeeper connector: his warm path is the leads he unlocks, so
// his row must show a fan-out stack with a total, never "No path yet".
test("connector row shows its fan-out as a warm-path stack with a total", async () => {
  const t = convexTest(schema, modules);
  const { hanId } = await t.run(async (ctx) => {
    const hanId = await ctx.db.insert("persons", {
      name: "Han Wang",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.9,
      unlockValue: 4, // > 0 so the connector row appears in the feed
    });
    for (const name of ["Lead A", "Lead B", "Lead C", "Lead D"]) {
      const leadId = await ctx.db.insert("persons", {
        name,
        isSelf: false,
        role: "lead",
        relationshipToYou: "not_connected",
      });
      await ctx.db.insert("edges", {
        from: hanId,
        to: leadId,
        type: "engagement",
        confidence: 0.7,
        evidence: "Both attended Mintlify Gala",
      });
    }
    return { hanId };
  });

  const rows = await t.query(api.feed.list, {});
  const han = rows.find((r) => r.id === hanId);
  expect(han).toBeDefined();
  // a real stack (not the empty state) capped at 3, with the true total of 4
  expect(han!.mutuals.length).toBe(3);
  expect(han!.mutualsTotal).toBe(4);
});

test("recommendation path: lead appears with the recommendation's why/how", async () => {
  const t = convexTest(schema, modules);
  const { leadId } = await t.run(async (ctx) => {
    const icpId = await ctx.db.insert("icp", {
      text: "AI founders",
      source: {},
    });
    const leadId = await ctx.db.insert("persons", {
      name: "Recommended Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
      company: "Acme",
    });
    await ctx.db.insert("recommendations", {
      personId: leadId,
      icpId,
      kind: "lead",
      score: 88,
      whyBullets: [{ text: "Strong ICP fit", confidence: 0.9 }],
      how: ["LinkedIn", "shared interest", "Hey there"],
      opener: "Hey there",
      unlocksIds: [],
    });
    return { leadId };
  });

  const rows = await t.query(api.feed.list, {});
  const lead = rows.find((r) => r.id === leadId);
  expect(lead).toBeDefined();
  expect(lead!.score).toBe(88);
  expect(lead!.why[0]).toEqual({ text: "Strong ICP fit", confidence: "high" });
  expect(lead!.how).toEqual(["LinkedIn", "shared interest", "Hey there"]);
});
