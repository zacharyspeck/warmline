/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { SIGNUP_MAX_ATTEMPTS, SIGNUP_WINDOW_MS } from "./rateLimit";

const modules = import.meta.glob("./**/*.ts");

// Task 11: server-side signup rate limit — a per-identifier fixed window that
// blocks past the cap and passes under it.

test("rate limit: passes up to the cap, blocks past it", async () => {
  const t = convexTest(schema, modules);
  const email = "attacker@example.com";

  // Exactly SIGNUP_MAX_ATTEMPTS attempts all succeed (the pass case).
  for (let i = 0; i < SIGNUP_MAX_ATTEMPTS; i++) {
    await expect(
      t.mutation(api.rateLimit.recordSignupAttempt, { identifier: email }),
    ).resolves.toBeNull();
  }

  // The next one is blocked (the block case).
  await expect(
    t.mutation(api.rateLimit.recordSignupAttempt, { identifier: email }),
  ).rejects.toThrow(/Too many attempts/);
});

test("rate limit: identifiers are independent, and case/whitespace normalize", async () => {
  const t = convexTest(schema, modules);
  // Fill one identifier's window (case + whitespace variants share a bucket).
  for (let i = 0; i < SIGNUP_MAX_ATTEMPTS; i++) {
    await t.mutation(api.rateLimit.recordSignupAttempt, {
      identifier: i % 2 ? "  Victim@Example.com " : "victim@example.com",
    });
  }
  await expect(
    t.mutation(api.rateLimit.recordSignupAttempt, {
      identifier: "VICTIM@example.com",
    }),
  ).rejects.toThrow(/Too many attempts/);

  // A different identifier is unaffected (the pass case for others).
  await expect(
    t.mutation(api.rateLimit.recordSignupAttempt, {
      identifier: "someone-else@example.com",
    }),
  ).resolves.toBeNull();
});

test("rate limit: the window resets after it elapses", async () => {
  const t = convexTest(schema, modules);
  const email = "returning@example.com";
  for (let i = 0; i < SIGNUP_MAX_ATTEMPTS; i++) {
    await t.mutation(api.rateLimit.recordSignupAttempt, { identifier: email });
  }
  // Age the window past its end so the next attempt opens a fresh window.
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("signupAttempts")
      .withIndex("by_identifier", (q) => q.eq("identifier", email))
      .unique();
    await ctx.db.patch(row!._id, {
      windowStart: Date.now() - SIGNUP_WINDOW_MS - 1000,
    });
  });
  // A real person coming back after the window is never blocked.
  await expect(
    t.mutation(api.rateLimit.recordSignupAttempt, { identifier: email }),
  ).resolves.toBeNull();
});

test("rate limit: the purge cron drops stale rows but keeps fresh ones", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.rateLimit.recordSignupAttempt, { identifier: "fresh@example.com" });
  await t.mutation(api.rateLimit.recordSignupAttempt, { identifier: "stale@example.com" });
  // Age one row well past its window.
  await t.run(async (ctx) => {
    const stale = await ctx.db
      .query("signupAttempts")
      .withIndex("by_identifier", (q) => q.eq("identifier", "stale@example.com"))
      .unique();
    await ctx.db.patch(stale!._id, {
      windowStart: Date.now() - 2 * 60 * 60 * 1000, // 2h ago
    });
  });
  await t.mutation(internal.rateLimit.purgeStaleSignupAttempts, {});
  const remaining = await t.run(async (ctx) =>
    (await ctx.db.query("signupAttempts").collect()).map((r) => r.identifier),
  );
  expect(remaining).toEqual(["fresh@example.com"]);
});
