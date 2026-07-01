/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { cosine, nudgeVector } from "./lib";

const modules = import.meta.glob("./**/*.ts");

// personVectors carries a 1536-dim vector index, so build full-width sparse
// vectors (mostly zero) rather than tiny ones.
const DIM = 1536;
function vec(nonzero: Record<number, number>): number[] {
  const a = new Array(DIM).fill(0);
  for (const [i, val] of Object.entries(nonzero)) a[Number(i)] = val;
  return a;
}

const VOTE_NUDGE = 0.15; // mirrors the constant in rank.ts

test("voteVectors: joins thumbs to cached person vectors, skips missing", async () => {
  const t = convexTest(schema, modules);
  const { icpId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "rank@example.com" });
    const icpId = await ctx.db.insert("icp", {
      userId,
      text: "AI founders",
      source: {},
    });
    const mk = async (name: string, emb: number[] | null) => {
      const id = await ctx.db.insert("persons", {
        userId,
        name,
        isSelf: false,
        role: "lead" as const,
        relationshipToYou: "not_connected" as const,
      });
      if (emb)
        await ctx.db.insert("personVectors", { personId: id, embedding: emb });
      return id;
    };
    const upId = await mk("Up Person", vec({ 1: 1 }));
    const downId = await mk("Down Person", vec({ 2: 1 }));
    const noVecId = await mk("No Vector", null); // voted but no cached vector
    await ctx.db.insert("feedback", { icpId, personId: upId, vote: "up" });
    await ctx.db.insert("feedback", { icpId, personId: downId, vote: "down" });
    await ctx.db.insert("feedback", { icpId, personId: noVecId, vote: "up" });
    return { icpId };
  });

  const { up, down } = await t.query(internal.rank.voteVectors, { icpId });
  // the up-voted person with a cached vector; the no-vector person is skipped
  expect(up).toEqual([vec({ 1: 1 })]);
  expect(down).toEqual([vec({ 2: 1 })]);
});

test("voteVectors: a feedback row pointing at another user's person is ignored", async () => {
  const t = convexTest(schema, modules);
  const { icpId } = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { email: "own@example.com" });
    const otherId = await ctx.db.insert("users", { email: "oth@example.com" });
    const icpId = await ctx.db.insert("icp", {
      userId: ownerId,
      text: "AI founders",
      source: {},
    });
    // A directly inserted feedback row referencing a foreign person: its cached
    // vector must never bend this icp's ranking.
    const foreign = await ctx.db.insert("persons", {
      userId: otherId,
      name: "Foreign Person",
      isSelf: false,
      role: "lead" as const,
      relationshipToYou: "not_connected" as const,
    });
    await ctx.db.insert("personVectors", {
      personId: foreign,
      embedding: vec({ 3: 1 }),
    });
    await ctx.db.insert("feedback", { icpId, personId: foreign, vote: "up" });
    return { icpId };
  });

  const { up, down } = await t.query(internal.rank.voteVectors, { icpId });
  expect(up).toEqual([]);
  expect(down).toEqual([]);
});

test("nudge drops a down-voted lead's goal-fit on the next rebuild", async () => {
  const t = convexTest(schema, modules);
  const icpVector = vec({ 0: 1 });
  const { icpId, leadVec } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "nudge@example.com" });
    const icpId = await ctx.db.insert("icp", {
      userId,
      text: "x",
      source: {},
      vector: icpVector,
    });
    const leadVec = vec({ 2: 1 });
    const leadId = await ctx.db.insert("persons", {
      userId,
      name: "Rejected Lead",
      isSelf: false,
      role: "lead" as const,
      relationshipToYou: "not_connected" as const,
    });
    await ctx.db.insert("personVectors", {
      personId: leadId,
      embedding: leadVec,
    });
    await ctx.db.insert("feedback", { icpId, personId: leadId, vote: "down" });
    return { icpId, leadVec };
  });

  // Reproduce rebuild's scoring: nudge the ICP vector by the thumbs, then the
  // down-voted lead's goal-fit against the nudged vector must be lower.
  const { up, down } = await t.query(internal.rank.voteVectors, { icpId });
  const scoringVector = nudgeVector(icpVector, up, down, VOTE_NUDGE);

  const goalFit = (v: number[]) => (cosine(leadVec, v) + 1) / 2;
  expect(goalFit(scoringVector)).toBeLessThan(goalFit(icpVector));
});
