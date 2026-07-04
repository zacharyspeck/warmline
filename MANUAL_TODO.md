# Manual TODO

Everything that needs the owner, across the autonomous runs on 1-2 July 2026.
Companion handoffs in `artifacts/` (local only): `2026-07-01-session-handoff.md`
and `2026-07-02-session-handoff.md`.

## Launch-polish run (`zach/launch-polish`, 3-4 July 2026)

Branched from `zach/design-skin`; core-loop, mobile/polish, hardening, and
content, one commit per task with per-section adversarial reviews.

### Draft content pages need your voice pass

- `/compare/happenstance` and `/guides/warm-intros` are DRAFTS. They are
  unlinked and noindex (robots `noindex,nofollow`, absent from the sitemap and
  the nav), follow the copy rules, and are factual and generous about
  Happenstance. But they are in my voice, not yours. Do a voice pass before you
  link them anywhere or make them indexable. The Happenstance facts were checked
  against happenstance.ai and third-party reviews in July 2026; re-verify the
  claims before you publish.

## Review and merge

- **Review and merge `zach/phase2-accounts` first** (Phases D, E, F: demo,
  invite gate, cost caps, delete-my-data, privacy/terms, plus two adversarial
  review passes with all confirmed findings fixed, plus the extension
  lockdown `8afc379`). Suite 69/69, build green
- **Then review `zach/design-skin`** (branched from phase2-accounts, then
  merged it back in): the six-screen skin rebuild to the committed design
  references, the SEO baseline, and the /pricing surface, with two review
  passes fixed. Suite 70/70, build green. Merging design-skin brings
  phase2-accounts with it
- **Review the provisional pricing numbers before merge** (Free / Pro $20 a
  month / Team). They are placeholders labeled provisional on the page, set by
  reasoning not owner decision; confirm or change them

## Browser verification checklist

On `zach/phase2-accounts` (run `npm run dev`, seed the demo with
`node scripts/loadDemo.mjs` if demo-local/demo-data.json exists):

1. Signed out, open `/`: marketing headline + CTA render, demo feed loads,
   clicking a row traces the warm-path graph, thumbs open the sign-up dialog
   and write nothing
2. Click Create your feed → toggle to Sign up: email, password, and the
   Invite code field. Wrong code shows "Invalid invite code"; the real code
   (`npx convex env get INVITE_CODE`) creates the account
3. Sign in as yourself: your feed on `/`, never demo rows; `/privacy` and
   `/terms` load signed out; footer links on the sign-in card work
4. Settings → type `delete my data` on a THROWAWAY account → confirm you land
   signed-out on the demo landing and the account is gone (Convex dashboard:
   users/persons/usage rows and _storage blobs)
5. Convex dashboard → run `usage:adminToday`, confirm per-user counts; check
   the 14:00 UTC `[usage]` log line the next day

On `zach/design-skin`, additionally (the rebuilt screens and pricing):

6. Sign-in and create-account (S1): centered dark card, W lockup, one amber
   button, invite-code field on Create account, no Google button, no Forgot
   link, footer Privacy/Terms links resolve
7. Onboarding (S2): amber W with step dashes, the two audience radio cards
   with the amber selected ring, "Back to your feed" + replace warning when an
   account already has a goal
8. Feed (S3): the card list with photo, why lines, the warm-intro pill, the
   mutual stack, and the amber Relevance number; the sidebar shows Who to
   reach out to / Connectors / Goals with a Settings gear in the footer
9. Vote-wheel (S4): thumbs a card and it cycles toward the bottom on a
   sub-400ms spring, thumb stays selected, amber left edge appears; with OS
   reduced-motion on it snaps. Vote, then immediately click a sidebar item or
   reload within the animation: the vote must still persist (the regression
   the review caught)
10. Connectors (S5): LinkedIn is the hero drag-and-drop, drop a real export and
    watch it import; the other sources are one-line rows with Connect dialogs;
    Google/Outlook dialogs promise no mail access
11. Person view (S6): expand a card for the three-node warm path (You, bridge,
    amber target), why-fits bullets, and the Copy-opener card
12. Pricing (`/pricing`): three plans, provisional; signed in, Request access
    on Pro or Team writes a row (verify with `npx convex run
    upgrade:adminListRequests`); signed out, the CTA routes to sign in
13. SEO: `/robots.txt` and `/sitemap.xml` serve; view-source on `/` shows the
    marketing headline in the initial HTML; `/opengraph-image` renders the
    brand card

## Money and keys

- **Set a hard monthly usage limit in the OpenAI dashboard with
  auto-recharge OFF.** convex/limits.ts caps calls, the dashboard limit caps
  dollars; you want both
- **Choose and set the production INVITE_CODE** when a prod deployment
  exists: `npx convex env set INVITE_CODE <value> --prod`. Signups are
  rejected while unset (fail closed). The dev deployment already has a random
  one (`npx convex env get INVITE_CODE`)
- **WARMLINE_EXTENSION_TOKEN is retired** (`8afc379` on zach/phase2-accounts):
  extension routes accept only a signed-in user's JWT and write to the
  caller's own graph. Unset the env var wherever it exists; the Chrome
  extension needs Convex Auth wiring before it works again
- **Revisit the convex/limits.ts numbers after a few days of E3 logs**
  (the 14:00 UTC `[usage]` line and `usage:adminToday`). free judge=25,
  embed=400, scrape=5; global judge=400, embed=4000, scrape=40; cron 6
  judges/user/run were set by reasoning, not data

## Launch infrastructure

- Buy the domain; set up Vercel (this repo builds clean with
  `npm run build`) and a production Convex deployment; set OPENAI_API_KEY,
  INVITE_CODE, and the OAuth client env vars there
- **Set NEXT_PUBLIC_SITE_URL after the domain purchase** (placeholder in
  .env.example). sitemap.xml, robots.txt, and the Open Graph URLs read it;
  until it is set they fall back to `http://localhost:3000`, which is fine for
  dev but wrong for a deployed sitemap submitted to search engines
- The Convex Auth prod setup needs JWT keys on the prod deployment
  (`npx @convex-dev/auth` or the dashboard init)

## Future supervised sessions

- **Stripe / payment wiring.** The /pricing page's Request access funnel
  writes an upgradeRequests row and nothing more; there is no payment code
  anywhere by design. Wiring real checkout is its own supervised session and
  needs the owner's Stripe account and keys (publishable + secret + webhook
  signing secret), which cannot be provisioned autonomously. The
  upgradeRequests table and `upgrade:adminListRequests` are the handoff point

## Product decisions and content

- ~~Commit the design reference PNGs~~ **RESOLVED 2 July 2026**: the owner
  supplied the zip, the six PNGs (S1-S6) are committed under
  `design/screens/`, and all six screens were rebuilt to match them
- **Forgot-password link (deferred decision).** The S1 reference shows a
  "Forgot?" link, deliberately omitted because no password-reset flow exists.
  Convex Auth's Password provider supports a reset flow (email + code), but it
  needs an email sender configured. Decide whether to build reset before
  launch; until then, a locked-out beta user is reset by hand
- ~~Decide: token-gated extension writes into the demo account~~ **RESOLVED
  1 July 2026**: the token path is removed entirely in `8afc379` on
  zach/phase2-accounts. Extension writes require a signed-in user and land in
  the caller's own graph; demo content changes only via the cron and internal
  admin loaders. The demo is now unconditionally synthetic, so consider
  simplifying the privacy page's "a demo account we curate" wording back to
  plain "synthetic people" when you next touch it
- **Read /privacy and /terms for voice.** They were written to be honest and
  plain, and they now enumerate raw export files, connected-account emails,
  and cached photos; make sure the tone is yours
- Re-onboarding replaces the goal and re-ranks from scratch (old votes stay
  attached to the old goal). The wizard now warns and offers an exit; decide
  whether you eventually want goal EDITING instead of replacement
- `scripts/loadDemo.mjs` is still untracked (it now shells out to
  `npx convex run seedDemo:loadDemo` since the loader went internal). Commit
  it if you want it in history; `RUN_PLAN.md` and `RUN_PLAN_2.md` at the root,
  and the two `# Warmline Logo Design.zip` archives, can be deleted once these
  runs are reviewed (the design PNGs are already committed under
  `design/screens/`)
