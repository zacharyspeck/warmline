import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";
import { deriveIcp } from "./openai";

// Scrape a product site → clean markdown (Firecrawl). Needs FIRECRAWL_API_KEY.
async function scrapeSite(url: string): Promise<string> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return "";
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { data?: { markdown?: string } };
    return data.data?.markdown ?? "";
  } catch {
    return "";
  }
}

// Onboarding: audience + 3 links → derive the ICP from the product site → rank
// the feed against it. The single call the onboarding screen awaits while it
// animates. Roadmap (not built here): CRM integration and network pooling.
export const generate = action({
  args: {
    website: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    x: v.optional(v.string()),
    audience: v.optional(
      v.union(v.literal("individual"), v.literal("company")),
    ),
    judgeTopN: v.optional(v.number()),
  },
  returns: v.object({ icpId: v.id("icp"), icpText: v.string() }),
  handler: async (ctx, args) => {
    // Authenticate BEFORE any OpenAI/Firecrawl call: no anonymous caller may
    // spend model credits. (saveIcp re-derives the user for the write.)
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const audience = args.audience ?? "company";
    // Fallback goal when there is no site to scrape (or no key), framed by audience.
    let icpText =
      audience === "individual"
        ? "People one step ahead in my field who can make a warm introduction"
        : "Growth and GTM engineers building with AI";
    if (args.website) {
      const md = await scrapeSite(args.website);
      if (md) {
        const derived = await deriveIcp(md, audience);
        if (derived) icpText = derived;
      }
    }

    const icpId: Id<"icp"> = await ctx.runMutation(api.icp.saveIcp, {
      text: icpText,
      source: { website: args.website, linkedin: args.linkedin, x: args.x },
      audience,
    });

    // rebuild embeds the ICP, scores leads (goal-fit × reachability), and writes
    // the judged why/how recommendations.
    await ctx.runAction(internal.rank.rebuild, {
      icpId,
      judgeTopN: args.judgeTopN ?? 10,
    });

    return { icpId, icpText };
  },
});
