/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("needingAvatars: the owner's avatar-less people with a handle/slug, top by tie strength", async () => {
  const t = convexTest(schema, modules);
  const { userId, ids, foreign } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "av@example.com" });
    const otherId = await ctx.db.insert("users", { email: "ov@example.com" });
    const mk = (
      owner: typeof userId,
      name: string,
      extra: {
        avatarUrl?: string;
        linkedinUrl?: string;
        xHandle?: string;
        tieStrength?: number;
      },
    ) =>
      ctx.db.insert("persons", {
        userId: owner,
        name,
        isSelf: false,
        role: "lead" as const,
        relationshipToYou: "not_connected" as const,
        ...extra,
      });
    const ids = {
      hasAvatar: await mk(userId, "Has Avatar", {
        avatarUrl: "https://x/y.png",
        linkedinUrl: "has",
        tieStrength: 1,
      }),
      noHandle: await mk(userId, "No Handle", { tieStrength: 1 }),
      top: await mk(userId, "Top Tie", { linkedinUrl: "top", tieStrength: 0.9 }),
      mid: await mk(userId, "Mid Tie", { xHandle: "midtie", tieStrength: 0.5 }),
      low: await mk(userId, "Low Tie", { linkedinUrl: "low", tieStrength: 0.1 }),
    };
    // Another user's person with the strongest tie — must never be picked.
    const foreign = await mk(otherId, "Foreign Top", {
      linkedinUrl: "foreign",
      tieStrength: 1,
    });
    return { userId, ids, foreign };
  });

  const picked = await t.query(internal.avatars.needingAvatars, {
    userId,
    limit: 2,
  });
  // Highest tie first; the already-avatared, handle-less, and foreign people
  // are excluded.
  expect(picked.map((p) => p.id)).toEqual([ids.top, ids.mid]);
  expect(picked.map((p) => p.id)).not.toContain(foreign);
  expect(picked[0].slug).toBe("top");
  expect(picked[1].xHandle).toBe("midtie");
});

test("setAvatar refuses to patch another user's person", async () => {
  const t = convexTest(schema, modules);
  const { userId, otherId, personId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "a@example.com" });
    const otherId = await ctx.db.insert("users", { email: "b@example.com" });
    const personId = await ctx.db.insert("persons", {
      userId,
      name: "Owned Person",
      isSelf: false,
      role: "lead" as const,
      relationshipToYou: "not_connected" as const,
    });
    return { userId, otherId, personId };
  });

  await expect(
    t.mutation(internal.avatars.setAvatar, {
      personId,
      userId: otherId,
      url: "https://x/evil.png",
    }),
  ).rejects.toThrow(/Person not found/);

  // The right owner succeeds.
  await t.mutation(internal.avatars.setAvatar, {
    personId,
    userId,
    url: "https://x/ok.png",
  });
  const p = await t.run(async (ctx) => ctx.db.get(personId));
  expect(p?.avatarUrl).toBe("https://x/ok.png");
});
