/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Seed a user with their own icp + person; return ids and an authed tester.
async function seed(t: ReturnType<typeof convexTest>) {
  const { userId, icpId, personId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "u@example.com" });
    const icpId = await ctx.db.insert("icp", {
      userId,
      text: "AI founders",
      source: {},
    });
    const personId = await ctx.db.insert("persons", {
      userId,
      name: "Han Wang",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    });
    return { userId, icpId, personId };
  });
  const as = t.withIdentity({ subject: `${userId}|s1` });
  return { userId, icpId, personId, as };
}

test("vote inserts a feedback row", async () => {
  const t = convexTest(schema, modules);
  const { icpId, personId, as } = await seed(t);

  const id = await as.mutation(api.feedback.vote, { icpId, personId, vote: "up" });
  expect(id).toBeTruthy();

  const rows = await t.run(async (ctx) => ctx.db.query("feedback").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].vote).toBe("up");
});

test("voting again for the same (icp, person) replaces — one row, new value", async () => {
  const t = convexTest(schema, modules);
  const { icpId, personId, as } = await seed(t);

  await as.mutation(api.feedback.vote, { icpId, personId, vote: "up" });
  await as.mutation(api.feedback.vote, { icpId, personId, vote: "down" });

  const rows = await t.run(async (ctx) => ctx.db.query("feedback").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].vote).toBe("down");
});

test("forIcp returns the votes for the icp", async () => {
  const t = convexTest(schema, modules);
  const { icpId, personId, as } = await seed(t);

  await as.mutation(api.feedback.vote, { icpId, personId, vote: "up" });

  const votes = await as.query(api.feedback.forIcp, { icpId });
  expect(votes).toEqual([{ personId, vote: "up" }]);
});

test("vote then state read-back: forIcp reflects each person's selected thumb", async () => {
  const t = convexTest(schema, modules);
  const { userId, icpId, personId, as } = await seed(t);
  const otherId = await t.run(async (ctx) =>
    ctx.db.insert("persons", {
      userId,
      name: "Mara Chen",
      isSelf: false,
      role: "lead",
      relationshipToYou: "not_connected",
    }),
  );

  await as.mutation(api.feedback.vote, { icpId, personId, vote: "up" });
  await as.mutation(api.feedback.vote, { icpId, personId: otherId, vote: "down" });

  const state = new Map(
    (await as.query(api.feedback.forIcp, { icpId })).map((v) => [
      v.personId,
      v.vote,
    ]),
  );
  expect(state.get(personId)).toBe("up");
  expect(state.get(otherId)).toBe("down");
});

test("cross-user: another user cannot vote on or read this icp", async () => {
  const t = convexTest(schema, modules);
  const { icpId, personId } = await seed(t);

  // A different, unrelated user.
  const otherUserId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "intruder@example.com" }),
  );
  const asOther = t.withIdentity({ subject: `${otherUserId}|s1` });

  await expect(
    asOther.mutation(api.feedback.vote, { icpId, personId, vote: "up" }),
  ).rejects.toThrow();
  // reading the other user's icp yields nothing
  expect(await asOther.query(api.feedback.forIcp, { icpId })).toEqual([]);
});
