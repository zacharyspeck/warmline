# Manual TODO

Steps that need the owner. Started during the autonomous run on 1 July 2026;
the wrap-up section at the bottom is added at the end of the run.

## Blockers hit during the run

- **Task 5 (design skin): no design reference PNGs exist in the repo.**
  Neither `design/` nor `exports/` is present, so the Happenstance-caliber
  screen rebuild had nothing to match against. Only tasks 6 through 9 of the
  skin pass were done. Commit the reference PNGs (e.g. under `design/`) and
  re-run the skin task
- **Owner decision: token-gated extension writes into the public demo.**
  With `WARMLINE_EXTENSION_TOKEN` set, the browser extension can write real
  LinkedIn names into the demo account that the public landing page displays
  (anonymous writes are already rejected). The privacy page was worded to
  match ("a demo account we curate"), but decide whether production should
  reject demo-account extension writes entirely so the demo stays fully
  synthetic
