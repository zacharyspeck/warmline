import {
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { findByNameCompany } from "./ingest";
import { extractTeamPeople, type TeamPerson } from "./openai";
import {
  DISCOVER_COMPANIES_PER_SAVE,
  DISCOVER_LEADS_PER_COMPANY,
} from "./limits";

// Target-company people discovery. When a goal is saved with target companies
// (convex/goals.ts schedules discoverForGoal), each company's public team/about
// page is scraped ONCE under the shared daily scrape reserve, the named people
// are parsed into leads (tagged discoveredFromWeb, deduped through the same
// name+company overlap as add-targets), and the post-import pipeline runs so
// shared-company connectors become bridges. Every company gets an honest note
// on the Goals screen — including "no team page found" — so nothing fails
// silently. No background crawling: this runs only on a save the user made.

// Scrape a page → clean markdown (Firecrawl). Empty string when there is no key
// or the fetch fails, so the caller records an honest "no page" note.
async function scrapeMarkdown(url: string): Promise<string> {
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

// Best-effort domain + candidate team/about URLs from a company name. If the
// entry already looks like a domain (has a dot, no spaces) use it as-is; else
// slugify the name to a .com guess. Missing the page is a graceful no-op — the
// note tells the user honestly.
export function candidateUrls(company: string): string[] {
  const raw = company.trim();
  if (!raw) return [];
  let domain: string;
  if (/^[^\s]+\.[^\s]+$/.test(raw)) {
    domain = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  } else {
    const slug = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!slug) return [];
    domain = `${slug}.com`;
  }
  return [`https://${domain}/team`, `https://${domain}/about`];
}

function dedupeCompanies(companies: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of companies) {
    const name = c.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const NOTE: Record<string, (found: number) => string> = {
  found: (n) => `Added ${n} ${n === 1 ? "person" : "people"} from their team page`,
  no_page: () => "No public team page found — add these people by hand or capture them with the extension",
  no_people: () => "Found a page but no named team members on it",
  capped: () => "Daily discovery limit reached — try again tomorrow",
  error: () => "Could not read this company right now",
};

// Write the parsed people as leads (deduped) and record the per-company note.
// Split from the action so all DB work stays in one transaction per company.
export const recordDiscovery = internalMutation({
  args: {
    userId: v.id("users"),
    company: v.string(),
    status: v.union(
      v.literal("found"),
      v.literal("no_page"),
      v.literal("no_people"),
      v.literal("capped"),
      v.literal("error"),
    ),
    people: v.array(
      v.object({ name: v.string(), role: v.optional(v.string()) }),
    ),
  },
  returns: v.object({ added: v.number(), promoted: v.number() }),
  handler: async (ctx, args) => {
    let added = 0;
    let promoted = 0;
    for (const person of args.people.slice(0, DISCOVER_LEADS_PER_COMPANY)) {
      const name = person.name.trim();
      // Require a plausible full name; never insert a bare token.
      if (!name || name.split(/\s+/).length < 2) continue;
      const existing = await findByNameCompany(
        ctx,
        args.userId,
        name,
        args.company,
      );
      if (existing) {
        // Never reclassify the You/self row.
        if (existing.isSelf) continue;
        const patch: Record<string, unknown> = {};
        if (existing.role !== "lead") patch.role = "lead";
        if (existing.headline === undefined && person.role)
          patch.headline = person.role;
        if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch);
        promoted++;
      } else {
        await ctx.db.insert("persons", {
          userId: args.userId,
          name,
          company: args.company,
          headline: person.role,
          isSelf: false,
          role: "lead",
          relationshipToYou: "not_connected",
          discoveredFromWeb: true,
        });
        added++;
      }
    }

    // The note reflects what actually happened: a page that yielded no people
    // reads as "no_people" even if the caller passed "found".
    const total = added + promoted;
    const status =
      args.status === "found" && total === 0 ? "no_people" : args.status;
    const note = (NOTE[status] ?? NOTE.error)(total);
    const existingNote = await ctx.db
      .query("companyDiscovery")
      .withIndex("by_user_and_company", (q) =>
        q.eq("userId", args.userId).eq("company", args.company),
      )
      .first();
    const row = { status, found: total, note, at: Date.now() } as const;
    if (existingNote) {
      await ctx.db.patch(existingNote._id, row);
    } else {
      await ctx.db.insert("companyDiscovery", {
        userId: args.userId,
        company: args.company,
        ...row,
      });
    }
    return { added, promoted };
  },
});

// Scrape each target company's team page once and create leads from the named
// people. Scheduled by saveGoal; never runs on its own.
export const discoverForGoal = internalAction({
  args: { userId: v.id("users"), companies: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const companies = dedupeCompanies(args.companies).slice(
      0,
      DISCOVER_COMPANIES_PER_SAVE,
    );
    let anyFound = false;
    for (const company of companies) {
      // Reserve one scrape unit per Firecrawl fetch so the daily scrape cap
      // bounds the ACTUAL number of Firecrawl calls exactly (a company whose
      // /team page is empty and falls back to /about costs two units). Out of
      // budget → honest "capped" note; keep going so every company still gets a
      // note (later companies just hit the same denied reserve).
      let markdown = "";
      let capped = false;
      for (const url of candidateUrls(company)) {
        const { granted } = await ctx.runMutation(internal.usage.reserve, {
          userId: args.userId,
          category: "scrape",
          count: 1,
        });
        if (granted <= 0) {
          capped = true;
          break;
        }
        markdown = await scrapeMarkdown(url);
        if (markdown) break;
      }
      if (!markdown) {
        await ctx.runMutation(internal.discover.recordDiscovery, {
          userId: args.userId,
          company,
          status: capped ? "capped" : "no_page",
          people: [],
        });
        continue;
      }

      let people: TeamPerson[] = [];
      try {
        people = await extractTeamPeople(markdown);
      } catch {
        people = [];
      }
      const res = await ctx.runMutation(internal.discover.recordDiscovery, {
        userId: args.userId,
        company,
        status: people.length ? "found" : "no_people",
        people: people.slice(0, DISCOVER_LEADS_PER_COMPANY),
      });
      if (res.added + res.promoted > 0) anyFound = true;
    }

    // Recompute bridges + re-rank once, only if discovery actually added people.
    if (anyFound) {
      await ctx.scheduler.runAfter(0, internal.linkedinImport.afterImport, {
        userId: args.userId,
      });
    }
    return null;
  },
});

// The per-company discovery notes for the caller's latest save, newest first.
// Read by the Goals screen so no company fails silently.
export const notesForGoal = query({
  args: {},
  returns: v.array(
    v.object({
      company: v.string(),
      status: v.string(),
      found: v.number(),
      note: v.string(),
      at: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("companyDiscovery")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
    return rows
      .sort((a, b) => b.at - a.at)
      .map((r) => ({
        company: r.company,
        status: r.status,
        found: r.found,
        note: r.note,
        at: r.at,
      }));
  },
});
