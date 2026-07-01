/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { icpSystemPrompt } from "./openai";

const modules = import.meta.glob("./**/*.ts");

test("icpSystemPrompt: individual vs company framing differs, no em dashes", () => {
  const individual = icpSystemPrompt("individual");
  const company = icpSystemPrompt("company");

  expect(individual).not.toBe(company);
  expect(individual.toLowerCase()).toContain("one person");
  expect(company.toLowerCase()).toContain("company");
  // both obey the copy rules (no em or en dash)
  expect(individual).not.toMatch(/[—–]/);
  expect(company).not.toMatch(/[—–]/);
});

test("saveIcp persists the audience choice on the ICP", async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(api.icp.saveIcp, {
    text: "People one step ahead in my field",
    source: {},
    audience: "individual",
  });
  const row = await t.run(async (ctx) => ctx.db.get(id));
  expect(row?.audience).toBe("individual");
});
