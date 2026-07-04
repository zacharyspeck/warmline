import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError } from "convex/values";
import { auth } from "./auth";
import { sha256Hex } from "./extensionAuth";
import { RATE_LIMIT_ERROR } from "./rateLimit";

const http = httpRouter();

auth.addHttpRoutes(http);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// The extension's ONLY write path. Whose graph it touches is resolved from a
// scoped Bearer token minted in Settings (convex/extensionAuth.ts): the server
// hashes the token and looks up the owner, stamping every capture with that
// user. No token → 401. There is no anonymous or demo write path, and no
// background crawling (capture is user-initiated in the extension popup).
http.route({
  path: "/extension/capture",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authz = req.headers.get("Authorization") ?? "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
    if (!token) {
      return new Response("unauthorized", { status: 401, headers: cors });
    }
    const userId = await ctx.runQuery(internal.extensionAuth.resolveToken, {
      tokenHash: await sha256Hex(token),
    });
    if (!userId) {
      return new Response("unauthorized", { status: 401, headers: cors });
    }

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

    try {
      const result = await ctx.runMutation(internal.extension.captureProfile, {
        userId,
        leadSlug: body.leadSlug,
        leadName: body.leadName,
        mutuals: (body.mutuals ?? []).filter((m) => m && m.slug),
      });
      return Response.json(result, { headers: cors });
    } catch (err) {
      if (err instanceof ConvexError && err.data === RATE_LIMIT_ERROR) {
        return new Response(RATE_LIMIT_ERROR, { status: 429, headers: cors });
      }
      return new Response("capture failed", { status: 500, headers: cors });
    }
  }),
});

http.route({
  path: "/extension/capture",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { headers: cors })),
});

export default http;
