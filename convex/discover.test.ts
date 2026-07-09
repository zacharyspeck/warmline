/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  dayKey,
  TIER_LIMITS,
  GLOBAL_LIMITS,
  SCRAPE_PER_USER,
} from "./limits";
import { candidateUrls } from "./discover";

const modules = import.meta.glob("./**/*.ts");

// Task: target companies discover real people. Discovery scrapes each target
// company's team page once (shared scrape reserve), parses named people into
// deduped leads tagged discoveredFromWeb, records an honest per-company note,
// and re-ranks — with no real OpenAI/Firecrawl call except a stubbed one in the
// happy-path test.

async function newUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { email }));
  return { userId, as: t.withIdentity({ subject: `${userId}|s1` }) };
}

// Max out today's embed + judge budget so the scheduled rank pass degrades
// with zero OpenAI calls. Leaves scrape budget untouched.
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

test("candidateUrls: name → .com team/about guesses; a domain is used as-is", () => {
  expect(candidateUrls("Acme Corp")).toEqual([
    "https://acmecorp.com/team",
    "https://acmecorp.com/about",
  ]);
  expect(candidateUrls("stripe.com")).toEqual([
    "https://stripe.com/team",
    "https://stripe.com/about",
  ]);
  expect(candidateUrls("   ")).toEqual([]);
});

test("recordDiscovery: inserts web leads, promotes an existing colleague, writes a note", async () => {
  const t = convexTest(schema, modules);
  const { userId } = await newUser(t, "discover-record@example.com");
  // An existing same-company connection who should be promoted, not duplicated.
  await t.run(async (ctx) => {
    await ctx.db.insert("persons", {
      userId,
      name: "Jane Doe",
      company: "Acme",
      isSelf: false,
      role: "connector",
      relationshipToYou: "connected",
    });
  });

  const res = await t.mutation(internal.discover.recordDiscovery, {
    userId,
    company: "Acme",
    status: "found",
    people: [
      { name: "Alice Smith", role: "CEO" },
      { name: "Jane Doe", role: "Head of Sales" }, // already in-network
      { name: "Solo" }, // single token → skipped
    ],
  });
  expect(res).toEqual({ added: 1, promoted: 1 });

  const persons = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(persons.length).toBe(2); // Jane promoted in place; Alice inserted; Solo skipped
  const alice = persons.find((p) => p.name === "Alice Smith")!;
  expect(alice.role).toBe("lead");
  expect(alice.discoveredFromWeb).toBe(true);
  expect(alice.headline).toBe("CEO");
  expect(alice.company).toBe("Acme");
  const jane = persons.find((p) => p.name === "Jane Doe")!;
  expect(jane.role).toBe("lead");
  expect(jane.relationshipToYou).toBe("connected"); // stays in-network
  expect(jane.discoveredFromWeb).toBeUndefined(); // provenance not stamped on existing people

  const notes = await t
    .withIdentity({ subject: `${userId}|s1` })
    .query(api.discover.notesForGoal, {});
  expect(notes.length).toBe(1);
  expect(notes[0]).toMatchObject({ company: "Acme", status: "found", found: 2 });

  // A second run for the same company upserts the same note row.
  await t.mutation(internal.discover.recordDiscovery, {
    userId,
    company: "Acme",
    status: "no_people",
    people: [],
  });
  const after = await t
    .withIdentity({ subject: `${userId}|s1` })
    .query(api.discover.notesForGoal, {});
  expect(after.length).toBe(1);
  expect(after[0].status).toBe("no_people");
});

test("recordDiscovery: 'found' with no usable people is recorded honestly as no_people", async () => {
  const t = convexTest(schema, modules);
  const { userId } = await newUser(t, "discover-empty@example.com");
  const res = await t.mutation(internal.discover.recordDiscovery, {
    userId,
    company: "Ghost",
    status: "found",
    people: [{ name: "OneToken" }],
  });
  expect(res).toEqual({ added: 0, promoted: 0 });
  const notes = await t
    .withIdentity({ subject: `${userId}|s1` })
    .query(api.discover.notesForGoal, {});
  expect(notes[0].status).toBe("no_people");
});

test("discoverForGoal: out of scrape budget records a capped note and writes no people", async () => {
  const t = convexTest(schema, modules);
  const { userId } = await newUser(t, "discover-capped@example.com");
  // Exhaust the per-user scrape budget for today.
  await t.run(async (ctx) => {
    const day = dayKey(Date.now());
    await ctx.db.insert("usage", {
      userId: userId as never,
      day,
      judge: 0,
      embed: 0,
      scrape: SCRAPE_PER_USER,
    });
  });

  // A key IS configured here — the capped path is about budget, not setup.
  // (Keyless runs are gated out before the reserve; see the test below.)
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
  let fetched = false;
  vi.stubGlobal("fetch", async () => {
    fetched = true;
    throw new Error("no network when capped");
  });
  try {
    await t.action(internal.discover.discoverForGoal, {
      userId,
      companies: ["Acme"],
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
  expect(fetched).toBe(false);

  const persons = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(persons.length).toBe(0);
  const notes = await t
    .withIdentity({ subject: `${userId}|s1` })
    .query(api.discover.notesForGoal, {});
  expect(notes[0].status).toBe("capped");
});

test("discoverForGoal: no Firecrawl key gates out BEFORE any reserve — honest note, 0 budget, 0 leads", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "discover-nokey@example.com");

  // Whitespace-only key must read as NOT configured (the trim rule).
  vi.stubEnv("FIRECRAWL_API_KEY", "   ");
  let fetches = 0;
  vi.stubGlobal("fetch", async () => {
    fetches++;
    throw new Error("no network without a key");
  });
  try {
    await t.action(internal.discover.discoverForGoal, {
      userId,
      companies: ["Rogo", "Model ML"],
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  // No Firecrawl call was even attempted.
  expect(fetches).toBe(0);

  // ZERO scrape budget reserved: no usage row was ever created for the user.
  const usage = await t.run(async (ctx) =>
    ctx.db
      .query("usage")
      .withIndex("by_user_and_day", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(usage.reduce((sum, row) => sum + row.scrape, 0)).toBe(0);

  // Every company gets the truthful not-configured note (exact copy).
  const notes = await as.query(api.discover.notesForGoal, {});
  expect(notes.length).toBe(2);
  for (const n of notes) {
    expect(n.status).toBe("not_configured");
    expect(n.found).toBe(0);
    expect(n.note).toBe(
      "Company scraping is not set up yet, so no team pages were checked. Add people from this company by hand or capture them with the extension",
    );
  }

  // And zero leads were created.
  const persons = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
  expect(persons.length).toBe(0);
});

test("discoverForGoal: scrapes a team page, creates deduped leads, re-ranks", async () => {
  const t = convexTest(schema, modules);
  const { userId, as } = await newUser(t, "discover-happy@example.com");
  await t.run(async (ctx) =>
    ctx.db.insert("icp", { userId, text: "Meet AI founders", source: {} }),
  );
  await capOpenAI(t, userId); // rank pass degrades network-free

  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
  vi.stubEnv("OPENAI_API_KEY", "oa-test");
  vi.stubGlobal("fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("firecrawl")) {
      return new Response(
        JSON.stringify({
          data: { markdown: "# Team\nAlice Smith, CEO\nBob Jones, CTO" },
        }),
        { status: 200 },
      );
    }
    if (u.includes("openai.com")) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  people: [
                    { name: "Alice Smith", role: "CEO" },
                    { name: "Bob Jones", role: "CTO" },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.useFakeTimers();
  try {
    await t.action(internal.discover.discoverForGoal, {
      userId,
      companies: ["Acme"],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }

  const persons = await t.run(async (ctx) =>
    ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  );
  const names = persons.map((p) => p.name).sort();
  expect(names).toEqual(["Alice Smith", "Bob Jones"]);
  expect(persons.every((p) => p.discoveredFromWeb === true)).toBe(true);

  const notes = await as.query(api.discover.notesForGoal, {});
  expect(notes[0]).toMatchObject({ company: "Acme", status: "found", found: 2 });
});

test("notesForGoal: a user never sees another user's discovery notes", async () => {
  const t = convexTest(schema, modules);
  const a = await newUser(t, "discover-iso-a@example.com");
  const b = await newUser(t, "discover-iso-b@example.com");
  await t.mutation(internal.discover.recordDiscovery, {
    userId: a.userId,
    company: "Acme",
    status: "found",
    people: [{ name: "Alice Smith", role: "CEO" }],
  });
  expect((await a.as.query(api.discover.notesForGoal, {})).length).toBe(1);
  expect((await b.as.query(api.discover.notesForGoal, {})).length).toBe(0);
});
