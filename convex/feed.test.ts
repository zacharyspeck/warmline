/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function newUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email }),
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|s1` }) };
}

test("fallback heuristic: sorts by score desc, excludes self, flags gatekeepers", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "a@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("persons", {
      userId,
      name: "Me Myself",
      isSelf: true,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 1,
    });
    await ctx.db.insert("persons", {
      userId,
      name: "Warm Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "connected",
      tieStrength: 0.9,
    });
    await ctx.db.insert("persons", {
      userId,
      name: "Cold Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    await ctx.db.insert("persons", {
      userId,
      name: "Big Connector",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.5,
      unlockValue: 10,
    });
    await ctx.db.insert("persons", {
      userId,
      name: "Small Connector",
      isSelf: false,
      role: "connector",
      relationshipToYou: "not_connected",
      unlockValue: 3,
    });
  });

  const rows = await as.query(api.feed.list, {});

  expect(rows.find((r) => r.name === "Me Myself")).toBeUndefined();
  expect(rows.length).toBe(4);

  const scores = rows.map((r) => r.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));

  const big = rows.find((r) => r.name === "Big Connector");
  const small = rows.find((r) => r.name === "Small Connector");
  expect(big?.gatekeeper).toBe(true);
  expect(small?.gatekeeper).toBe(false);

  const warm = rows.find((r) => r.name === "Warm Lead");
  const cold = rows.find((r) => r.name === "Cold Lead");
  expect(warm!.score).toBeGreaterThan(cold!.score);
});

test("in-network connectors appear even when they bridge no lead (reconnect section)", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "reconnect@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("persons", {
      userId,
      name: "The Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    // In-network connectors that unlock NO lead (no unlockValue). These used to
    // be filtered out of the feed entirely the moment any lead existed, so a
    // whole network rendered nowhere.
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert("persons", {
        userId,
        name: `Colleague ${i}`,
        isSelf: false,
        role: "connector",
        relationshipToYou: "connected",
        tieStrength: 0.4 + i * 0.1,
      });
    }
  });

  const rows = await as.query(api.feed.list, {});
  const connectors = rows.filter((r) => r.kind === "connector");
  expect(connectors.map((r) => r.name).sort()).toEqual([
    "Colleague 0",
    "Colleague 1",
    "Colleague 2",
  ]);
  // Each carries a real, non-zero relevance score.
  for (const r of connectors) expect(r.score).toBeGreaterThan(0);
  // The lead is still there for the headline section.
  expect(rows.find((r) => r.name === "The Lead")).toBeDefined();
});

test("connector row shows its fan-out as a warm-path stack with a total", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "b@example.com");
  const { hanId } = await t.run(async (ctx) => {
    const hanId = await ctx.db.insert("persons", {
      userId,
      name: "Han Wang",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.9,
      unlockValue: 4,
    });
    for (const name of ["Lead A", "Lead B", "Lead C", "Lead D"]) {
      const leadId = await ctx.db.insert("persons", {
        userId,
        name,
        isSelf: false,
        role: "lead",
        relationshipToYou: "not_connected",
      });
      await ctx.db.insert("edges", {
        userId,
        from: hanId,
        to: leadId,
        type: "engagement",
        confidence: 0.7,
        evidence: "Both attended Mintlify Gala",
      });
    }
    return { hanId };
  });

  const rows = await as.query(api.feed.list, {});
  const han = rows.find((r) => r.id === hanId);
  expect(han).toBeDefined();
  expect(han!.mutuals.length).toBe(3);
  expect(han!.mutualsTotal).toBe(4);
});

test("mutuals: a lead's row lists the connector bridged by a shared_company edge", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "c@example.com");
  const { leadId } = await t.run(async (ctx) => {
    const leadId = await ctx.db.insert("persons", {
      userId,
      name: "Target Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    const connectorId = await ctx.db.insert("persons", {
      userId,
      name: "Bridge Person",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 0.6,
    });
    await ctx.db.insert("edges", {
      userId,
      from: connectorId,
      to: leadId,
      type: "shared_company",
      confidence: 0.8,
      evidence: "Both at Stripe 2019-2021",
    });
    return { leadId };
  });

  const rows = await as.query(api.feed.list, {});
  const lead = rows.find((r) => r.id === leadId);
  expect(lead).toBeDefined();
  expect(lead!.mutuals.map((m) => m.name)).toContain("Bridge Person");
});

test("recommendation path: lead appears with the recommendation's why/how", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "d@example.com");
  const { leadId } = await t.run(async (ctx) => {
    const icpId = await ctx.db.insert("icp", {
      userId,
      text: "AI founders",
      source: {},
    });
    const leadId = await ctx.db.insert("persons", {
      userId,
      name: "Recommended Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
      company: "Acme",
    });
    await ctx.db.insert("recommendations", {
      userId,
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

  const rows = await as.query(api.feed.list, {});
  const lead = rows.find((r) => r.id === leadId);
  expect(lead).toBeDefined();
  expect(lead!.score).toBe(88);
  expect(lead!.why[0]).toEqual({ text: "Strong ICP fit", confidence: "high" });
  expect(lead!.how).toEqual(["LinkedIn", "shared interest", "Hey there"]);
});

test("feed is isolated: a user never sees another user's people", async () => {
  const t = convexTest(schema, modules);
  const a = await newUser(t, "iso-a@example.com");
  const b = await newUser(t, "iso-b@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("persons", {
      userId: a.userId,
      name: "A Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    await ctx.db.insert("persons", {
      userId: b.userId,
      name: "B Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
  });

  const aRows = await a.as.query(api.feed.list, {});
  const bRows = await b.as.query(api.feed.list, {});
  expect(aRows.map((r) => r.name)).toEqual(["A Lead"]);
  expect(bRows.map((r) => r.name)).toEqual(["B Lead"]);
});
