import { expect, test } from "vitest";
import {
  cosine,
  initials,
  confLabel,
  reachability,
  introScore,
  feedScore,
  normCompany,
  nudgeVector,
  sanitizeCopy,
} from "./lib";

test("cosine: identical vectors = 1, orthogonal = 0", () => {
  expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
  expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1); // colinear
});

test("cosine: zero vector is safe", () => {
  expect(cosine([0, 0], [1, 1])).toBe(0);
  expect(cosine([], [])).toBe(0);
});

test("initials: first two words, uppercase", () => {
  expect(initials("Marvin Kaunda")).toBe("MK");
  expect(initials("han")).toBe("H");
  expect(initials("a b c d")).toBe("AB");
  expect(initials("")).toBe("");
});

test("confLabel: thresholds", () => {
  expect(confLabel(0.9)).toBe("high");
  expect(confLabel(0.5)).toBe("medium");
  expect(confLabel(0.1)).toBe("low");
});

test("reachability: connected + tie beats cold", () => {
  const connected = reachability("connected", 1);
  const cold = reachability("not_connected", undefined);
  expect(connected).toBeGreaterThan(cold);
  expect(connected).toBeLessThanOrEqual(1);
  expect(cold).toBeCloseTo(0.1);
});

test("introScore: tie × confidence; zero tie kills it", () => {
  expect(introScore(0.8, 0.5)).toBeCloseTo(0.4);
  expect(introScore(0, 1)).toBe(0);
  expect(introScore(undefined, 0.9)).toBe(0);
});

test("feedScore: 0–100, weights goal-fit + reachability", () => {
  expect(feedScore(1, 1)).toBe(100);
  expect(feedScore(0, 0)).toBe(0);
  expect(feedScore(1, 0)).toBe(55);
});

test("normCompany: trims, empties → undefined", () => {
  expect(normCompany("  Stripe ")).toBe("Stripe");
  expect(normCompany("")).toBeUndefined();
  expect(normCompany(undefined)).toBeUndefined();
});

test("sanitizeCopy: no em dashes, no trailing period, keeps ellipsis", () => {
  expect(sanitizeCopy("Strong fit — clear ICP match.")).toBe(
    "Strong fit, clear ICP match",
  );
  expect(sanitizeCopy("Ask Priya for a warm intro")).toBe(
    "Ask Priya for a warm intro",
  );
  expect(sanitizeCopy("Thinking…")).toBe("Thinking…");
  // any dash is gone; the result has no em/en dash left
  expect(sanitizeCopy("a — b – c")).not.toMatch(/[—–]/);
  // a lone trailing period is dropped, question marks are kept
  expect(sanitizeCopy("Are they hiring?")).toBe("Are they hiring?");
  expect(sanitizeCopy("Great fit.")).toBe("Great fit");
});

test("nudgeVector: moves toward up-voted, away from down-voted, stays unit", () => {
  const base = [1, 0, 0];
  const up = [0, 1, 0];
  const down = [0, 0, 1];
  const nudged = nudgeVector(base, [up], [down], 0.2);

  // closer to the up-voted direction, further from the down-voted one
  expect(cosine(nudged, up)).toBeGreaterThan(cosine(base, up));
  expect(cosine(nudged, down)).toBeLessThan(cosine(base, down));
  // renormalized
  expect(cosine(nudged, nudged)).toBeCloseTo(1);
});

test("nudgeVector: a down-voted-similar lead's goal-fit (and score) drops", () => {
  const icp = [1, 0, 0];
  const downVec = [0, 0, 1];
  const leadLikeDown = [0, 0, 1]; // a candidate that looks like what you rejected

  const goalFit = (v: number[]) => (cosine(leadLikeDown, v) + 1) / 2;
  const before = goalFit(icp);
  const nudged = nudgeVector(icp, [], [downVec], 0.2);
  const after = goalFit(nudged);

  expect(after).toBeLessThan(before);
  // same reachability → the blended feed score drops too
  expect(feedScore(after, 0.5)).toBeLessThan(feedScore(before, 0.5));
});

test("nudgeVector: no votes returns a unit-normalized base (no drift)", () => {
  const base = [3, 4]; // not unit length
  const out = nudgeVector(base, [], [], 0.2);
  // direction preserved, magnitude normalized
  expect(cosine(out, base)).toBeCloseTo(1);
  expect(Math.hypot(...out)).toBeCloseTo(1);
});
