import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// The public read-only demo reads this fixed account's network (Phase D). The
// pre-multi-user seed rows were migrated onto it in Phase B (the one-time
// backfill ran against the deployment and was removed once userId narrowed
// to required).
export const DEMO_EMAIL = "demo@warmline.app";

// Find or create the demo user account. Idempotent. Uses authTables' `email`
// index — a bounded scan would silently miss the demo row past the bound.
export const getOrCreateDemoUser = internalMutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("users", {
      email: DEMO_EMAIL,
      name: "Warmline Demo",
    });
  },
});

// Read-only demo-account lookup (the GET extension route must not create users).
export const demoUserId = internalQuery({
  args: {},
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx) => {
    const demo = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
      .first();
    return demo?._id ?? null;
  },
});

export const clearRecs = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const recs = await ctx.db.query("recommendations").collect();
    for (const r of recs) await ctx.db.delete(r._id);
    return { deleted: recs.length };
  },
});

// Clear a company field across persons (set to undefined).
export const clearCompany = internalMutation({
  args: { company: v.string() },
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("persons")
      .withIndex("by_company", (q) => q.eq("company", args.company))
      .take(500);
    for (const p of rows) await ctx.db.patch(p._id, { company: undefined });
    return { cleared: rows.length };
  },
});

// Rename a company across the graph (e.g. "Stealth" → "Stripe" for the demo).
export const renameCompany = internalMutation({
  args: { from: v.string(), to: v.string() },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    let updated = 0;
    const rows = await ctx.db
      .query("persons")
      .withIndex("by_company", (q) => q.eq("company", args.from))
      .take(500);
    for (const p of rows) {
      await ctx.db.patch(p._id, { company: args.to });
      updated++;
    }
    return { updated };
  },
});

// Dev helper: mark a user's already-uploaded sources as connected, so the
// Connectors page reflects the data that's already in the graph.
export const markSourcesConnected = internalMutation({
  args: { email: v.string() },
  returns: v.object({ inserted: v.number(), userId: v.string() }),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    if (!user) throw new Error(`no user with email ${args.email}`);

    const sources = [
      {
        provider: "linkedin" as const,
        method: "manual" as const,
        label: "LinkedIn data",
      },
      {
        provider: "twitter" as const,
        method: "manual" as const,
        label: "X data",
      },
      {
        provider: "extension" as const,
        method: "extension" as const,
        label: "Chrome extension",
      },
    ];
    let inserted = 0;
    for (const s of sources) {
      const existing = await ctx.db
        .query("connectors")
        .withIndex("by_user_provider", (q) =>
          q.eq("userId", user._id).eq("provider", s.provider),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("connectors", {
        userId: user._id,
        provider: s.provider,
        method: s.method,
        status: "active",
        label: s.label,
      });
      inserted++;
    }
    return { inserted, userId: user._id };
  },
});

// ── Local network seed ──────────────────────────────────────────────────────
// Produce a substantive, fully synthetic network so the feed shows ~20-50 rows
// locally with no OpenAI key: leads, connectors with fan-out, and bridge edges of
// the same shape the app expects. Every person is invented, with no real
// individual's private contact details. Companies are public brand names only.
// Run via `npx convex run devSeed:seedNetwork`.

const FIRST = [
  "Ava",
  "Noah",
  "Mia",
  "Leo",
  "Zoe",
  "Kai",
  "Ivy",
  "Ravi",
  "Nora",
  "Theo",
  "Lena",
  "Omar",
  "Sara",
  "Ben",
  "Priya",
  "Marco",
  "Anya",
  "Diego",
  "Iris",
  "Sam",
];
const LAST = [
  "Reyes",
  "Okafor",
  "Nakamura",
  "Bauer",
  "Silva",
  "Haddad",
  "Nguyen",
  "Costa",
  "Larsson",
  "Mehta",
  "Rossi",
  "Abara",
  "Kimura",
  "Novak",
  "Duarte",
  "Falk",
];
const COMPANIES = [
  "Stripe",
  "Notion",
  "Linear",
  "Vercel",
  "Ramp",
  "Figma",
  "Retool",
  "Airtable",
  "Amplitude",
  "Segment",
  "Datadog",
  "Snowflake",
  "Supabase",
  "Render",
];
const LEAD_ROLES = [
  "Head of Growth",
  "Founder",
  "VP Engineering",
  "Product Lead",
  "GTM Lead",
  "Head of Marketing",
  "Founding Engineer",
  "Head of Sales",
];
const CONNECTOR_TITLES = [
  "Investor",
  "Community Lead",
  "Developer Advocate",
  "Chief of Staff",
  "Ex-colleague",
  "Event Organizer",
];
const EVIDENCE: {
  type: "linkedin_mutual" | "engagement" | "shared_company" | "shared_school";
  make: (company: string) => string;
}[] = [
  { type: "shared_company", make: (co) => `Overlapped at ${co}` },
  {
    type: "linkedin_mutual",
    make: () => "Several mutual LinkedIn connections",
  },
  { type: "shared_school", make: () => "Studied together at Berkeley" },
  { type: "engagement", make: () => "Engages with their posts often" },
];

function personName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${
    LAST[(i * 3 + Math.floor(i / FIRST.length)) % LAST.length]
  }`;
}
function slugFor(name: string, i: number): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${i}`;
}

export const seedNetwork = internalMutation({
  args: {
    leads: v.optional(v.number()),
    connectors: v.optional(v.number()),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    userId: v.id("users"),
    persons: v.number(),
    edges: v.number(),
    leads: v.number(),
    connectors: v.number(),
  }),
  handler: async (ctx, args) => {
    const nLeads = args.leads ?? 34;
    const nConnectors = args.connectors ?? 12;

    // Resolve the owner: explicit arg, else the demo account (via the email index).
    let userId = args.userId;
    if (!userId) {
      const demo = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", DEMO_EMAIL))
        .first();
      userId =
        demo?._id ??
        (await ctx.db.insert("users", {
          email: DEMO_EMAIL,
          name: "Warmline Demo",
        }));
    }

    // Idempotent, per user: clear ONLY this user's network. Other users' data,
    // and the auth/users/connectors tables, are untouched. personVectors and
    // feedback carry no userId, so they are reached per owned person through
    // by_person — never by scanning other users' rows.
    const owned = await ctx.db
      .query("persons")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const p of owned) {
      const vectors = await ctx.db
        .query("personVectors")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .collect();
      for (const pv of vectors) await ctx.db.delete(pv._id);
      const votes = await ctx.db
        .query("feedback")
        .withIndex("by_person", (q) => q.eq("personId", p._id))
        .collect();
      for (const fb of votes) await ctx.db.delete(fb._id);
    }
    for (const r of await ctx.db
      .query("recommendations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect())
      await ctx.db.delete(r._id);
    for (const a of await ctx.db
      .query("attendance")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect())
      await ctx.db.delete(a._id);
    for (const e of await ctx.db
      .query("edges")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect())
      await ctx.db.delete(e._id);
    for (const ev of await ctx.db
      .query("events")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect())
      await ctx.db.delete(ev._id);
    for (const i of await ctx.db
      .query("icp")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect())
      await ctx.db.delete(i._id);
    for (const p of owned) await ctx.db.delete(p._id);

    // The goal (icp) — without it the app redirects to onboarding.
    await ctx.db.insert("icp", {
      userId,
      text: "Founders and heads of growth at Series A to C dev tools companies",
      source: {},
    });

    // Self.
    await ctx.db.insert("persons", {
      userId,
      name: "You",
      isSelf: true,
      role: "connector",
      relationshipToYou: "connected",
      tieStrength: 1,
    });

    // Leads.
    const leadIds: Id<"persons">[] = [];
    for (let i = 0; i < nLeads; i++) {
      const name = personName(i);
      const company = COMPANIES[i % COMPANIES.length];
      const role = LEAD_ROLES[i % LEAD_ROLES.length];
      const connected = i % 6 === 0;
      const id = await ctx.db.insert("persons", {
        userId,
        name,
        headline: `${role} at ${company}`,
        company,
        linkedinUrl: slugFor(name, i),
        isSelf: false,
        role: "lead",
        relationshipToYou: connected ? "connected" : "not_connected",
        ...(connected ? { tieStrength: 0.35 + (i % 4) * 0.12 } : {}),
      });
      leadIds.push(id);
    }

    // Connectors, each bridging to a spread of leads. The first is a wide
    // gatekeeper (the "Key" badge + a rich fan-out graph).
    let edges = 0;
    for (let c = 0; c < nConnectors; c++) {
      const name = personName(nLeads + c);
      const company = COMPANIES[(c + 5) % COMPANIES.length];
      const title = CONNECTOR_TITLES[c % CONNECTOR_TITLES.length];
      const fanout = c === 0 ? 12 : 2 + (c % 4);
      const targets = new Set<Id<"persons">>();
      for (let k = 0; k < fanout; k++) {
        targets.add(leadIds[(c * 5 + k * 3) % leadIds.length]);
      }
      const connId = await ctx.db.insert("persons", {
        userId,
        name,
        headline: `${title}, ex-${company}`,
        company,
        linkedinUrl: slugFor(name, nLeads + c),
        isSelf: false,
        role: "connector",
        relationshipToYou: "connected",
        tieStrength: 0.5 + (c % 5) * 0.1,
        unlockValue: targets.size,
      });
      for (const to of targets) {
        const ev = EVIDENCE[edges % EVIDENCE.length];
        await ctx.db.insert("edges", {
          userId,
          from: connId,
          to,
          type: ev.type,
          confidence: 0.55 + (edges % 4) * 0.1,
          evidence: ev.make(company),
        });
        edges++;
      }
    }

    return {
      userId,
      persons: nLeads + nConnectors + 1,
      edges,
      leads: nLeads,
      connectors: nConnectors,
    };
  },
});
