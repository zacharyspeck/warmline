// OpenAI client helpers (plain functions, called from actions). Uses fetch,
// no SDK, no "use node". Needs OPENAI_API_KEY on the Convex deployment.

import { sanitizeCopy } from "./lib";

const EMBED_MODEL = "text-embedding-3-small"; // 1536 dims
const CHAT_MODEL = "gpt-4o-mini";

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY not set on the Convex deploy");
  return k;
}

export async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`OpenAI embed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

export type Audience = "individual" | "company";

// The derived-goal system prompt, framed by who the feed is for. Pure + exported
// so the framing is unit-testable. Individual = one person growing their own
// network; company = a team deciding who to sell to.
export function icpSystemPrompt(audience: Audience): string {
  if (audience === "individual") {
    return (
      "You are helping one person grow their own network and career. " +
      "From their site or profile, write 1 to 2 sentences describing the kind of people they should meet " +
      "(role, seniority, company type, domain) to reach their goal. Be concrete and specific. Return only those sentences with no preamble"
    );
  }
  return (
    "You are helping a company or growth team decide who to reach. " +
    "From this company's website, write 1 to 2 sentences describing their ICP, the specific people they sell to " +
    "(role, seniority, company type, domain). Be concrete and specific. Return only those sentences with no preamble"
  );
}

// Derive the ICP from a scraped product site, framed by audience.
export async function deriveIcp(
  siteMarkdown: string,
  audience: Audience = "company",
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: icpSystemPrompt(audience) },
        { role: "user", content: siteMarkdown.slice(0, 6000) },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ICP ${res.status}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

// A short reconnect opener for a connector already in the user's network:
// message them to rekindle the relationship and ask for help reaching the
// people in the goal. Draft only, one gpt-4o-mini call, the same copy rules
// as the judge enforced at the source (sanitizeCopy). Empty string on a shape
// miss so the caller degrades to no opener.
export async function draftReconnectOpener(input: {
  icpText: string;
  connector: { name: string; headline?: string; company?: string };
}): Promise<string> {
  const sys =
    "You are a warm-networking assistant. Draft ONE short opener, 1 to 2 sentences, " +
    "the user can send to reconnect with a person ALREADY in their network and ask for help reaching the kind of people in their goal. " +
    "Ground it only in the given facts about the person; never invent specifics. Output strict JSON {\"opener\":\"...\"}. " +
    "WRITING STYLE, follow exactly: plain English with no buzzwords. " +
    "Never use an em dash anywhere. " +
    "Never phrase anything as a 'this, not that' contrast; state the positive point on its own. " +
    "Write complete sentences with normal punctuation, but do NOT end the opener with a period.";
  const user = JSON.stringify(input);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });
  if (!res.ok)
    throw new Error(`OpenAI opener ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const parsed = JSON.parse(data.choices[0].message.content) as {
    opener?: string;
  };
  return sanitizeCopy(typeof parsed.opener === "string" ? parsed.opener : "");
}

export type TeamPerson = { name: string; role?: string };

// Extract the real, named people from a company's scraped team/about page.
// Used by target-company discovery (convex/discover.ts): one gpt-4o-mini call,
// paired 1:1 with the Firecrawl fetch as a single scrape unit. Returns [] on a
// shape miss so the caller records an honest "no people found" note. Names only
// — never invents people, never returns generic labels or customers/investors.
export async function extractTeamPeople(
  siteMarkdown: string,
): Promise<TeamPerson[]> {
  const sys =
    "You read a company's team or about page and extract the real, named people who work there. " +
    'Output strict JSON {"people":[{"name":"First Last","role":"their title"}]}. ' +
    "Include ONLY real individuals with a first and last name who work at this company. " +
    "Skip section headings, taglines, testimonials, customers, investors, and advisors. " +
    "Use the exact role text on the page; omit role if none is given. " +
    'If the page names no team members, return {"people":[]}. Never invent a person.';
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: siteMarkdown.slice(0, 6000) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI team ${res.status}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  let parsed: { people?: unknown };
  try {
    parsed = JSON.parse(data.choices[0]?.message?.content ?? "{}");
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed.people) ? parsed.people : [];
  const out: TeamPerson[] = [];
  for (const r of rows) {
    const name = String((r as { name?: unknown })?.name ?? "").trim();
    // Require a plausible full name (at least two tokens) — drops stray labels.
    if (!name || name.split(/\s+/).length < 2) continue;
    const roleRaw = (r as { role?: unknown })?.role;
    const role = typeof roleRaw === "string" ? roleRaw.trim() : "";
    out.push(role ? { name, role } : { name });
  }
  return out;
}

export type Judgement = {
  why: { text: string; confidence: "high" | "medium" | "low" }[];
  how: string[]; // 3 concrete ways to connect
  opener: string; // drafted opener
};

// LLM-as-judge: 3 why bullets (fit vs ICP) + 3 how bullets (concrete ways to
// connect) + a drafted opener, grounded in the provided facts. Draft only.
export async function judge(input: {
  icpText: string;
  person: { name: string; headline?: string; company?: string };
  connectors?: { name: string; evidence: string }[]; // mutuals who can warm-intro
  voice?: string; // the user's tone hint
}): Promise<Judgement> {
  const sys =
    "You are a growth-engineering assistant. Given an ICP, a person, and any mutual connectors, output strict JSON " +
    '{"why":[{"text":"...","confidence":"high|medium|low"}],"how":["...","...","..."],"opener":"..."}. ' +
    "why = exactly 3 short bullets on why they fit the ICP, each with confidence high, medium, or low, grounded ONLY in the given facts. " +
    "how = exactly 3 short, concrete bullets on how to connect with them (for example: ask a named connector for a warm intro and quote their evidence; open with their recent work; engage with a recent post first). " +
    "When you use a connector, quote the evidence field to explain the connection, and never invent or contradict a company affiliation. " +
    "Use the named connectors when they are given. opener = a 1 to 2 sentence draft message that references something real about them. " +
    "Never invent facts. " +
    "WRITING STYLE, follow exactly: use plain English with no buzzwords. " +
    "Never use an em dash anywhere. " +
    "Never phrase anything as a 'this, not that' contrast; state the positive point on its own. " +
    "Write complete sentences with normal punctuation inside them, but do NOT end the last sentence of any why bullet, any how bullet, or the opener with a period. " +
    'Good why bullet: "Leads growth at a Series B dev tools company that matches your ICP". ' +
    'Bad why bullet: "A warm intro, not a cold email — clearly a strong fit." (it uses a not-contrast, an em dash, and a trailing period). ' +
    'Good how bullet: "Ask Priya for a warm intro; she worked with them at Stripe". ' +
    'Bad how bullet: "Leverage synergies and circle back to unlock alignment." (buzzwords and a trailing period).';
  const user = JSON.stringify(input);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const parsed = JSON.parse(data.choices[0].message.content) as Judgement;
  // defensive shape + copy-rule enforcement (no em dashes, no trailing periods)
  return {
    why: (Array.isArray(parsed.why) ? parsed.why.slice(0, 3) : []).map((w) => ({
      text: sanitizeCopy(String(w?.text ?? "")),
      confidence: w?.confidence,
    })),
    how: (Array.isArray(parsed.how) ? parsed.how.slice(0, 3) : []).map((h) =>
      sanitizeCopy(String(h)),
    ),
    opener: sanitizeCopy(typeof parsed.opener === "string" ? parsed.opener : ""),
  };
}
