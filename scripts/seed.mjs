// Local seed loader — reads your real exports and pushes them into Convex.
// PII NEVER leaves your machine except as graph rows in your own Convex deploy.
//
// ⚠️ DEPRECATED since Phase 2 (multi-user): the ingest mutations now require a
// signed-in user and stamp rows with the caller's userId, so this unauthenticated
// script fails with "Not authenticated". Use the in-app LinkedIn upload
// (Connectors page) for real data, or `npx convex run devSeed:seedNetwork` for
// synthetic data.
//
//   node scripts/seed.mjs            # ingest
//   node scripts/seed.mjs --reset    # wipe Warmline tables first
//
// Requires: `npx convex dev` running (so ingest functions are deployed) and
// NEXT_PUBLIC_CONVEX_URL in .env.local. Point DATA_DIR at your export folder.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import dotenv from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

dotenv.config({ path: ".env.local" });

const DATA_DIR =
  process.env.DATA_DIR || join(homedir(), "Desktop", "YC hackathon");
const ZIP = join(DATA_DIR, "Complete_LinkedInDataExport_06-25-2026.zip.zip");
const LEADS = join(DATA_DIR, "Config Leads - SF 2026.csv");

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL (.env.local).");
  process.exit(1);
}
const client = new ConvexHttpClient(url);

// ── helpers ──────────────────────────────────────────────────────────────
// RFC4180-ish parser: handles quotes, escaped quotes, embedded commas/newlines.
function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function linkedinSlug(u) {
  if (!u) return undefined;
  const m = u.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}
function xHandle(u) {
  if (!u) return undefined;
  const m = u.match(/(?:twitter|x)\.com\/([^/?#\s]+)/i);
  if (!m) return undefined;
  const h = m[1].toLowerCase();
  return h === "i" || h === "home" ? undefined : h.replace(/^@/, "");
}
function unzip(member) {
  return execFileSync("unzip", ["-p", ZIP, member], {
    maxBuffer: 1 << 30,
  }).toString("utf8");
}
function colIndex(header, name) {
  return header.findIndex((h) => h.trim().toUpperCase() === name.toUpperCase());
}
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    const res = await fn(items.slice(i, i + size));
    process.stdout.write(
      `\r  ${Math.min(i + size, items.length)}/${items.length} ${JSON.stringify(res)}   `,
    );
  }
  process.stdout.write("\n");
}

// ── reset ────────────────────────────────────────────────────────────────
if (process.argv.includes("--reset")) {
  console.log("Wiping Warmline tables…");
  let total = 0;
  for (;;) {
    const { deleted } = await client.mutation(api.ingest.clearBatch, {});
    total += deleted;
    process.stdout.write(`\r  deleted ${total}   `);
    if (deleted === 0) break;
  }
  console.log("\n  done.");
}

// ── tie strength from messages.csv ─────────────────────────────────────────
// Each message is between you and one other party. Count per counterpart slug.
console.log("Reading messages (tie strength)…");
const msgRows = parseCSV(unzip("messages.csv"));
const mHead = msgRows[0] ?? [];
const senderCol = colIndex(mHead, "SENDER PROFILE URL");
const recipCol = colIndex(mHead, "RECIPIENT PROFILE URLS");
const senderFreq = new Map();
const pairCount = new Map(); // slug -> message count
const msgData = msgRows.slice(1);
for (const r of msgData) {
  const s = linkedinSlug(r[senderCol]);
  if (s) senderFreq.set(s, (senderFreq.get(s) || 0) + 1);
}
// You = the most frequent sender of your own message archive.
const selfSlug =
  [...senderFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
  "marvinkaunda";
for (const r of msgData) {
  const parties = [
    linkedinSlug(r[senderCol]),
    ...(r[recipCol] || "").split(/\s+/).map(linkedinSlug),
  ].filter((s) => s && s !== selfSlug);
  for (const slug of new Set(parties))
    pairCount.set(slug, (pairCount.get(slug) || 0) + 1);
}
const tieStrength = (slug) => {
  const n = pairCount.get(slug) || 0;
  return n === 0 ? undefined : 1 - 1 / (1 + n); // 0 → undefined, many → ~1
};
console.log(`  self=${selfSlug}, ${pairCount.size} counterparts with messages`);

// ── self ───────────────────────────────────────────────────────────────────
await client.mutation(api.ingest.ingestSelf, {
  name: "Marvin Kaunda",
  linkedinUrl: selfSlug,
  xHandle: "kaundamarvin",
});

// ── connections.csv → warm intros ──────────────────────────────────────────
console.log("Reading connections…");
const connRows = parseCSV(unzip("Connections.csv"));
const cHeadIdx = connRows.findIndex(
  (r) => r[0]?.trim() === "First Name" && r[2]?.trim() === "URL",
);
const cHead = connRows[cHeadIdx];
const ci = {
  first: colIndex(cHead, "First Name"),
  last: colIndex(cHead, "Last Name"),
  url: colIndex(cHead, "URL"),
  company: colIndex(cHead, "Company"),
  position: colIndex(cHead, "Position"),
};
const connections = connRows
  .slice(cHeadIdx + 1)
  .map((r) => {
    const slug = linkedinSlug(r[ci.url]);
    const name = `${r[ci.first] || ""} ${r[ci.last] || ""}`.trim();
    if (!name && !slug) return null;
    return {
      name: name || slug,
      linkedinUrl: slug,
      company: r[ci.company]?.trim() || undefined,
      headline: r[ci.position]?.trim() || undefined,
      tieStrength: slug ? tieStrength(slug) : undefined,
    };
  })
  .filter(Boolean);
console.log(`  ${connections.length} connections → ingesting`);
await inBatches(connections, 200, (rows) =>
  client.mutation(api.ingest.ingestConnections, { rows }),
);

// ── config leads → leads + events + attendance ─────────────────────────────
if (existsSync(LEADS)) {
  console.log("Reading Config Leads…");
  const leadRows = parseCSV(readFileSync(LEADS, "utf8"));
  const lHead = leadRows[0];
  const li = {
    event: colIndex(lHead, "Event"),
    guest: colIndex(lHead, "Guest"),
    x: colIndex(lHead, "X profile"),
    linkedin: colIndex(lHead, "Linkedin"),
    date: colIndex(lHead, "Date"),
  };
  const leads = leadRows
    .slice(1)
    .map((r) => {
      const slug = linkedinSlug(r[li.linkedin]);
      const handle = xHandle(r[li.x]);
      const name = (r[li.guest] || "").trim();
      if (!name && !slug && !handle) return null;
      const d = Date.parse(r[li.date] || "");
      return {
        name: name || slug || handle,
        linkedinUrl: slug,
        xHandle: handle,
        eventName: r[li.event]?.trim() || undefined,
        eventDate: Number.isNaN(d) ? undefined : d,
        confidence: 1,
      };
    })
    .filter(Boolean);
  console.log(`  ${leads.length} lead rows → ingesting`);
  await inBatches(leads, 200, (rows) =>
    client.mutation(api.ingest.ingestLeads, { rows }),
  );
} else {
  console.log(`No leads CSV at ${LEADS} — skipping.`);
}

console.log("✅ seed complete.");
