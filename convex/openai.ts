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

// Derive the ICP (who they sell to) from a scraped product site.
export async function deriveIcp(siteMarkdown: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "From this company's website, write 1–2 sentences describing their ICP — the specific people they sell to (role, seniority, company type, domain). Be concrete. No preamble.",
        },
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
