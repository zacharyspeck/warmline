// Pure helpers — no Convex registration, safe to unit-test directly.

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function confLabel(x: number): "high" | "medium" | "low" {
  return x >= 0.66 ? "high" : x >= 0.33 ? "medium" : "low";
}

// Reachability proxy: known + talked-to ranks high. tie ∈ [0,1].
export function reachability(
  relationship: "connected" | "not_connected",
  tieStrength: number | undefined,
): number {
  const tie = tieStrength ?? 0;
  const base = relationship === "connected" ? 0.4 : 0.1;
  return Math.min(1, base + tie * 0.6);
}

// intro_score = your tie to the connector × how well they know the lead.
export function introScore(
  connectorTie: number | undefined,
  edgeConfidence: number,
): number {
  return (connectorTie ?? 0.0) * edgeConfidence;
}

// Blend goal-fit and reachability into a 0–100 feed score.
export function feedScore(goalFit: number, reach: number): number {
  return Math.round(100 * (0.55 * goalFit + 0.45 * reach));
}

export function normCompany(c?: string): string | undefined {
  const t = (c ?? "").trim();
  return t.length ? t : undefined;
}

// The text that actually gets embedded and handed to the judge for a goal:
// the free-text statement plus any structured targets, appended as plain
// sentences so they steer the vector. Pure so the composition is testable and
// so both the embed path and the judge context stay identical. The bare
// statement (icp.text) is what the feed header shows — this is ranking-only.
export type GoalTargets = {
  companies: string[];
  roles: string[];
  locations: string[];
};

export function goalEmbedText(text: string, targets?: GoalTargets): string {
  if (!targets) return text;
  const clean = (xs: string[]) =>
    xs.map((s) => s.trim()).filter(Boolean);
  const parts = [text.trim()];
  const companies = clean(targets.companies);
  const roles = clean(targets.roles);
  const locations = clean(targets.locations);
  if (companies.length) parts.push(`Target companies: ${companies.join(", ")}.`);
  if (roles.length) parts.push(`Target roles: ${roles.join(", ")}.`);
  if (locations.length) parts.push(`Locations: ${locations.join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}

// Enforce the product copy rules on one line of generated text: no em or en
// dashes, and no period ending the final sentence (an ellipsis, ? or ! is kept).
// A safety net over the judge prompt so the feed's why/how/opener always comply.
export function sanitizeCopy(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ") // em/en dash → comma
    .replace(/\s*,\s*,\s*/g, ", ") // collapse accidental double commas
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([^.])\.\s*$/, "$1"); // drop a lone trailing period, keep "…"
}

// Feedback nudge: move `base` toward the centroid of up-voted vectors and away
// from the centroid of down-voted vectors, by a bounded step `alpha`, then
// renormalize to unit length. Cosine is scale-free, so this only changes the
// DIRECTION of the ICP vector — pulling it nearer people you liked and further
// from people you rejected. Pure + deterministic so it unit-tests directly.
export function nudgeVector(
  base: number[],
  up: number[][],
  down: number[][],
  alpha: number,
): number[] {
  const dim = base.length;
  const centroid = (vs: number[][]): number[] | null => {
    if (vs.length === 0) return null;
    const acc = new Array(dim).fill(0);
    for (const v of vs) {
      for (let i = 0; i < dim; i++) acc[i] += v[i] ?? 0;
    }
    for (let i = 0; i < dim; i++) acc[i] /= vs.length;
    return acc;
  };
  const upC = centroid(up);
  const downC = centroid(down);
  const out = base.slice();
  for (let i = 0; i < dim; i++) {
    if (upC) out[i] += alpha * (upC[i] - base[i]);
    if (downC) out[i] += alpha * (base[i] - downC[i]);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  return norm === 0 ? base.slice() : out.map((x) => x / norm);
}
