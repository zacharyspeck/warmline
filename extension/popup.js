// popup.js — connect the extension (paste the server URL + a Settings token),
// and capture the LinkedIn profile in the active tab on a click. No background
// worker, no queue, no crawling: one user click, one capture.

const URL_KEY = "warmline:serverUrl";
const TOKEN_KEY = "warmline:token";

const $ = (id) => document.getElementById(id);

function getLocal(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function setLocal(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + (kind || "muted");
}

async function loadConfig() {
  const cfg = await getLocal([URL_KEY, TOKEN_KEY]);
  if (cfg[URL_KEY]) $("serverUrl").value = cfg[URL_KEY];
  if (cfg[TOKEN_KEY]) $("token").value = cfg[TOKEN_KEY];
  const connected = Boolean(cfg[URL_KEY] && cfg[TOKEN_KEY]);
  $("connState").textContent = connected
    ? "Connected. Ready to capture"
    : "Paste your server URL and token, then Save";
}

$("saveBtn").addEventListener("click", async () => {
  const serverUrl = $("serverUrl").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();
  await setLocal({ [URL_KEY]: serverUrl, [TOKEN_KEY]: token });
  await loadConfig();
  setStatus("Connection saved", "ok");
});

function activeTab() {
  return new Promise((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs && tabs[0]),
    ),
  );
}

function askContentForProfile(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "warmline:capture" }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "Open a LinkedIn profile first" });
      } else {
        resolve(resp || { ok: false, error: "No response from the page" });
      }
    });
  });
}

$("captureBtn").addEventListener("click", async () => {
  const cfg = await getLocal([URL_KEY, TOKEN_KEY]);
  const serverUrl = (cfg[URL_KEY] || "").trim().replace(/\/+$/, "");
  const token = (cfg[TOKEN_KEY] || "").trim();
  if (!serverUrl || !token) {
    setStatus("Save your server URL and token first", "err");
    return;
  }

  const tab = await activeTab();
  if (!tab || !/https:\/\/www\.linkedin\.com\/in\//.test(tab.url || "")) {
    setStatus("Open a LinkedIn profile (linkedin.com/in/…) first", "err");
    return;
  }

  $("captureBtn").disabled = true;
  setStatus("Reading the profile…", "muted");
  try {
    const scraped = await askContentForProfile(tab.id);
    if (!scraped.ok) {
      setStatus(scraped.error || "Could not read this page", "err");
      return;
    }
    setStatus("Sending to Warmline…", "muted");
    const res = await fetch(`${serverUrl}/extension/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(scraped.payload),
    });
    if (res.status === 401) {
      setStatus("Token rejected. Generate a fresh one in Settings", "err");
      return;
    }
    if (res.status === 429) {
      setStatus("You have captured a lot recently. Try again shortly", "err");
      return;
    }
    if (!res.ok) {
      setStatus(`Capture failed (${res.status})`, "err");
      return;
    }
    const data = await res.json().catch(() => ({}));
    const name = scraped.payload.leadName || scraped.payload.leadSlug;
    setStatus(
      `Captured ${name} with ${data.edges ?? 0} mutual connection${
        data.edges === 1 ? "" : "s"
      }`,
      "ok",
    );
  } catch {
    setStatus("Network error. Check the server URL", "err");
  } finally {
    $("captureBtn").disabled = false;
  }
});

loadConfig();
