import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

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
    const users = await ctx.db.query("users").take(200);
    const user = users.find((u) => u.email === args.email);
    if (!user) throw new Error(`no user with email ${args.email}`);

    const sources = [
      { provider: "linkedin" as const, method: "manual" as const, label: "LinkedIn data" },
      { provider: "twitter" as const, method: "manual" as const, label: "X data" },
      { provider: "extension" as const, method: "extension" as const, label: "Chrome extension" },
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
  "Ava", "Noah", "Mia", "Leo", "Zoe", "Kai", "Ivy", "Ravi", "Nora", "Theo",
  "Lena", "Omar", "Sara", "Ben", "Priya", "Marco", "Anya", "Diego", "Iris", "Sam",
];
const LAST = [
  "Reyes", "Okafor", "Nakamura", "Bauer", "Silva", "Haddad", "Nguyen", "Costa",
  "Larsson", "Mehta", "Rossi", "Abara", "Kimura", "Novak", "Duarte", "Falk",
];
const COMPANIES = [
  "Stripe", "Notion", "Linear", "Vercel", "Ramp", "Figma", "Retool", "Airtable",
  "Amplitude", "Segment", "Datadog", "Snowflake", "Supabase", "Render",
];
const LEAD_ROLES = [
  "Head of Growth", "Founder", "VP Engineering", "Product Lead", "GTM Lead",
  "Head of Marketing", "Founding Engineer", "Head of Sales",
];
const CONNECTOR_TITLES = [
  "Investor", "Community Lead", "Developer Advocate", "Chief of Staff",
  "Ex-colleague", "Event Organizer",
];
const EVIDENCE: {
  type:
    | "linkedin_mutual"
    | "engagement"
    | "shared_company"
    | "shared_school";
  make: (company: string) => string;
}[] = [
  { type: "shared_company", make: (co) => `Overlapped at ${co}` },
  { type: "linkedin_mutual", make: () => "Several mutual LinkedIn connections" },
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
  args: { leads: v.optional(v.number()), connectors: v.optional(v.number()) },
  returns: v.object({
    persons: v.number(),
    edges: v.number(),
    leads: v.number(),
    connectors: v.number(),
  }),
  handler: async (ctx, args) => {
    const nLeads = args.leads ?? 34;
    const nConnectors = args.connectors ?? 12;

    // Idempotent: clear the Warmline domain tables (auth/users/connectors untouched).
    for (const table of [
      "recommendations",
      "feedback",
      "attendance",
      "edges",
      "personVectors",
      "persons",
      "events",
      "icp",
    ] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id);
      }
    }

    // The goal (icp) — without it the app redirects to onboarding.
    await ctx.db.insert("icp", {
      text: "Founders and heads of growth at Series A to C dev tools companies",
      source: {},
    });

    // Self.
    await ctx.db.insert("persons", {
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
      persons: nLeads + nConnectors + 1,
      edges,
      leads: nLeads,
      connectors: nConnectors,
    };
  },
});
