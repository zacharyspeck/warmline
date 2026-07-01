/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// currentUser is the stable-user-id surface the client reads. Convex Auth encodes
// the identity as `${userId}|${sessionId}` in identity.subject, which
// getAuthUserId parses back to the Id<"users">.
test("currentUser: null signed out, stable id + email signed in", async () => {
  const t = convexTest(schema, modules);

  expect(await t.query(api.auth.currentUser, {})).toBeNull();

  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "ava@example.com" }),
  );
  const asUser = t.withIdentity({ subject: `${userId}|session1` });
  const me = await asUser.query(api.auth.currentUser, {});
  expect(me).toEqual({ id: userId, email: "ava@example.com" });
});
