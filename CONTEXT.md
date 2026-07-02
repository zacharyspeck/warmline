# Warmline — build context

The For You feed for your warm network. Warmline ranks who to reach out to
against a stated goal, why each person fits, and the warmest path to an intro,
and it drafts the opener for you to send yourself. This file tracks the actual
state of the code so a new session does not have to re-derive it. The product
language lives in the glossary at the bottom.

## Where the work lives

Two feature branches, both green and pushed to origin, `main` untouched.

- **`zach/phase2-accounts`** — the backend and accounts work, Phases A
  through F plus cost caps and the extension lockdown
- **`zach/design-skin`** — branched from phase2-accounts, carries the visual
  skin, the SEO baseline, and the pricing surface. Merging design-skin brings
  phase2-accounts with it

Review and merge phase2-accounts first, then design-skin. The full owner
checklist is in MANUAL_TODO.md.

## What is built

- **Gated signup**: creating an account requires an invite code checked inside
  the server signup flow. The code lives on the Convex deployment as
  INVITE_CODE; while it is unset every signup is rejected. A direct backend
  call with a bad code is rejected the same way
- **Per-user isolation**: every domain table is keyed by userId and every
  query and mutation is scoped to the signed-in caller. One account can never
  read or write another's rows, including by crafted id lookups. This is the
  hard gate the suite defends
- **Logged-out demo**: signed-out visitors on the landing page see a read-only
  feed and warm-path graph owned by a curated demo account seeded with
  synthetic people. The demo queries take no user id of any kind and the
  server resolves the demo account internally. No user's data can appear in it
- **Cost caps**: every OpenAI call is budget-reserved before it happens, with
  per-tier daily caps, a flat per-user scrape cap, and global daily caps
  across all users, all defined in one file, convex/limits.ts. A cap hit
  degrades to cached data and heuristic copy instead of failing, and the daily
  cron always finishes its cycle. An internal admin query and a once-a-cycle
  log line make spend visible in the dashboard
- **Delete my data**: Settings has a typed-confirmation control that
  permanently removes everything an account owns, including uploaded files,
  cached photos, and the auth rows, as a bounded ordered purge with a
  scheduled continuation for large accounts. The demo account cannot be
  deleted through it
- **Extension lockdown**: the browser-extension HTTP routes accept only a
  signed-in user's Convex Auth token and write to that caller's own graph.
  There is no shared-token path and no anonymous write path into the demo
- **The skin**: sign-in and create-account, onboarding, the feed, connectors,
  and the expanded person view with the warm path are rebuilt to the design
  references in design/screens/ using the Warmline tokens (amber #E5813B,
  charcoal #1B1613, ink #221B14, off-white #F3EBE1, Schibsted Grotesk
  headings). A thumbs vote pivots the card off the top and cycles it to the
  bottom, respecting prefers-reduced-motion; the real re-rank stays on the
  daily cron
- **SEO baseline**: per-route metadata, sitemap.xml and robots.txt driven by
  NEXT_PUBLIC_SITE_URL, and a brand Open Graph image. The landing marketing
  copy is server-rendered in the initial HTML for crawlers
- **Pricing**: a public /pricing page with provisional Free, Pro, and Team
  plans. The only action is Request access, which writes an upgradeRequests
  row for a signed-in user. There is no payment processing anywhere yet;
  Stripe is a future supervised session

## Stack and testing

Convex is the entire backend runtime: schema, typed queries, realtime feed,
actions for the OpenAI and scrape work, a daily cron, and vector scoring.
Next.js App Router with Convex Auth password sign-in behind the invite gate.
The test suite runs on vitest with convex-test and the edge runtime, 70 tests
green, no real OpenAI calls: tests either stub the key so any call throws and
prove zero calls, or stub fetch and count. convex/isolation.test.ts and
convex/limits.test.ts are the hard gates.

## Domain language

The product's canonical terms, unchanged. Use these exact words in copy and
code; the `_Avoid_` list is deliberate.

**You** — the user, the root of the warm network and the graph origin.
_Avoid_: ego, root node, me

**Connection** — a person you already know directly (1st degree), from your
real LinkedIn connections.
_Avoid_: friend, contact, mutual

**Tie strength** — how warm a Connection actually is, from real interaction
history, not mere presence in your network.
_Avoid_: closeness, score

**Lead** — a person you ultimately want to reach, the valuable end target. Must
be reachable through at least one Warm path; a goal-matching person with no
path is cold and is not a Lead.
_Avoid_: target, prospect, end user

**Connector** — a person who can introduce you to one or more Leads, the
bridge. A Connector is in your network (ask directly) or not (befriend first).
A high Unlock value Connector opens a whole room and is worth converting even
when cold, but it is the same role.
_Avoid_: warm intro, gatekeeper, intro, referrer

**Unlock value** — the size and quality of the Lead set a Connector reaches.
_Avoid_: reach score, leverage

**Intro score** — how good a specific Connector is for a specific Lead: your
Tie strength to the Connector times how well the Connector knows the Lead.
Picks the best few from many mutuals.
_Avoid_: match, relevance

**ICP** — the profile of the people you want, derived from your Goal and
product, that Leads are ranked against and that thumbs feedback refines.
_Avoid_: persona, segment

**Warm path** — the chain You → Connector(s) → Lead that makes the
introduction possible.
_Avoid_: route, degree chain

**Mutual** — the shared Connection shown for a Lead, the visible proof of the
Warm path, the Connector you would actually ask.
_Avoid_: using mutual to mean any 1st-degree Connection

**Goal** — the stated objective the feed ranks Leads against, captured at
onboarding and editable any time.
_Avoid_: query, intent

**Why** — why to reach out: short bullets on fit against your ICP, grounded in
real activity.
_Avoid_: explanation, thinking

**How** — how to land it: concrete bullets plus a drafted opener. Draft only,
never auto-sent.
_Avoid_: action, outreach

**Score** — a row's rank against the Goal: goal-fit times warm-reachability.
Embeddings sort the pool, the LLM judge scores the shortlist.
_Avoid_: rating, match

**Event** — a real-world gathering people attend, a go-meet-them channel where
a Lead or Connector will be present.
_Avoid_: meetup, occasion
