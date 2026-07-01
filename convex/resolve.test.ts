/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("mergePersons: moves edge/recommendation/attendance, fills fields, deletes drop", async () => {
  const t = convexTest(schema, modules);

  const seed = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "m@example.com" });
    // keep: connector, missing a company.
    const keepId = await ctx.db.insert("persons", {
      userId,
      name: "Han Wang",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
    // drop: lead, HAS a company (the field keep is missing).
    const dropId = await ctx.db.insert("persons", {
      userId,
      name: "Han Wang",
      company: "Mintlify",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    // a lead that drop has an outgoing edge to.
    const someLead = await ctx.db.insert("persons", {
      userId,
      name: "Target Lead",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    const edgeId = await ctx.db.insert("edges", {
      userId,
      from: dropId,
      to: someLead,
      type: "linkedin_mutual",
      confidence: 0.9,
      evidence: "shared company",
    });
    const icpId = await ctx.db.insert("icp", {
      userId,
      text: "founders",
      source: {},
    });
    const recId = await ctx.db.insert("recommendations", {
      userId,
      personId: dropId,
      icpId,
      kind: "lead",
      score: 0.5,
      whyBullets: [],
      how: ["x", "warm"],
      opener: "hi",
      unlocksIds: [],
    });
    const eventId = await ctx.db.insert("events", {
      userId,
      name: "YC Demo Day",
    });
    const attId = await ctx.db.insert("attendance", {
      userId,
      personId: dropId,
      eventId,
      confidence: 0.8,
    });
    return { keepId, dropId, edgeId, recId, attId };
  });

  const res = await t.mutation(internal.resolve.mergePersons, {
    keepId: seed.keepId,
    dropId: seed.dropId,
  });
  expect(res).toEqual({ edges: 1, attendance: 1, recommendations: 1 });

  await t.run(async (ctx) => {
    // drop is deleted.
    expect(await ctx.db.get(seed.dropId)).toBeNull();
    // all references now point to keep.
    const edge = await ctx.db.get(seed.edgeId);
    const rec = await ctx.db.get(seed.recId);
    const att = await ctx.db.get(seed.attId);
    expect(edge?.from).toBe(seed.keepId);
    expect(rec?.personId).toBe(seed.keepId);
    expect(att?.personId).toBe(seed.keepId);
    // keep gained drop's missing field + the lead role wins over connector.
    const keep = await ctx.db.get(seed.keepId);
    expect(keep?.company).toBe("Mintlify");
    expect(keep?.role).toBe("lead");
  });
});

test("mergePersons: lead role on drop overrides a connector keep", async () => {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "m@example.com" });
    const keepId = await ctx.db.insert("persons", {
      userId,
      name: "Keep",
      company: "Stripe",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
    const dropId = await ctx.db.insert("persons", {
      userId,
      name: "Drop",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    return { keepId, dropId };
  });

  await t.mutation(internal.resolve.mergePersons, ids);

  await t.run(async (ctx) => {
    const keep = await ctx.db.get(ids.keepId);
    expect(keep?.role).toBe("lead");
    // keep already had its own company; drop's missing fields don't clobber it.
    expect(keep?.company).toBe("Stripe");
    expect(await ctx.db.get(ids.dropId)).toBeNull();
  });
});

test("mergePersons: two different users' rows can never fold into one graph", async () => {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const userA = await ctx.db.insert("users", { email: "a@example.com" });
    const userB = await ctx.db.insert("users", { email: "b@example.com" });
    const keepId = await ctx.db.insert("persons", {
      userId: userA,
      name: "Same Name",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
    const dropId = await ctx.db.insert("persons", {
      userId: userB,
      name: "Same Name",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
    return { keepId, dropId };
  });

  await expect(
    t.mutation(internal.resolve.mergePersons, ids),
  ).rejects.toThrow(/cross-user/);

  // Both rows survive untouched.
  await t.run(async (ctx) => {
    expect(await ctx.db.get(ids.keepId)).not.toBeNull();
    expect(await ctx.db.get(ids.dropId)).not.toBeNull();
  });
});

test("setLinkedinAndMaybeMerge: only sees the owner's persons", async () => {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const userA = await ctx.db.insert("users", { email: "a@example.com" });
    const userB = await ctx.db.insert("users", { email: "b@example.com" });
    // A has the X-handle person; B has a person already carrying the slug.
    const handlePerson = await ctx.db.insert("persons", {
      userId: userA,
      name: "Handle Person",
      xHandle: "handle",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
    const foreignSlug = await ctx.db.insert("persons", {
      userId: userB,
      name: "Foreign Slug",
      linkedinUrl: "the-slug",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
    return { userA, handlePerson, foreignSlug };
  });

  // Resolving for A must PATCH A's person, not merge into B's slug-person.
  const r = await t.mutation(internal.resolve.setLinkedinAndMaybeMerge, {
    userId: ids.userA,
    handle: "handle",
    slug: "the-slug",
  });
  expect(r).toEqual({ action: "patched" });

  await t.run(async (ctx) => {
    const a = await ctx.db.get(ids.handlePerson);
    const b = await ctx.db.get(ids.foreignSlug);
    expect(a?.linkedinUrl).toBe("the-slug");
    expect(b).not.toBeNull(); // B's row untouched
  });
});
