import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Local demo-data loader. Maps seed/demo-data.json (the `zach/demo-data` contract)
// into main's real Convex schema in ONE atomic pass, so the feed renders locally
// with no OpenAI key. Public (like convex/ingest.ts) so the local Convex client in
// scripts/loadDemo.mjs can reach it — keep this deployment private.
//
// Idempotent: clears the Warmline DOMAIN tables first (auth / users are NEVER
// touched), so re-running re-seeds cleanly instead of duplicating.

// Shape of the demo JSON (seed/demo-data.json). Loosely typed — every field is
// optional because the loader defends against partial datasets — but typed enough
// to drop the `any` casts the untyped `v.any()` arg would otherwise force.
type DemoEdge = {
  from_id: string;
  to_id: string;
  type?: string;
  confidence: number;
  evidence: string;
  judge_kicker?: boolean;
};
type DemoPerson = {
  id: string;
  name: string;
  headline?: string | null;
  company?: string | null;
  linkedin_url?: string | null;
  x_handle?: string | null;
  is_self?: boolean;
  roles?: string[];
};
type DemoEvent = {
  id: string;
  name: string;
  date?: number;
  attendee_ids?: string[];
};
type DemoRec = {
  person_id: string;
  type?: string;
  score?: number;
  reason_bullets?: string[];
  how?: { channel?: string; angle?: string; drafted_opener?: string };
  unlocks_ids?: string[];
  trigger?: string;
};
type DemoGoal = { text: string };
type DemoData = {
  flags?: { include_judge_edges?: boolean };
  edges?: DemoEdge[];
  people?: DemoPerson[];
  events?: DemoEvent[];
  recommendations?: DemoRec[];
  goals?: DemoGoal[];
};

// Demo `roles[]` tags that become a `connector` in the app's 2-role model;
// everything else (fanout / judge / go_cold) becomes a `lead`.
const CONNECTOR_ROLES = new Set(["self", "gatekeeper", "judge_bridge", "support"]);

// The app stores a LinkedIn *slug* (the UI rebuilds the full URL), but the demo
// stores full URLs — strip "https://linkedin.com/in/handotdev" → "handotdev".
function toSlug(url?: string | null): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

function roleOf(roles: string[]): "lead" | "connector" {
  return roles.some((r) => CONNECTOR_ROLES.has(r)) ? "connector" : "lead";
}

export const loadDemo = mutation({
  args: { data: v.any() },
  returns: v.object({
    persons: v.number(),
    edges: v.number(),
    events: v.number(),
    attendance: v.number(),
    recommendations: v.number(),
    icpId: v.id("icp"),
  }),
  handler: async (ctx, { data }) => {
    const d = data as DemoData;
    // The dataset's judge toggle (true in the shipped data). When false, judge
    // people + judge_kicker edges are dropped; the 12-wide hero path stays intact.
    const includeJudge = d.flags?.include_judge_edges !== false;

    // ── 1. Clear Warmline domain tables (auth `users`, `numbers`, `connectors` untouched) ──
    const domainTables = [
      "recommendations",
      "feedback",
      "attendance",
      "edges",
      "personVectors",
      "persons",
      "events",
      "icp",
    ] as const;
    for (const table of domainTables) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(row._id);
      }
    }

    // ── 2. Precompute derived fields the demo doesn't store ──
    // (a) who is directly connected to you = has a self→X 1st-degree edge.
    const connectedSlugs = new Set<string>();
    for (const e of d.edges ?? []) {
      if (e.from_id === "self" && e.type === "linkedin_1st") {
        connectedSlugs.add(e.to_id);
      }
    }
    // (b) gatekeeper unlock count = the rec's fan-out size (Han → 12).
    const gatekeeperUnlocks = new Map<string, number>();
    for (const r of d.recommendations ?? []) {
      if (r.type === "gatekeeper") {
        gatekeeperUnlocks.set(r.person_id, (r.unlocks_ids ?? []).length);
      }
    }
    // (c) fallback unlock count for other connectors = outgoing bridge edges.
    const bridgeOut = new Map<string, number>();
    for (const e of d.edges ?? []) {
      if (e.type === "co_attended_event") {
        bridgeOut.set(e.from_id, (bridgeOut.get(e.from_id) ?? 0) + 1);
      }
    }

    // ── 3. People → persons (build slug→_id map for edges/recs) ──
    const idBySlug = new Map<string, Id<"persons">>();
    let persons = 0;
    for (const p of d.people ?? []) {
      const roles: string[] = p.roles ?? [];
      if (!includeJudge && roles.includes("judge")) continue;
      const role = roleOf(roles);
      const connected = !!p.is_self || connectedSlugs.has(p.id);
      let unlockValue: number | undefined;
      if (role === "connector" && !p.is_self) {
        unlockValue = gatekeeperUnlocks.get(p.id) ?? bridgeOut.get(p.id);
        if (!unlockValue) unlockValue = undefined; // omit 0/undefined
      }
      const _id = await ctx.db.insert("persons", {
        name: p.name,
        headline: p.headline ?? undefined,
        company: p.company ?? undefined,
        linkedinUrl: toSlug(p.linkedin_url),
        xHandle: p.x_handle ?? undefined,
        isSelf: !!p.is_self,
        role,
        relationshipToYou: connected ? "connected" : "not_connected",
        ...(unlockValue !== undefined ? { unlockValue } : {}),
      });
      idBySlug.set(p.id, _id);
      persons++;
    }

    // ── 4. Events → events (+ attendance from attendee_ids) ──
    const eventIdBySlug = new Map<string, Id<"events">>();
    let events = 0;
    for (const ev of d.events ?? []) {
      const _id = await ctx.db.insert("events", {
        name: ev.name,
        ...(typeof ev.date === "number" ? { date: ev.date } : {}),
      });
      eventIdBySlug.set(ev.id, _id);
      events++;
    }
    let attendance = 0;
    for (const ev of d.events ?? []) {
      const eventId = eventIdBySlug.get(ev.id);
      if (!eventId) continue;
      for (const slug of ev.attendee_ids ?? []) {
        const personId = idBySlug.get(slug);
        if (!personId) continue; // judge person skipped when toggle off
        await ctx.db.insert("attendance", { personId, eventId, confidence: 1 });
        attendance++;
      }
    }

    // ── 5. Edges → edges: only the connector→lead BRIDGES. The self→X 1st-degree
    //    edges are encoded as relationshipToYou:"connected" (step 3) instead, keeping
    //    `edges` as bridges (the schema's design). Insert order is dataset order, so
    //    Han's 12 fan-out land before the judge edge → the 12-node graph shows the heroes.
    let edges = 0;
    for (const e of d.edges ?? []) {
      if (e.from_id === "self") continue; // direct connection, not a bridge
      if (e.judge_kicker && !includeJudge) continue;
      const from = idBySlug.get(e.from_id);
      const to = idBySlug.get(e.to_id);
      if (!from || !to) continue; // a judge endpoint skipped when toggle off
      await ctx.db.insert("edges", {
        from,
        to,
        // The app's edge enum has no `co_attended_event`; no read path reads `type`
        // (the feed/graph show `evidence` + confidence), so the real meaning lives
        // in `evidence` ("Both attended Mintlify Gala, …").
        type: "engagement",
        confidence: e.confidence,
        evidence: e.evidence,
      });
      edges++;
    }

    // ── 6. Goal → icp (REQUIRED — without it the app redirects to /onboarding) ──
    const goal = (d.goals ?? [])[0] ?? { text: "Break into SF dev tools" };
    const icpId = await ctx.db.insert("icp", { text: goal.text, source: {} });

    // ── 7. Recommendations → recommendations (the 2 hero cards) ──
    let recommendations = 0;
    for (const r of d.recommendations ?? []) {
      const personId = idBySlug.get(r.person_id);
      if (!personId) continue;
      const how: string[] = [];
      if (r.how?.channel) how.push(r.how.channel);
      if (r.how?.angle) how.push(r.how.angle);
      const unlocksIds = (r.unlocks_ids ?? [])
        .map((s) => idBySlug.get(s))
        .filter((x): x is Id<"persons"> => !!x);
      await ctx.db.insert("recommendations", {
        personId,
        icpId,
        kind: r.type === "gatekeeper" ? "connector" : "lead",
        // demo score is 0–1; the feed sorts recs against a 0–100 heuristic.
        score: Math.round((r.score ?? 0) * 100),
        // demo bullets are plain strings; the schema wants a confidence per bullet
        // (only sets the dot color) — assign a single high value.
        whyBullets: (r.reason_bullets ?? []).map((text) => ({
          text,
          confidence: 0.85,
        })),
        how,
        opener: r.how?.drafted_opener ?? "",
        unlocksIds,
        ...(r.trigger ? { whyNow: r.trigger } : {}),
      });
      recommendations++;
    }

    return { persons, edges, events, attendance, recommendations, icpId };
  },
});
