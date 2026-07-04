// EVERY spend limit in the app lives in this file — the single source of
// truth for Phase E cost caps. Nothing else may hardcode a cap.
//
// Categories:
//   judge  — one gpt-4o-mini judge call (why/how/opener for one lead)
//   embed  — one text-embedding-3-small call (an icp or a person)
//   scrape — one onboarding scrape UNIT: the Firecrawl fetch plus its paired
//            deriveIcp chat call (they happen 1:1, so one reservation covers
//            the pair)
//
// Budgets reset by DATE ROLLOVER: usage rows are keyed by dayKey (UTC date),
// so a new day simply reads a fresh row — nothing is ever wiped on a schedule.
//
// Fail-closed rule (same pattern as the invite gate): any lookup that misses —
// an unknown tier, an unknown category — yields a budget of ZERO. A bounded
// overshoot from momentary concurrency is acceptable; unbounded spend never is.

export type Category = "judge" | "embed" | "scrape";
export const CATEGORIES: Category[] = ["judge", "embed", "scrape"];

// ── Per-user daily caps by tier (judge + embed vary by tier) ──
// users.tier is a free string normalized at read; anything not listed here is
// an unknown tier and gets zero budget. Absent tier means "free".
export const TIER_LIMITS: Record<string, { judge: number; embed: number }> = {
  // free: one full cron rank (12 judges) + change headroom; embeds cover a
  // whole CANDIDATE_LIMIT=120 rebuild from a cold vector cache, three times.
  free: { judge: 25, embed: 400 },
  pro: { judge: 100, embed: 2000 },
};

// ── Per-user daily scrape cap (flat — the same for every tier) ──
export const SCRAPE_PER_USER = 5;

// ── Global daily caps across ALL users, per category: the hard ceiling ──
export const GLOBAL_LIMITS: Record<Category, number> = {
  judge: 400,
  embed: 4000,
  scrape: 40,
};

// ── The daily cron's per-user, per-run judge budget ──
// A cron run may never consume a user's whole daily judge allowance; manual
// onboarding/rebuilds spend from the same daily pool.
export const CRON_JUDGE_PER_RUN = 6;

// ── Zero-lead rank (connector mode) per-run embed bounds ──
// One rankConnectorsOnly run embeds at most RANK_EMBEDS_PER_RUN people
// (keeps the action far inside its 10-minute limit; the daily cron finishes
// the remainder across days), reserving in EMBED_RESERVE_CHUNK slices so a
// mid-run failure forfeits at most one chunk of reserved budget instead of
// the whole day's grant.
export const RANK_EMBEDS_PER_RUN = 300;
export const EMBED_RESERVE_CHUNK = 50;

// ── Connector-mode reconnect openers per run ──
// The zero-lead rank drafts a short reconnect opener for at most this many of
// the top connector recommendations, each a judge-category spend. Small so one
// run can't drain the day's judge budget (shared with lead judging + manual
// rebuilds); a cap hit degrades silently to no opener.
export const CONNECTOR_OPENERS_PER_RUN = 3;

// The daily window key, UTC: "2026-07-01". Rollover to a new key IS the reset.
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export const DEFAULT_TIER = "free";

// A user's daily cap for one category. Fail closed: unknown tier → 0.
export function userDailyCap(
  tier: string | undefined,
  category: Category,
): number {
  if (category === "scrape") return SCRAPE_PER_USER;
  const t = TIER_LIMITS[tier ?? DEFAULT_TIER];
  if (!t) return 0;
  return t[category] ?? 0;
}

// The global daily cap for one category. Fail closed: unknown category → 0.
export function globalDailyCap(category: Category): number {
  return GLOBAL_LIMITS[category] ?? 0;
}
