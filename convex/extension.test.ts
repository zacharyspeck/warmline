/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sha256Hex } from "./extensionAuth";
import { CAPTURE_MAX_PER_WINDOW } from "./rateLimit";
import { dayKey, TIER_LIMITS, GLOBAL_LIMITS } from "./limits";

const modules = import.meta.glob("./**/*.ts");

// Task: revive the extension. Scoped token auth, user-initiated capture that
// promotes-not-duplicates the lead and forms mutual edges, per-user rate limit,
// and the HTTP capture route — all without any OpenAI call (embed + judge
// budgets pre-spent so the scheduled rank pass degrades).

async function newUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|s1` }) };
}

async function capOpenAI(t: ReturnType<typeof convexTest>, userId: string) {
  await t.run(async (ctx) => {
    const day = dayKey(Date.now());
    await ctx.db.insert("usage", {
      userId: userId as never,
      day,
      judge: TIER_LIMITS.free.judge,
      embed: TIER_LIMITS.free.embed,
      scrape: 0,
    });
    await ctx.db.insert("usageGlobal", {
      day,
      judge: GLOBAL_LIMITS.judge,
      embed: GLOBAL_LIMITS.embed,
      scrape: 0,
    });
  });
}

test("token: mint resolves to the owner; regenerating replaces the old one", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "tok@example.com");

  const { token } = await as.action(api.extensionAuth.generateToken, {});
  expect(token.startsWith("wl_")).toBe(true);
  const hash1 = await sha256Hex(token);
  expect(
    await t.query(internal.extensionAuth.resolveToken, { tokenHash: hash1 }),
  ).toEqual(userId);

  const status1 = await as.query(api.extensionAuth.status, {});
  expect(status1.connected).toBe(true);

  // Regenerate: the old hash stops resolving, the new one resolves.
  const { token: token2 } = await as.action(
    api.extensionAuth.generateToken,
    {},
  );
  expect(token2).not.toEqual(token);
  expect(
    await t.query(internal.extensionAuth.resolveToken, { tokenHash: hash1 }),
  ).toBeNull();
  expect(
    await t.query(internal.extensionAuth.resolveToken, {
      tokenHash: await sha256Hex(token2),
    }),
  ).toEqual(userId);

  // Revoke disconnects.
  await as.mutation(api.extensionAuth.revokeToken, {});
  expect(
    await t.query(internal.extensionAuth.resolveToken, {
      tokenHash: await sha256Hex(token2),
    }),
  ).toBeNull();
  expect((await as.query(api.extensionAuth.status, {})).connected).toBe(false);
});

test("token: never resolves across users", async () => {
  const t = convexTest(schema, modules);
  const a = await newUser(t, "iso-a@example.com");
  await newUser(t, "iso-b@example.com");
  const { token } = await a.as.action(api.extensionAuth.generateToken, {});
  const owner = await t.query(internal.extensionAuth.resolveToken, {
    tokenHash: await sha256Hex(token),
  });
  expect(owner).toEqual(a.userId);
});

test("capture: promotes a known connector to a lead and forms mutual edges", async () => {
  const t = convexTest(schema, modules);
  const { userId } = await newUser(t, "cap@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} });
    // A connector the user already knows (a mutual on the target's profile).
    await ctx.db.insert("persons", {
      userId,
      name: "Bridge Person",
      linkedinUrl: "bridge",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
  });
  await capOpenAI(t, userId);

  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no OpenAI in this test");
  });
  vi.useFakeTimers();
  try {
    const res = await t.mutation(internal.extension.captureProfile, {
      userId,
      leadSlug: "target",
      leadName: "Target Person",
      mutuals: [
        { name: "Bridge Person", slug: "bridge" },
        { name: "Target Person", slug: "target" }, // self-mutual, ignored
      ],
    });
    expect(res).toMatchObject({ edges: 1, shown: 1, matched: 1, skipped: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  const { persons, edges } = await t.run(async (ctx) => {
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return { persons, edges };
  });
  // Bridge (connector) + Target (new lead), no duplicate.
  expect(persons.length).toBe(2);
  const target = persons.find((p) => p.linkedinUrl === "target");
  expect(target?.role).toBe("lead");
  const mutualEdges = edges.filter((e) => e.type === "linkedin_mutual");
  expect(mutualEdges.length).toBe(1);

  // Re-capture is idempotent: no duplicate edge.
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no OpenAI");
  });
  vi.useFakeTimers();
  try {
    await t.mutation(internal.extension.captureProfile, {
      userId,
      leadSlug: "target",
      leadName: "Target Person",
      mutuals: [{ name: "Bridge Person", slug: "bridge" }],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  const edgeCount = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("edges")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).filter((e) => e.type === "linkedin_mutual").length,
  );
  expect(edgeCount).toBe(1);
});

test("capture: per-user rate limit blocks past the cap", async () => {
  const t = convexTest(schema, modules);
  const { userId } = await newUser(t, "cap-rl@example.com");
  // Pre-fill the capture window to the cap.
  await t.run(async (ctx) => {
    await ctx.db.insert("signupAttempts", {
      identifier: `ext:${userId}`,
      windowStart: Date.now(),
      count: CAPTURE_MAX_PER_WINDOW,
    });
  });
  await expect(
    t.mutation(internal.extension.captureProfile, {
      userId,
      leadSlug: "x",
      mutuals: [],
    }),
  ).rejects.toThrow(/Too many/);
});

test("capture: name-only mutuals resolve against existing connectors", async () => {
  const t = convexTest(schema, modules);
  const { userId } = await newUser(t, "names@example.com");
  await t.run(async (ctx) => {
    await ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} });
    for (const [name, slug] of [
      ["Phil Smith", "phil-smith"],
      ["Fred Jones", "fred-jones"],
      ["Phil Adams", "phil-adams"], // a second Phil → first-name "phil" is ambiguous
    ]) {
      await ctx.db.insert("persons", {
        userId,
        name,
        linkedinUrl: slug,
        isSelf: false,
        role: "connector",
        relationshipToYou: "connected",
      });
    }
  });
  await capOpenAI(t, userId);

  let res;
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no OpenAI");
  });
  vi.useFakeTimers();
  try {
    res = await t.mutation(internal.extension.captureProfile, {
      userId,
      leadSlug: "troymartig",
      leadName: "Troy Martig",
      mutuals: [
        { name: "Phil Smith" }, // exact full name → unique
        { name: "Fred" }, // first name → unique (only one Fred)
        { name: "Phil" }, // first name → ambiguous (two Phils) → skip
        { name: "Nobody Here" }, // no match → skip
      ],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(res).toMatchObject({ shown: 4, matched: 2, skipped: 2, edges: 2 });

  // The two matched connectors bridge to the new lead; no name-only person was
  // created (we never invent a slug we don't have).
  const { lead, edges, personCount } = await t.run(async (ctx) => {
    const lead = await ctx.db
      .query("persons")
      .withIndex("by_user_and_linkedinUrl", (q) =>
        q.eq("userId", userId).eq("linkedinUrl", "troymartig"),
      )
      .first();
    const edges = await ctx.db
      .query("edges")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const persons = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return { lead, edges, personCount: persons.length };
  });
  expect(lead?.role).toBe("lead");
  expect(edges.filter((e) => e.type === "linkedin_mutual").length).toBe(2);
  // 3 connectors + 1 new lead, nothing invented for "Phil"/"Nobody Here".
  expect(personCount).toBe(4);
});

test("http capture: 401 without a token, 200 with a valid token", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "http@example.com");
  await t.run(async (ctx) =>
    ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} }),
  );
  await capOpenAI(t, userId);
  const { token } = await as.action(api.extensionAuth.generateToken, {});

  // No token → 401.
  const noAuth = await t.fetch("/extension/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadSlug: "target", mutuals: [] }),
  });
  expect(noAuth.status).toBe(401);

  // Bad token → 401.
  const badAuth = await t.fetch("/extension/capture", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer wl_not_a_real_token",
    },
    body: JSON.stringify({ leadSlug: "target", mutuals: [] }),
  });
  expect(badAuth.status).toBe(401);

  // Valid token → 200, creates the lead.
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    throw new Error("no OpenAI");
  });
  vi.useFakeTimers();
  try {
    const ok = await t.fetch("/extension/capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        leadSlug: "target",
        leadName: "Target Person",
        mutuals: [{ name: "Bridge", slug: "bridge" }],
      }),
    });
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.edges).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  const lead = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user_and_linkedinUrl", (q) =>
        q.eq("userId", userId).eq("linkedinUrl", "target"),
      )
      .first(),
  );
  expect(lead?.role).toBe("lead");
});
