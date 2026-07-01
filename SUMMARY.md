# Warmline — Phase 1 Overnight Polish

Branch: `zach/overnight-polish` (do not merge to main). All nine tasks completed.
Every task was committed after `npx tsc --noEmit`, `npm run lint`, and `npm test`
passed, and the final `npm run build` exits 0.

## Result at a glance

- **tsc**: clean (0 errors)
- **lint**: 0 errors, 6 warnings (all pre-existing or expected, see notes)
- **tests**: 43 passing across 11 files (was 31)
- **build**: `next build` completes with exit code 0

## Per-task changes

**0. Lint baseline (prerequisite)** — `commit d8f748c`
The baseline lint was already red: 9 `no-explicit-any` errors in
`convex/seedDemo.ts`. Added light interfaces for the demo JSON shape and dropped
the `as any[]` casts. Behavior unchanged. Needed so every task could pass the
lint gate.

**1. Brand assets and theme** — `commit ca40288`
- Shipped the brand SVGs to `public/brand/` and set `app/icon.svg` (favicon /
  app icon) to the amber app-icon tile.
- Replaced the wifi-signal `WarmlineMark` with the three-node "W" monogram, drawn
  with `currentColor` (no hardcoded hex), plus a composed `WarmlineLockup` used in
  the sidebar and onboarding. The wordmark renders in Schibsted Grotesk.
- Rethemed `app/globals.css` to the brand tokens (warm charcoal background,
  off-white text, amber primary/ring) through the Tailwind `@theme` variables as
  the single source of truth; retinted velour/champagne/shadows warm.
- Loaded Schibsted Grotesk via `next/font/google`; headings and the wordmark use it.
- Note: the lockup is composed (amber mark + wordmark) rather than an `<img>` of
  `warmline-lockup-dark.svg`, because an external SVG `<img>` cannot pick up the
  page's next/font face, so the wordmark would fall back to system sans. The SVG
  files are still shipped to `public/brand/`.

**2. Feedback that responds on click** — `commit a4ed1fa`
- The feed reads existing votes via `feedback.forIcp` and fills the selected
  thumb amber (the other stays muted). Voting uses `withOptimisticUpdate` to write
  into the `forIcp` cache immediately, then the server query confirms. State reads
  back correctly after reload.
- Test: vote then read-back, plus re-vote replaces.

**3. Feedback that shifts ranking (core wiring)** — `commit 68aeb5f`
- Added a pure, bounded `nudgeVector` helper (new `lib.ts` export; existing
  scoring untouched) and a `voteVectors` internalQuery that joins this ICP's
  feedback to already-cached person embeddings.
- `rank.rebuild` now bends a per-run scoring vector toward up-voted people and
  away from down-voted people (single constant `VOTE_NUDGE = 0.15`) and re-scores
  candidates. No new OpenAI calls. `icp.vector` stays the derived baseline, so the
  shift lands on the next rank run (cron or manual re-rank), not on click.
- Tests: nudge direction + score-drop (pure), and the DB join + a down-voted
  lead's goal-fit dropping (convex-test, no OpenAI).

**4. Real profile photos** — `commit 3f35e4d`
- Graph nodes now render `avatarUrl` (added to `graph.pathForPerson`) with an
  initials fallback on load error, so a broken URL never shows a broken-image
  icon. The feed already rendered `avatarUrl` via Radix Avatar (auto-fallback).
- `enrichTop`/`enrichFeed` no longer throw without `FIBER_API_KEY`: Fiber is used
  only when keyed, else unavatar by handle/slug, else initials. Wired a
  best-effort `enrichTop` into the daily cron (guarded, never blocks).
- Test: `needingAvatars` target selection (avatar-less, has handle, top by tie).

**5. Relevance score column** — `commit b43df66`
- Added a Relevance column showing the ranker's existing 0-100 `score` as a
  tabular number plus a subtle amber bar. Read straight from `row.score`, no
  recompute. Rows are already sorted by score, so the column reads top-down.
  (Score presence and descending order are covered by existing feed tests.)

**6. Fix the copy at the source** — `commit 71f558a`
- Rewrote the judge system prompt: plain English, no em dashes, no
  "this, not that" contrasts, no trailing period on the last sentence of any
  why/how bullet or the opener. Added good and bad examples. The JSON output
  schema the parser reads is unchanged.
- Added `sanitizeCopy` (pure, tested) applied to judge output as a safety net so
  the feed's why/how/opener always drop em dashes and trailing periods even if the
  model slips.
- Swept user-facing UI strings: removed em dashes and "not" contrasts and dropped
  trailing periods in the feed and the main onboarding copy and the connectors
  description.

**7. Fix the Mutuals "No path yet" display** — `commit 8a1fa62`
- Gatekeeper connectors (like Han Wang, `roles: ["gatekeeper"]` in the seed) are
  themselves the warm path. Their feed row now shows the leads they unlock as an
  avatar stack with a true total count, instead of the misleading "No path yet".
  Leads still show their bridging connectors. The empty state is reserved for rows
  with no edges either way and softened to "No warm path yet". Feed returns a new
  `mutualsTotal`.
- Test: a connector with fan-out edges shows a stack (length 3) with the true
  total (4).

**8. Onboarding personal vs company toggle** — `commit 93aef6c`
- Added a first onboarding step asking whether the feed is for one person or a
  company / growth team. The choice reframes the derived-goal prompt (new pure
  `icpSystemPrompt`, unit-tested) and the fallback goal text, and changes visible
  copy on the product step. Persisted additively on `icp.audience` and threaded
  through `onboard.generate -> saveIcp`. Both paths run `rebuild` and reach a
  ranked feed.
- CRM integration and network pooling are left as a roadmap note (comment in
  `onboard.ts`), not built.
- Tests: `icpSystemPrompt` framing differs per audience; `saveIcp` persists the
  audience.

**9. Graph spacing and feed density** — `commit d88699e`
- Graph: column x now derives from node width plus a label-sized gap, and row
  spacing derives from node height, so the You -> connector -> target path is
  evenly spaced with no overlap. Long edge evidence labels are truncated so they
  never cover a node. No new dependency added.
- Seed: added `devSeed.seedNetwork`, a fully synthetic network (34 leads, 12
  connectors with fan-out including one gatekeeper, bridge edges of the app's
  shape) so the feed shows ~40 rows locally with no key. All people are invented,
  companies are public brand names, and there are no private contact details.
- Test: `seedNetwork` yields a healthy feed (20-50 rows) with connector fan-outs,
  a gatekeeper, and leads carrying bridging mutuals.

## Manual steps for the owner

1. **Convex deployment env keys** (set on the deployment, never committed):
   - `OPENAI_API_KEY` — required for real ranking (embeddings + the judge). The
     app UI degrades without it (heuristic feed, demo/dev seed), but the ranker
     action and onboarding ICP derivation will throw if it is called without a key.
   - `FIRECRAWL_API_KEY` — optional; onboarding site scraping. Falls back to the
     audience-framed default goal text when absent.
   - `FIBER_API_KEY` — optional; avatar enrichment. Falls back to unavatar, then
     initials.
2. **Seed a substantive local feed**: run `npx convex run devSeed:seedNetwork`
   (synthetic ~40-row network), or `node scripts/loadDemo.mjs` for the curated
   demo dataset. An ICP row must exist or the app redirects to onboarding.
3. **Avatar refresh** runs on the daily cron; to run it now:
   `npx convex run avatars:enrichTop`.

## Notes and honest caveats

- **Logo zip name**: the file in the repo root is `__Warmline_Logo_Design.zip.zip`
  (a doubled `.zip` extension). It was present and unzipped fine; the SVGs from its
  `exports/` folder were moved into `public/brand/`.
- **Context7 / Exa MCP tools were not connected this session**, so the Convex
  optimistic-update API (`withOptimisticUpdate`, `OptimisticLocalStore`) was
  verified against the installed `convex` types via `tsc` rather than live docs.
- **Lint warnings (6, zero errors)**: `.better-design/eslint-design-system.mjs`
  anonymous default export; four `no-unused-vars` on `e` in `extension/*.js`
  (pre-existing); one `@next/next/no-img-element` on the graph avatar `<img>`. The
  `<img>` is intentional: avatar URLs come from arbitrary domains (Convex storage,
  unavatar) and need an `onError` fallback, which `next/image` cannot do cleanly
  inside a React Flow node.
- **Copy sweep scope**: all em dashes and "X, not Y" constructions were removed
  from user-facing strings, and trailing periods were removed from the feed and
  the main onboarding paragraphs. A few short onboarding card-label fragments
  still end with a period; these are labels rather than sentences and were left to
  avoid churn. The ranker's generated copy is enforced by prompt + `sanitizeCopy`.
- **Out-of-scope items** (untouched per the brief): authentication, per-user /
  multi-tenant scoping, Google/X OAuth, scraping, DM reading. The connector OAuth
  routes remain the existing untested scaffold.
