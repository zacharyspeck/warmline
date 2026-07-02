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

// Whose graph the extension touches: ONLY the signed-in user whose valid
// Convex Auth JWT is on the request; anything else resolves null and the
// routes return 401. The old WARMLINE_EXTENSION_TOKEN demo fallback is gone
// by owner decision: the demo account's content changes only through the
// daily cron and the internal admin loaders, never through these routes.
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
    // Extension writes require a signed-in user and land in THEIR graph.
    const userId = await authedUser(ctx);
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
  handler: httpAction(async (ctx) => {
    // Same rule as POST /extension/mutuals: a signed-in user's own graph only.
    const userId = await authedUser(ctx);
    if (!userId) {
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
