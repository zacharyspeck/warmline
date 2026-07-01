/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("seedNetwork produces a substantive, ranked-feed-ready network", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "seed@example.com" }),
  );
  const as = t.withIdentity({ subject: `${userId}|s1` });
  const res = await t.mutation(internal.devSeed.seedNetwork, { userId });
  expect(res.leads).toBeGreaterThanOrEqual(20);
  expect(res.edges).toBeGreaterThan(0);
  expect(res.userId).toBe(userId);

  const rows = await as.query(api.feed.list, { limit: 40 });
  // a healthy feed, not three rows
  expect(rows.length).toBeGreaterThanOrEqual(20);
  expect(rows.length).toBeLessThanOrEqual(50);
  // connectors surface their fan-out as a warm path, and a gatekeeper exists
  expect(
    rows.some((r) => r.kind === "connector" && r.mutualsTotal > 0),
  ).toBe(true);
  expect(rows.some((r) => r.gatekeeper)).toBe(true);
  // leads carry their bridging connectors as mutuals
  expect(rows.some((r) => r.kind === "lead" && r.mutuals.length > 0)).toBe(true);
});
