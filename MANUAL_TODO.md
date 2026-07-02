# Manual TODO

Everything that needs the owner, from the autonomous run on 1 July 2026.
Companion handoff: `artifacts/2026-07-01-session-handoff.md` (local only).

## Review and merge

- **Review and merge `zach/phase2-accounts` first** (Phases D, E, F: demo,
  invite gate, cost caps, delete-my-data, privacy/terms, plus two adversarial
  review passes with all confirmed findings fixed). 21 commits ahead of the
  old branch point, suite at 69/69, build green
- **Then review `zach/design-skin`** (branched from phase2-accounts: nav,
  vote-wheel motion, copy sweep, one review pass with 13 findings fixed).
  9 commits, suite 69/69, build green. Merging design-skin brings
  phase2-accounts with it

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

On `zach/design-skin`, additionally:

6. Sidebar shows Feed / Connectors / Onboarding / Settings signed in
7. Vote a thumbs on a feed row: the row animates to the bottom in ~350ms,
   thumb stays selected; with OS reduced-motion on, it moves instantly
8. Expand a row's graph, vote a DIFFERENT row: the open panel moves with its
   parent row, no detach
9. Onboarding from the nav with an existing account: "Back to your feed" link
   and the replace-warning banner appear
10. `/connectors`: header copy says only you can search; Google/Outlook
    dialogs promise no email reading

## Money and keys

- **Set a hard monthly usage limit in the OpenAI dashboard with
  auto-recharge OFF.** convex/limits.ts caps calls, the dashboard limit caps
  dollars; you want both
- **Choose and set the production INVITE_CODE** when a prod deployment
  exists: `npx convex env set INVITE_CODE <value> --prod`. Signups are
  rejected while unset (fail closed). The dev deployment already has a random
  one (`npx convex env get INVITE_CODE`)
- **Set WARMLINE_EXTENSION_TOKEN on any deployment where the extension should
  work.** Extension routes are now fail-closed: unset token = anonymous 401s
- **Revisit the convex/limits.ts numbers after a few days of E3 logs**
  (the 14:00 UTC `[usage]` line and `usage:adminToday`). free judge=25,
  embed=400, scrape=5; global judge=400, embed=4000, scrape=40; cron 6
  judges/user/run were set by reasoning, not data

## Launch infrastructure

- Buy the domain; set up Vercel (this repo builds clean with
  `npm run build`) and a production Convex deployment; set OPENAI_API_KEY,
  INVITE_CODE, WARMLINE_EXTENSION_TOKEN, and the OAuth client env vars there
- The Convex Auth prod setup needs JWT keys on the prod deployment
  (`npx @convex-dev/auth` or the dashboard init)

## Product decisions and content

- **Commit the design reference PNGs** (task 5 found none anywhere in the
  repo, so the Happenstance-caliber screen rebuild never ran). Put them under
  `design/` and re-run the skin task
- **Decide: should production reject token-gated extension writes into the
  demo account?** Anonymous writes are already rejected; with the token, real
  LinkedIn names you browse can enter the publicly visible demo. The privacy
  page words around this ("a demo account we curate"), but fully-synthetic
  is cleaner
- **Read /privacy and /terms for voice.** They were written to be honest and
  plain, and they now enumerate raw export files, connected-account emails,
  and cached photos; make sure the tone is yours
- Re-onboarding replaces the goal and re-ranks from scratch (old votes stay
  attached to the old goal). The wizard now warns and offers an exit; decide
  whether you eventually want goal EDITING instead of replacement
- `scripts/loadDemo.mjs` is still untracked (it now shells out to
  `npx convex run seedDemo:loadDemo` since the loader went internal). Commit
  it if you want it in history; `RUN_PLAN.md` at the root can be deleted once
  this run is reviewed
