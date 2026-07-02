/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("requestUpgrade: signed-in only, idempotent per plan, scoped to the caller", async () => {
  const t = convexTest(schema, modules);

  // Anonymous callers can't raise a hand.
  await expect(
    t.mutation(api.upgrade.requestUpgrade, { plan: "pro" }),
  ).rejects.toThrow(/Not authenticated/);

  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "u@example.com" }),
  );
  const as = t.withIdentity({ subject: `${userId}|s1` });

  // First request writes a row; asking again returns the same row instead of
  // piling up duplicates; a different plan is a separate request.
  const first = await as.mutation(api.upgrade.requestUpgrade, { plan: "pro" });
  const again = await as.mutation(api.upgrade.requestUpgrade, { plan: "pro" });
  expect(again).toBe(first);
  const team = await as.mutation(api.upgrade.requestUpgrade, { plan: "team" });
  expect(team).not.toBe(first);

  const rows = await t.run(async (ctx) =>
    ctx.db.query("upgradeRequests").collect(),
  );
  expect(rows.length).toBe(2);
  for (const r of rows) expect(r.userId).toBe(userId);

  // The admin view joins the requester's email and tier.
  const admin = await t.query(internal.upgrade.adminListRequests, {});
  expect(admin.map((r) => r.plan).sort()).toEqual(["pro", "team"]);
  for (const r of admin) {
    expect(r.email).toBe("u@example.com");
    expect(r.tier).toBe("free");
  }
});
