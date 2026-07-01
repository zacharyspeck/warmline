import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Whose graph the extension writes into: the signed-in user when the request
// carries a valid Convex Auth JWT; otherwise null (callers fall back to the
// demo account). The shared-token Bearer header is not a JWT, so it resolves
// to null here without throwing.
async function authedUser(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}): Promise<Id<"users"> | null> {
  try {
    return await getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0]);
  } catch {
    return null;
  }
}

// Browser extension posts mutual connections read off a Lead's LinkedIn profile.
http.route({
  path: "/extension/mutuals",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: {
      leadSlug?: string;
      leadName?: string;
      mutuals?: { name: string; slug: string }[];
    };
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", { status: 400, headers: cors });
    }
    if (!body.leadSlug) {
      return new Response("leadSlug required", { status: 400, headers: cors });
    }
    // Optional shared-secret: if WARMLINE_EXTENSION_TOKEN is set on the deploy,
    // require a matching Authorization: Bearer header. Unset → open (demo).
    const token = process.env.WARMLINE_EXTENSION_TOKEN;
    const authz = req.headers.get("Authorization");
    const tokenOk = !token || authz === `Bearer ${token}`;
    // A signed-in user's JWT scopes the write to their own graph; the shared
    // token (or an open deploy) scopes it to the demo account.
    const userId =
      (await authedUser(ctx)) ??
      (tokenOk
        ? await ctx.runMutation(internal.devSeed.getOrCreateDemoUser, {})
        : null);
    if (!userId) {
      return new Response("unauthorized", { status: 401, headers: cors });
    }
    const result = await ctx.runMutation(internal.extension.ingestMutuals, {
      userId,
      leadSlug: body.leadSlug,
      leadName: body.leadName,
      mutuals: (body.mutuals ?? []).filter((m) => m && m.slug),
    });
    return Response.json(result, { headers: cors });
  }),
});

http.route({
  path: "/extension/mutuals",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { headers: cors })),
});

// Returns leads whose mutual connections haven't been captured yet.
http.route({
  path: "/extension/leads",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const token = process.env.WARMLINE_EXTENSION_TOKEN;
    const authz = req.headers.get("Authorization");
    const tokenOk = !token || authz === `Bearer ${token}`;
    const userId =
      (await authedUser(ctx)) ??
      (tokenOk ? await ctx.runQuery(internal.devSeed.demoUserId, {}) : null);
    if (!userId) {
      // No signed-in user and no demo account yet → nothing to crawl.
      if (tokenOk) return Response.json({ leads: [] }, { headers: cors });
      return new Response("unauthorized", { status: 401, headers: cors });
    }
    const leads = await ctx.runQuery(internal.extension.pendingLeads, {
      userId,
    });
    return Response.json({ leads }, { headers: cors });
  }),
});

http.route({
  path: "/extension/leads",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { headers: cors })),
});

export default http;
