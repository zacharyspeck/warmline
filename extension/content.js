// content.js — runs on https://www.linkedin.com/in/* (a profile you open).
//
// It NEVER captures on its own. It only scrapes when the popup asks it to (a
// user click on "Capture"), replying with the profile person (the Lead) and the
// mutual connections LinkedIn shows (the Connectors on the warm path):
//   { leadSlug, leadName, mutuals: [{ name, slug }] }
//
// We only ever READ the DOM (no clicks, no navigation). LinkedIn markup rotates
// constantly, so every selector below is best-effort with fallbacks and is
// flagged "SELECTOR:" — if capture breaks, these are the lines to update.

(function () {
  "use strict";

  // Pull the LinkedIn slug out of any /in/<slug>/ href.
  function slugFromHref(href) {
    if (!href) return null;
    var m = String(href).match(/\/in\/([^/?#]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // Name for an /in/ anchor: prefer img alt / aria-label, fall back to text.
  function nameForAnchor(a) {
    var img = a.querySelector("img[alt]");
    var name =
      (img && img.getAttribute("alt")) ||
      a.getAttribute("aria-label") ||
      a.textContent;
    name = clean(name);
    name = name
      .replace(/^view\s+/i, "")
      .replace(/[’']s profile.*$/i, "")
      .replace(/\s*•.*$/, "")
      .trim();
    return name;
  }

  // The Lead (this profile page).
  function currentProfile() {
    var slug = slugFromHref(location.pathname);
    // SELECTOR: profile name <h1>. Class names churn; fall back to first main h1.
    var h1 =
      document.querySelector("h1.text-heading-xlarge") ||
      document.querySelector("main h1") ||
      document.querySelector("h1");
    return { slug: slug, name: clean(h1 && h1.textContent) };
  }

  // Find the element anchoring the mutual-connections module.
  function findMutualAnchor() {
    // SELECTOR: the "N mutual connections" link → /search/...facetConnectionOf=
    var byFacet =
      document.querySelector('a[href*="facetConnectionOf"]') ||
      document.querySelector('a[href*="connectionOf"]');
    if (byFacet) return byFacet;
    // SELECTOR: text fallback — any node reading "… mutual connection(s)".
    var nodes = document.querySelectorAll("a, span, p, div");
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i].textContent || "";
      if (/mutual connection/i.test(t) && t.length < 200) return nodes[i];
    }
    return null;
  }

  // Climb to the surrounding card so we scope the /in/ harvest.
  function cardFor(anchor) {
    var node = anchor;
    for (var i = 0; i < 5 && node && node.parentElement; i++) {
      node = node.parentElement;
      if (node.querySelectorAll('a[href*="/in/"]').length > 1) break;
    }
    return node || anchor;
  }

  // Collect {name, slug} for each visible mutual connection.
  function collectMutuals() {
    var anchor = findMutualAnchor();
    if (!anchor) return [];
    var card = cardFor(anchor);
    var self = slugFromHref(location.pathname);
    var seen = Object.create(null);
    var out = [];
    var links = card.querySelectorAll('a[href*="/in/"]');
    for (var i = 0; i < links.length; i++) {
      var slug = slugFromHref(links[i].getAttribute("href"));
      if (!slug || slug === self || seen[slug]) continue;
      seen[slug] = true;
      out.push({ name: nameForAnchor(links[i]), slug: slug });
    }
    return out;
  }

  // User-initiated only: reply to the popup's capture request. No auto-send.
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== "warmline:capture") return false;
    try {
      var lead = currentProfile();
      if (!lead.slug) {
        sendResponse({ ok: false, error: "Open a LinkedIn profile first" });
        return true;
      }
      sendResponse({
        ok: true,
        payload: {
          leadSlug: lead.slug,
          leadName: lead.name || lead.slug,
          mutuals: collectMutuals(),
        },
      });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  });
})();
