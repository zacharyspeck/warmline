/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { dayKey, TIER_LIMITS, SCRAPE_PER_USER } from "./limits";

const modules = import.meta.glob("./**/*.ts");

// Task S1.6: the Settings Plan section reads api.usage.myUsage — tier + today's
// own spend against the caller's caps, read-only.

async function newUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|s1` }) };
}

test("myUsage: signed out returns null", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.usage.myUsage, {})).toBeNull();
});

test("myUsage: default free tier, zero used, free caps", async () => {
  const t = convexTest(schema, modules);
  const { as } = await newUser(t, "plan-free@example.com");
  const res = await as.query(api.usage.myUsage, {});
  expect(res).toEqual({
    tier: "free",
    used: { judge: 0, embed: 0, scrape: 0 },
    caps: {
      judge: TIER_LIMITS.free.judge,
      embed: TIER_LIMITS.free.embed,
      scrape: SCRAPE_PER_USER,
    },
  });
});

test("myUsage: reflects today's usage row and the caller's tier", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "plan-pro@example.com");
  await t.run(async (ctx) => {
    await ctx.db.patch(userId, { tier: "pro" });
    await ctx.db.insert("usage", {
      userId,
      day: dayKey(Date.now()),
      judge: 7,
      embed: 12,
      scrape: 1,
    });
  });
  const res = await as.query(api.usage.myUsage, {});
  expect(res).toEqual({
    tier: "pro",
    used: { judge: 7, embed: 12, scrape: 1 },
    caps: {
      judge: TIER_LIMITS.pro.judge,
      embed: TIER_LIMITS.pro.embed,
      scrape: SCRAPE_PER_USER,
    },
  });
});

test("myUsage: isolation — only the caller's own usage is returned", async () => {
  const t = convexTest(schema, modules);
  const a = await newUser(t, "plan-a@example.com");
  const b = await newUser(t, "plan-b@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("usage", {
      userId: a.userId,
      day: dayKey(Date.now()),
      judge: 5,
      embed: 5,
      scrape: 5,
    });
  });
  // b has no usage row of their own.
  const res = await b.as.query(api.usage.myUsage, {});
  expect(res?.used).toEqual({ judge: 0, embed: 0, scrape: 0 });
});
