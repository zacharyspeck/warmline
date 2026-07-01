import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// The schema is normally optional, but Convex Auth
// requires indexes defined on `authTables`.
// The schema provides more precise TypeScript types.
export const connectorProvider = v.union(
  v.literal("google"),
  v.literal("linkedin"),
  v.literal("instagram"),
  v.literal("twitter"),
  v.literal("outlook"),
  v.literal("luma"),
  v.literal("extension"),
);

export const connectorMethod = v.union(
  v.literal("oauth"),
  v.literal("manual"),
  v.literal("auto"),
  v.literal("extension"),
);

export default defineSchema({
  ...authTables,
  // authTables' users, widened with the Phase E spend tier. The field list and
  // indexes must mirror @convex-dev/auth's definition exactly; only `tier` is
  // ours. tier is a plain string normalized at READ (absent → "free"); a value
  // missing from convex/limits.ts TIER_LIMITS gets zero budget, fail-closed.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    tier: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),
  numbers: defineTable({
    value: v.number(),
  }),

  // ── Phase E cost caps (see convex/limits.ts for every cap) ──

  // Per-user OpenAI/scrape spend, one row per user per UTC day. The day key
  // rollover IS the daily reset — old rows just stop being read.
  usage: defineTable({
    userId: v.id("users"),
    day: v.string(), // dayKey(now), "YYYY-MM-DD" UTC
    judge: v.number(),
    embed: v.number(),
    scrape: v.number(),
  })
    .index("by_user_and_day", ["userId", "day"])
    .index("by_day", ["day"]),

  // Global spend across all users, one row per UTC day — makes the global-cap
  // check O(1) inside the reserve transaction.
  usageGlobal: defineTable({
    day: v.string(),
    judge: v.number(),
    embed: v.number(),
    scrape: v.number(),
  }).index("by_day", ["day"]),

  // A source the user has linked to make their network searchable.
  // OAuth providers store an accountEmail; manual/auto exports store a
  // fileName + human label (e.g. "LinkedIn data").
  connectors: defineTable({
    userId: v.id("users"),
    provider: connectorProvider,
    method: connectorMethod,
    status: v.literal("active"),
    label: v.string(),
    accountEmail: v.optional(v.string()),
    fileName: v.optional(v.string()),
    // The stored export file (manual/auto). Parsing into the graph is future work.
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"]),

  // ── Warmline core ──
  // See plan.md (model) + CONTEXT.md (glossary) +
  // artifacts/2026-06-28-warmline-schema.html (this contract).

  // Graph nodes — people (You, Leads, Connectors).
  persons: defineTable({
    // Owner of this row. Every domain row belongs to exactly one user; the
    // pre-multi-user seed was backfilled to the demo account in Phase B.
    userId: v.id("users"),
    name: v.string(),
    headline: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    xHandle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    isSelf: v.boolean(),
    // Two roles only: lead (who you want) or connector (who bridges you to them).
    role: v.union(v.literal("lead"), v.literal("connector")),
    // In/out of your network → "ask directly" vs "befriend first".
    relationshipToYou: v.union(
      v.literal("connected"),
      v.literal("not_connected"),
    ),
    // Precomputed at ingest from messages.csv (who you actually talk to).
    tieStrength: v.optional(v.number()),
    // # of goal-Leads this connector can reach (ranking signal).
    unlockValue: v.optional(v.number()),
    // Extension resume cursor — which Leads still need mutuals pulled.
    mutualsStatus: v.optional(
      v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    ),
  })
    .index("by_linkedinUrl", ["linkedinUrl"])
    .index("by_xHandle", ["xHandle"])
    .index("by_role", ["role"])
    .index("by_company", ["company"])
    .index("by_mutualsStatus", ["mutualsStatus"])
    .index("by_user", ["userId"])
    .index("by_user_and_role", ["userId", "role"])
    .index("by_user_and_company", ["userId", "company"])
    .index("by_user_and_linkedinUrl", ["userId", "linkedinUrl"])
    .index("by_user_and_xHandle", ["userId", "xHandle"]),

  // Relationships (bridges). NOT co_attended_event — events are a channel, not a relationship.
  edges: defineTable({
    userId: v.id("users"),
    from: v.id("persons"),
    to: v.id("persons"),
    type: v.union(
      v.literal("linkedin_mutual"),
      v.literal("x_mutual_follow"),
      v.literal("engagement"),
      v.literal("shared_company"),
      v.literal("shared_school"),
    ),
    confidence: v.number(), // 0–1
    evidence: v.string(), // "Sarah liked 3 of their posts last month"
  })
    .index("by_from", ["from"])
    .index("by_to", ["to"])
    .index("by_type", ["type"])
    .index("by_from_and_type", ["from", "type"])
    .index("by_user", ["userId"])
    .index("by_user_and_type", ["userId", "type"]),

  // "Go meet them" channel — not a who-knows-whom proxy.
  events: defineTable({
    userId: v.id("users"),
    name: v.string(),
    date: v.optional(v.number()),
  })
    .index("by_name", ["name"])
    .index("by_user", ["userId"])
    .index("by_user_and_name", ["userId", "name"]),

  // Join: person × event, carrying attendance-confidence ("will they actually be there").
  attendance: defineTable({
    userId: v.id("users"),
    personId: v.id("persons"),
    eventId: v.id("events"),
    confidence: v.number(), // 0–1
  })
    .index("by_person", ["personId"])
    .index("by_event", ["eventId"])
    .index("by_person_and_event", ["personId", "eventId"])
    .index("by_user", ["userId"]),

  // The feed rows — kept separate from the graph so ranking/why/how recomputes freely.
  recommendations: defineTable({
    userId: v.id("users"),
    personId: v.id("persons"),
    icpId: v.id("icp"),
    kind: v.union(v.literal("lead"), v.literal("connector")),
    score: v.number(), // goal_fit × warm_reachability
    whyBullets: v.array(
      v.object({ text: v.string(), confidence: v.number() }),
    ),
    how: v.array(v.string()),
    opener: v.string(),
    // Connector fan-out (leads they unlock) — bounded by the ≤12 node cap, inline array ok.
    unlocksIds: v.array(v.id("persons")),
    whyNow: v.optional(v.string()), // trigger: job change / new post / event
    // True when why/how/opener came from the LLM judge; false/absent means
    // heuristic (degraded) copy. The cron re-judges judged:false rows when
    // budget returns and skips unchanged judged rows (Phase E).
    judged: v.optional(v.boolean()),
  })
    .index("by_icp_and_score", ["icpId", "score"])
    .index("by_person", ["personId"])
    .index("by_user", ["userId"])
    .index("by_user_and_score", ["userId", "score"]),

  // Who you sell to — derived from the product site; the vector thumbs nudge.
  icp: defineTable({
    userId: v.id("users"),
    text: v.string(),
    vector: v.optional(v.array(v.number())), // OpenAI embedding
    source: v.object({
      website: v.optional(v.string()),
      linkedin: v.optional(v.string()),
      x: v.optional(v.string()),
    }),
    // Who this feed is for: one person growing their own network, or a company /
    // growth team finding who to sell to. Frames the derived-goal prompt + copy.
    audience: v.optional(
      v.union(v.literal("individual"), v.literal("company")),
    ),
  }).index("by_user", ["userId"]),

  // Thumbs up/down — nudges icp.vector → live re-sort. `at` = _creationTime.
  feedback: defineTable({
    icpId: v.id("icp"),
    personId: v.id("persons"),
    vote: v.union(v.literal("up"), v.literal("down")),
  })
    .index("by_icp", ["icpId"])
    .index("by_person", ["personId"]),

  // OpenAI embeddings for goal-fit similarity (text-embedding-3-small = 1536 dims).
  // Separate table so the vector index lives apart from the hot persons doc.
  personVectors: defineTable({
    personId: v.id("persons"),
    embedding: v.array(v.number()),
  })
    .index("by_person", ["personId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
    }),
});
