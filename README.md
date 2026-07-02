# Warmline

**The For You feed for your warm network.**

Everyone is automating cold outreach and racing to the bottom. The highest-converting lead is a warm intro, usually sitting one person away, scattered across your contacts, a cofounder's LinkedIn, and an event you both almost went to.

Tell Warmline your goal once. A proactive agent surfaces the intro you didn't know existed and tells you **how** to make it land: channel, angle, and a drafted opener.

Started at the **YC AI Growth Hackathon** (24-hour build), now growing into a gated multi-user beta.

![Warmline feed: ranked list of who to reach out to, with why and how](feed-screenshot.png)

## My contribution

I came up with the original concept, built the demo/seed dataset, and wrote the core data script: the `seed/generate.mjs` generator that produces the demo data, along with its validator and loader. My teammate built the project scaffolding and handled deployment.

## What makes it different

- **Proactive**: pushes the intro you didn't ask for
- **2nd / 3rd degree**: finds the *gatekeeper* who unlocks many targets at once
- **Serendipity layer**: fuses event RSVPs and social signal into an attendance-confidence score
- **Tailored ranking**: thumbs up and down retune your ranking on the next daily run

## Accounts, isolation, and safety

Everything below is enforced server-side and pinned by the test suite (`convex/isolation.test.ts` and `convex/limits.test.ts`).

- **Gated signup**: creating an account requires an invite code, checked inside the server signup flow. The code lives on the Convex deployment as `INVITE_CODE`; while it is unset every signup is rejected
- **Logged-out demo**: signed-out visitors on the landing page see a read-only feed and graph owned by a curated demo account seeded with synthetic people. The demo queries take no user id of any kind and the server resolves the demo account internally
- **Per-user isolation**: every domain table is keyed by `userId` and every query and mutation is scoped to the signed-in caller. One account can never read or write another's rows, including by crafted id lookups
- **Cost caps**: every OpenAI call is budget-reserved before it happens, with per-tier daily caps, a flat per-user scrape cap, and global daily caps across all users, all defined in one file (`convex/limits.ts`). Cap hits degrade to cached data and heuristic copy instead of failing
- **Delete my data**: Settings has a typed-confirmation control that permanently removes everything an account owns, auth rows included. Plain-English `/privacy` and `/terms` pages describe exactly what is stored

## How it works

- **Warm signal**: sources you import yourself: LinkedIn exports, connector uploads, and the browser extension for mutual connections
- **Reach and enrichment**: [Fiber](https://fiber.ai/) for live LinkedIn and X data where a key is configured
- **Proactive agent**: a Convex cron ranks leads against your goal daily and traces the warm path, inside the cost caps
- **Why + How**: every lead ships with reasoning and a drafted opener. Warmline never sends anything; you review and send drafts yourself

## How Convex powers Warmline

Convex is the entire backend runtime. Every piece of server-side logic is a Convex function.

- **Schema + typed queries**: graph tables (`persons`, `edges`, `recommendations`, `icp`, `feedback`, `personVectors`, `usage`) with explicit indexes and generated TypeScript bindings
- **Realtime**: the feed (`api.feed.list`) is a `query`; the client `useQuery` updates live on re-rank or thumbs votes, no polling
- **Actions**: long-running work (Firecrawl scrape, OpenAI ICP, embeddings, Fiber API) runs in `action`s, each behind a budget reservation
- **Cron**: `convex/crons.ts` runs daily at 13:00 UTC: recompute the graph, re-rank inside the caps, refresh avatars, then log a usage summary line at 14:00
- **Vector scoring**: 1536-dim embeddings in `personVectors`; cosine goal-fit fused with warm-reachability makes the final score
- **File storage**: uploaded exports (LinkedIn and Twitter ZIP, Luma CSV) stored via signed PUT URLs
- **Auth**: `@convex-dev/auth` password sign-in behind the invite gate, no third-party service

## Tech stack

- [Convex](https://convex.dev/): backend, realtime, cron
- [Fiber](https://fiber.ai/): live people and company data
- [OpenAI](https://openai.com/): LLM reasoning + embeddings
- [Next.js](https://nextjs.org/) + [React](https://react.dev/) + [Tailwind](https://tailwindcss.com/)
- [Better Design](https://better-design.com/): design system and UI/UX
- [Convex Auth](https://labs.convex.dev/auth): authentication

## Get started

```bash
npm install
npm run dev
```

Set the required keys (see `.env.example`):

- `OPENAI_API_KEY`
- `INVITE_CODE`: signups are rejected while it is unset
- `FIBER_API_KEY`: optional enrichment, get one at <https://fiber.ai/app/api>
- Google OAuth credentials for the connector flow

## Learn more

- [Convex docs](https://docs.convex.dev/) · [Convex Auth](https://labs.convex.dev/auth)
- [Fiber API docs](https://api.fiber.ai/docs/): start at [`llms.txt`](https://api.fiber.ai/llms.txt)
