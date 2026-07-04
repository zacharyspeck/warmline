# Warmline — Capture LinkedIn profiles extension

A tiny Manifest V3 Chrome extension. On a **LinkedIn profile you are viewing**
(`linkedin.com/in/<slug>`), you click **Capture** in the popup. It reads that
profile (a **Lead**) and its visible **mutual connections** (the **Connectors**
on your **Warm path**) and posts them to Warmline, which stores the person as a
lead and each mutual as a `linkedin_mutual` edge (`connector → lead`) in **your**
graph, then recomputes bridges and re-ranks your feed.

Capture is **user-initiated only**. There is no background worker, no queue, and
no crawling: one click, one capture. Plain JavaScript, no build step.

```
extension/
  manifest.json   MV3 manifest (content script on /in/*, popup action)
  content.js      reads a profile's DOM only when the popup asks (on your click)
  popup.html/js   connect (server URL + token) and the Capture button
  README.md       this file
```

## Auth

Every capture carries a **scoped token** you generate in Warmline **Settings →
Browser extension**. The server hashes the token, resolves your account, and
stamps every write with your user id. Only the hash is stored, so the token is
shown once and can be regenerated but not re-read. There is no anonymous or demo
write path.

## HTTP contract

```
POST <SERVER_URL>/extension/capture
Content-Type: application/json
Authorization: Bearer <your token>

{ "leadSlug": "jane-doe-123", "leadName": "Jane Doe",
  "mutuals": [ { "name": "Sam Lee", "slug": "sam-lee-456" }, ... ] }

200 → { "edges": 3, "leadSlug": "jane-doe-123" }
401 → missing/invalid token
429 → per-user rate limit hit
```

Implemented in `convex/http.ts` + `convex/extension.ts` + `convex/extensionAuth.ts`.
The lead is deduped through the same `ingestLeads` overlap logic (promoted in
place if you already know them, never duplicated); re-capturing the same profile
does not create duplicate edges.

## Setup

1. **Install.** Download the zip from the Warmline **Connectors** page (the
   Download button), unzip it, then in `chrome://extensions` turn on **Developer
   mode** and **Load unpacked** the unzipped folder.
2. **Connect.** In Warmline **Settings → Browser extension**, copy the **Server
   URL** and generate a **token**. Open the extension popup, paste both, and click
   **Save connection**. (The server URL is your deployment's `*.convex.site`
   origin, shown in Settings.)
3. **Capture.** Open a `linkedin.com/in/...` profile you want as a lead and click
   **Capture this profile**. The popup reports the lead and how many mutual
   connections it captured.

## Selectors will drift

LinkedIn rotates its CSS class names constantly. Every DOM selector in
`content.js` is best-effort with fallbacks and flagged `SELECTOR:` in comments.
If capture stops finding mutuals, those are the lines to update. Many profile
layouts render only the mutuals' avatars (linking to a search facet, not
per-person `/in/` links), so a capture can legitimately return few or zero
slug-bearing mutuals; the lead itself is still captured.

## Pacing caveat

LinkedIn rate-limits automated access. This extension is passive (it only fires
when you click Capture on a profile you opened), and there is a per-user
server-side rate limit, but keep captures paced like a human.
