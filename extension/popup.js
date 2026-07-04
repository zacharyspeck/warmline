// popup.js — connect the extension (paste the server URL + a Settings token),
// then capture in two steps, both click-only:
//   1. On a profile you're viewing, "Capture this profile" grabs the lead and
//      whatever mutuals the profile shows (slug links, or the named-inline
//      "A and B are mutual connections" variant matched by name server-side).
//   2. If you then open that lead's "mutual connections" results page, the
//      popup offers "Capture mutuals shown for [lead]" to grab the visible
//      rows (with slugs) as edges to the same lead.
// No background worker, no queue, no crawling.

const URL_KEY = "warmline:serverUrl";
const TOKEN_KEY = "warmline:token";
const PENDING_KEY = "warmline:pendingFacet";
const PENDING_TTL_MS = 30 * 60 * 1000; // association expires after 30 minutes

const $ = (id) => document.getElementById(id);

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function setLocal(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
function removeLocal(key) {
  return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + (kind || "muted");
}
function setDiag(text) {
  $("diag").textContent = text || "";
}

// The facetConnectionOf value identifies a lead's mutual-connections results,
// independent of URL formatting. Used to tie a results page to a capture.
function facetKey(href) {
  try {
    const u = new URL(href, "https://www.linkedin.com");
    return u.searchParams.get("facetConnectionOf") || u.searchParams.get("connectionOf");
  } catch {
    return null;
  }
}

function activeTab() {
  return new Promise((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs && tabs[0]),
    ),
  );
}

function ask(tabId, type) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "Open a LinkedIn page first" });
      } else {
        resolve(resp || { ok: false, error: "No response from the page" });
      }
    });
  });
}

async function config() {
  const cfg = await getLocal([URL_KEY, TOKEN_KEY]);
  return {
    serverUrl: (cfg[URL_KEY] || "").trim().replace(/\/+$/, ""),
    token: (cfg[TOKEN_KEY] || "").trim(),
  };
}

async function freshPending() {
  const stored = (await getLocal(PENDING_KEY))[PENDING_KEY];
  if (!stored || !stored.facetKey) return null;
  if (Date.now() - (stored.ts || 0) > PENDING_TTL_MS) {
    await removeLocal(PENDING_KEY);
    return null;
  }
  return stored;
}

// POST a capture to the server. Returns { ok, data, status }.
async function postCapture(payload) {
  const { serverUrl, token } = await config();
  if (!serverUrl || !token) {
    return { ok: false, error: "Save your server URL and token first" };
  }
  const res = await fetch(`${serverUrl}/extension/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) return { ok: false, error: "Token rejected. Generate a fresh one in Settings" };
  if (res.status === 429) return { ok: false, error: "You have captured a lot recently. Try again shortly" };
  if (!res.ok) return { ok: false, error: `Capture failed (${res.status})` };
  return { ok: true, data: await res.json().catch(() => ({})) };
}

function reportCounts(prefix, pattern, data) {
  const shown = data.shown ?? 0;
  const matched = data.matched ?? 0;
  const skipped = data.skipped ?? 0;
  setStatus(`${prefix} — ${matched} of ${shown} mutuals captured`, "ok");
  setDiag(
    `pattern: ${pattern} · shown ${shown} · matched ${matched} · skipped ${skipped}` +
      (skipped > 0 && pattern === "named-inline"
        ? " · open the mutual-connections list to capture the rest"
        : ""),
  );
}

// ── UI state ─────────────────────────────────────────────────────────────────

async function refresh() {
  const cfg = await config();
  $("serverUrl").value ||= cfg.serverUrl;
  $("token").value ||= cfg.token;
  const connected = Boolean(cfg.serverUrl && cfg.token);
  $("connState").textContent = connected
    ? "Connected. Ready to capture"
    : "Paste your server URL and token, then Save";

  const tab = await activeTab();
  const url = (tab && tab.url) || "";
  const onProfile = /https:\/\/www\.linkedin\.com\/in\//.test(url);
  const onResults = /https:\/\/www\.linkedin\.com\/search\/results\/people/.test(url);

  $("captureBtn").disabled = !onProfile;

  // Offer the results-page capture only when the current results page matches a
  // fresh capture's facet.
  const pending = await freshPending();
  const curKey = onResults ? facetKey(url) : null;
  if (pending && curKey && curKey === pending.facetKey) {
    $("captureResultsBtn").style.display = "block";
    $("captureResultsBtn").textContent = `Capture mutuals shown for ${pending.leadName}`;
  } else {
    $("captureResultsBtn").style.display = "none";
  }

  if (!onProfile && !(pending && curKey === pending?.facetKey)) {
    setStatus("Open a LinkedIn profile, then click Capture", "muted");
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

$("saveBtn").addEventListener("click", async () => {
  const serverUrl = $("serverUrl").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  await setLocal({ [URL_KEY]: serverUrl, [TOKEN_KEY]: token });
  await refresh();
  setStatus("Connection saved", "ok");
});

$("captureBtn").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab || !/https:\/\/www\.linkedin\.com\/in\//.test(tab.url || "")) {
    setStatus("Open a LinkedIn profile (linkedin.com/in/…) first", "err");
    return;
  }
  $("captureBtn").disabled = true;
  setStatus("Reading the profile…", "muted");
  setDiag("");
  try {
    const scraped = await ask(tab.id, "warmline:capture");
    if (!scraped.ok) {
      setStatus(scraped.error || "Could not read this page", "err");
      return;
    }
    // Remember the lead + facet so the results-page capture can offer itself.
    const key = facetKey(scraped.facetHref || "");
    if (key) {
      await setLocal({
        [PENDING_KEY]: {
          leadSlug: scraped.payload.leadSlug,
          leadName: scraped.payload.leadName,
          facetKey: key,
          ts: Date.now(),
        },
      });
    }
    setStatus("Sending to Warmline…", "muted");
    const res = await postCapture(scraped.payload);
    if (!res.ok) {
      setStatus(res.error, "err");
      return;
    }
    reportCounts(
      scraped.payload.leadName || scraped.payload.leadSlug,
      scraped.pattern || "none",
      res.data,
    );
    await refresh();
  } catch {
    setStatus("Network error. Check the server URL", "err");
  } finally {
    $("captureBtn").disabled = false;
  }
});

$("captureResultsBtn").addEventListener("click", async () => {
  const pending = await freshPending();
  if (!pending) {
    setStatus("That capture expired. Recapture the profile first", "err");
    await refresh();
    return;
  }
  const tab = await activeTab();
  $("captureResultsBtn").disabled = true;
  setStatus("Reading the results…", "muted");
  setDiag("");
  try {
    const scraped = await ask(tab.id, "warmline:captureResults");
    if (!scraped.ok) {
      setStatus(scraped.error || "Could not read the results", "err");
      return;
    }
    setStatus("Sending to Warmline…", "muted");
    const res = await postCapture({
      leadSlug: pending.leadSlug,
      leadName: pending.leadName,
      mutuals: scraped.mutuals || [],
    });
    if (!res.ok) {
      setStatus(res.error, "err");
      return;
    }
    reportCounts(`${pending.leadName} (from results)`, "results-page", res.data);
  } catch {
    setStatus("Network error. Check the server URL", "err");
  } finally {
    $("captureResultsBtn").disabled = false;
  }
});

refresh();
