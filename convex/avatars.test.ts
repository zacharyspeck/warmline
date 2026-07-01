/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("needingAvatars: avatar-less people with a handle/slug, top by tie strength", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const mk = (
      name: string,
      extra: {
        avatarUrl?: string;
        linkedinUrl?: string;
        xHandle?: string;
        tieStrength?: number;
      },
    ) =>
      ctx.db.insert("persons", {
        name,
        isSelf: false,
        role: "lead" as const,
        relationshipToYou: "not_connected" as const,
        ...extra,
      });
    return {
      hasAvatar: await mk("Has Avatar", {
        avatarUrl: "https://x/y.png",
        linkedinUrl: "has",
        tieStrength: 1,
      }),
      noHandle: await mk("No Handle", { tieStrength: 1 }),
      top: await mk("Top Tie", { linkedinUrl: "top", tieStrength: 0.9 }),
      mid: await mk("Mid Tie", { xHandle: "midtie", tieStrength: 0.5 }),
      low: await mk("Low Tie", { linkedinUrl: "low", tieStrength: 0.1 }),
    };
  });

  const picked = await t.query(internal.avatars.needingAvatars, { limit: 2 });
  // Highest tie first; the already-avatared and handle-less people are excluded.
  expect(picked.map((p) => p.id)).toEqual([ids.top, ids.mid]);
  expect(picked[0].slug).toBe("top");
  expect(picked[1].xHandle).toBe("midtie");
});
