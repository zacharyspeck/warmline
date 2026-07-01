/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// Seed a small graph for one user: one lead + two connectors at "Stripe", one
// connector at "Other", and yourself. computeEdges should bridge only the
// same-company connectors to the lead.
async function seed(t: ReturnType<typeof convexTest>, email = "a@example.com") {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    const lead = await ctx.db.insert("persons", {
      userId,
      name: "Lena Lead",
      company: "Stripe",
      isSelf: false,
      role: "lead" as const,
      relationshipToYou: "not_connected" as const,
    });
    const conn1 = await ctx.db.insert("persons", {
      userId,
      name: "Cara Connector",
      company: "Stripe",
      isSelf: false,
      role: "connector" as const,
      relationshipToYou: "connected" as const,
    });
    const conn2 = await ctx.db.insert("persons", {
      userId,
      name: "Carl Connector",
      company: "Stripe",
      isSelf: false,
      role: "connector" as const,
      relationshipToYou: "connected" as const,
    });
    const other = await ctx.db.insert("persons", {
      userId,
      name: "Otto Other",
      company: "Other",
      isSelf: false,
      role: "connector" as const,
      relationshipToYou: "connected" as const,
    });
    // You — no company, must never be bridged into the lead's edges.
    const self = await ctx.db.insert("persons", {
      userId,
      name: "You",
      isSelf: true,
      role: "connector" as const,
      relationshipToYou: "connected" as const,
    });
    return { userId, lead, conn1, conn2, other, self };
  });
}

test("computeEdges bridges same-company connectors to the lead, stamped with the owner", async () => {
  const t = convexTest(schema, modules);
  const ids = await seed(t);

  const result = await t.action(internal.edges.computeEdges, {
    userId: ids.userId,
  });
  expect(result.leads).toBe(1);
  expect(result.edges).toBe(2);

  const edges = await t.run(async (ctx) => ctx.db.query("edges").collect());
  // Exactly two edges, both the Stripe connectors → lead, owned by the user.
  expect(edges.length).toBe(2);
  for (const e of edges) {
    expect(e.type).toBe("shared_company");
    expect(e.to).toBe(ids.lead);
    expect(e.evidence).toContain("Stripe");
    expect(e.userId).toBe(ids.userId);
  }
  const fromIds = edges.map((e) => e.from).sort();
  expect(fromIds).toEqual([ids.conn1, ids.conn2].sort());

  // The "Other"-company connector and You are never bridged.
  const otherEdge = edges.find(
    (e) => e.from === ids.other || e.from === ids.self,
  );
  expect(otherEdge).toBeUndefined();

  // Each Stripe connector unlocks exactly the one lead.
  const unlockOf = async (id: Id<"persons">) =>
    (await t.run(async (ctx) => ctx.db.get(id)))?.unlockValue;
  expect(await unlockOf(ids.conn1)).toBe(1);
  expect(await unlockOf(ids.conn2)).toBe(1);
  // The off-company connector gets no unlock value.
  expect(await unlockOf(ids.other)).toBeUndefined();
});

test("computeEdges never bridges across users, even at the same company", async () => {
  const t = convexTest(schema, modules);
  const a = await seed(t, "iso-a@example.com");
  // A second user whose connector also works at Stripe.
  const b = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "iso-b@example.com" });
    const conn = await ctx.db.insert("persons", {
      userId,
      name: "Bella B",
      company: "Stripe",
      isSelf: false,
      role: "connector" as const,
      relationshipToYou: "connected" as const,
    });
    return { userId, conn };
  });

  await t.action(internal.edges.computeEdges, { userId: a.userId });

  const edges = await t.run(async (ctx) => ctx.db.query("edges").collect());
  // Only A's two Stripe connectors bridge; B's Stripe connector never appears.
  expect(edges.length).toBe(2);
  expect(edges.some((e) => e.from === b.conn)).toBe(false);
});

test("clearEdges removes only the owner's shared_company edges", async () => {
  const t = convexTest(schema, modules);
  const a = await seed(t, "clear-a@example.com");
  const b = await seed(t, "clear-b@example.com");

  await t.action(internal.edges.computeEdges, { userId: a.userId });
  await t.action(internal.edges.computeEdges, { userId: b.userId });
  const before = await t.run(async (ctx) => ctx.db.query("edges").collect());
  expect(before.length).toBe(4);

  const { deleted } = await t.mutation(internal.edges.clearEdges, {
    userId: a.userId,
  });
  expect(deleted).toBe(2);

  const after = await t.run(async (ctx) => ctx.db.query("edges").collect());
  expect(after.length).toBe(2);
  expect(after.every((e) => e.userId === b.userId)).toBe(true);
});
