/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("ingestConnections inserts a connector, deduped by slug", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email: "smoke@example.com" }),
  );
  const as = t.withIdentity({ subject: `${userId}|s1` });
  const r1 = await as.mutation(api.ingest.ingestConnections, {
    rows: [{ name: "Han Wang", linkedinUrl: "hanwang", company: "Mintlify" }],
  });
  expect(r1.inserted).toBe(1);
  const r2 = await as.mutation(api.ingest.ingestConnections, {
    rows: [{ name: "Han Wang", linkedinUrl: "hanwang", company: "Mintlify" }],
  });
  expect(r2.inserted).toBe(0);
  expect(r2.patched).toBe(1);
});
