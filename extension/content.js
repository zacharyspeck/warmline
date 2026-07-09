// content.js — runs on LinkedIn profile (/in/*) and people-search (/search/*)
// pages. It NEVER captures on its own. It only scrapes when the popup asks (a
// user click), replying with what it read. We only READ the DOM (no clicks, no
// navigation).
//
// LinkedIn markup rotates constantly, so every selector below is best-effort
// with fallbacks and flagged "SELECTOR:" — if capture breaks, these are the
// lines to update.

(function () {
  "use strict";

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

  function currentProfile() {
    var slug = slugFromHref(location.pathname);
    // SELECTOR: profile name <h1>.
    var h1 =
      document.querySelector("h1.text-heading-xlarge") ||
      document.querySelector("main h1") ||
      document.querySelector("h1");
    return { slug: slug, name: clean(h1 && h1.textContent) };
  }

  // The element anchoring the mutual-connections module, plus its facet link.
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

  function facetHrefFor(anchor) {
    if (!anchor) return null;
    var a =
      (anchor.matches &&
        anchor.matches('a[href*="facetConnectionOf"], a[href*="connectionOf"]') &&
        anchor) ||
      (anchor.querySelector &&
        (anchor.querySelector('a[href*="facetConnectionOf"]') ||
          anchor.querySelector('a[href*="connectionOf"]')));
    var href = a && a.getAttribute("href");
    if (!href) return null;
    try {
      return new URL(href, "https://www.linkedin.com").toString();
    } catch {
      return href;
    }
  }

  function cardFor(anchor) {
    var node = anchor;
    for (var i = 0; i < 5 && node && node.parentElement; i++) {
      node = node.parentElement;
      if (node.querySelectorAll('a[href*="/in/"]').length > 1) break;
    }
    return node || anchor;
  }

  // Parse the named-inline variant text, e.g.
  //   "Phil and Fred are mutual connections"
  //   "Phil, Fred, and 3 other mutual connections"
  //   "Phil is a mutual connection"
  // Returns the NAMED people (the "N other" are unnamed and excluded).
  function parseNamedMutuals(text) {
    var t = clean(text);
    if (!/mutual connection/i.test(t)) return [];
    var m = t.match(/^(.*?)\s+(?:is a|are)\s+mutual connection/i);
    var namesPart = m ? m[1] : null;
    if (!namesPart) {
      var m2 = t.match(/^(.*?)\s+mutual connection/i);
      namesPart = m2 ? m2[1] : null;
    }
    if (!namesPart) return [];
    // Drop a trailing "and N other(s)" clause.
    namesPart = namesPart.replace(/,?\s*and\s+[\d,]+\s+other[s]?$/i, "");
    var parts = namesPart
      .split(/,|\band\b/i)
      .map(clean)
      .filter(function (p) {
        return p && !/^\d/.test(p) && !/^other/i.test(p);
      });
    return parts;
  }

  // Find the named mutuals inside a module. LinkedIn frequently renders the
  // facet link as a COUNT-only anchor ("12 mutual connections") while the named
  // sentence ("Phil and Fred are mutual connections") sits in a nested <span>
  // — and a parent's textContent can fold in avatar initials, a degree badge,
  // or visually-hidden text that breaks the parse. So we can't read one node's
  // text: we scan `root` and its descendants and keep the SHORTEST text that
  // still parses to a name — the tightest, cleanest node holding the sentence.
  function namedMutualsIn(root) {
    if (!root) return [];
    var best = [];
    var bestLen = Infinity;
    function consider(el) {
      var t = clean(el && el.textContent);
      if (!t || t.length > 300 || !/mutual connection/i.test(t)) return;
      var names = parseNamedMutuals(t);
      if (names.length && t.length < bestLen) {
        best = names;
        bestLen = t.length;
      }
    }
    consider(root);
    var nodes = root.querySelectorAll
      ? root.querySelectorAll("span, div, p, a, li")
      : [];
    for (var i = 0; i < nodes.length; i++) consider(nodes[i]);
    return best;
  }

  // Mutuals shown on a profile: slug-bearing /in/ links first, else the
  // named-inline text variant (name-only). Also returns the facet href so the
  // popup can offer the results-page capture.
  function collectProfileMutuals() {
    var anchor = findMutualAnchor();
    var facetHref = facetHrefFor(anchor);
    if (!anchor) return { mutuals: [], pattern: "none", facetHref: facetHref };

    var card = cardFor(anchor);
    var self = slugFromHref(location.pathname);
    var seen = Object.create(null);
    var linkMutuals = [];
    var links = card.querySelectorAll('a[href*="/in/"]');
    for (var i = 0; i < links.length; i++) {
      var slug = slugFromHref(links[i].getAttribute("href"));
      if (!slug || slug === self || seen[slug]) continue;
      seen[slug] = true;
      linkMutuals.push({ name: nameForAnchor(links[i]), slug: slug });
    }
    if (linkMutuals.length) {
      return { mutuals: linkMutuals, pattern: "links", facetHref: facetHref };
    }

    // Named-inline variant: scan the module (not just the anchor's own text)
    // for the tightest node holding "… are mutual connections".
    var searchRoot =
      (anchor.closest && anchor.closest("section")) || card || anchor;
    var named = namedMutualsIn(searchRoot);
    if (named.length) {
      return {
        mutuals: named.map(function (n) {
          return { name: n };
        }),
        pattern: "named-inline",
        facetHref: facetHref,
      };
    }
    return { mutuals: [], pattern: "none", facetHref: facetHref };
  }

  // Best-effort headline for a search result row.
  function headlineForResult(a) {
    var row = a;
    for (var i = 0; i < 5 && row && row.parentElement; i++) {
      row = row.parentElement;
      if (row.querySelectorAll('a[href*="/in/"]').length > 1) {
        row = a.parentElement; // too broad; fall back near the link
        break;
      }
    }
    // SELECTOR: result subtitle / headline.
    var sub =
      (row && row.querySelector('.entity-result__primary-subtitle')) ||
      (row && row.querySelector('[class*="subtitle"]'));
    return sub ? clean(sub.textContent) : "";
  }

  // The visible people-search result rows (the mutual-connections list).
  function collectSearchResults() {
    var seen = Object.create(null);
    var out = [];
    // SELECTOR: results live in <main>; scoping there skips the nav avatar.
    var scope = document.querySelector("main") || document;
    var links = scope.querySelectorAll('a[href*="/in/"]');
    for (var i = 0; i < links.length && out.length < 50; i++) {
      var slug = slugFromHref(links[i].getAttribute("href"));
      if (!slug || seen[slug]) continue;
      var name = nameForAnchor(links[i]);
      if (!name) continue;
      seen[slug] = true;
      var headline = headlineForResult(links[i]);
      out.push({
        name: name,
        slug: slug,
        headline: headline || undefined,
      });
    }
    return out;
  }

  // User-initiated only. No auto-send. Guarded so this file can also be
  // imported outside the extension (the parser is unit-tested against a DOM
  // fixture), where `chrome` does not exist.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage)
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return false;

    if (msg.type === "warmline:capture") {
      try {
        var lead = currentProfile();
        if (!lead.slug) {
          sendResponse({ ok: false, error: "Open a LinkedIn profile first" });
          return true;
        }
        var found = collectProfileMutuals();
        sendResponse({
          ok: true,
          pattern: found.pattern,
          facetHref: found.facetHref,
          payload: {
            leadSlug: lead.slug,
            leadName: lead.name || lead.slug,
            mutuals: found.mutuals,
          },
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }

    if (msg.type === "warmline:captureResults") {
      try {
        sendResponse({ ok: true, mutuals: collectSearchResults() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }

    return false;
  });

  // Expose the pure parsing helpers for unit tests (no-op in the browser,
  // where `module` is undefined).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseNamedMutuals: parseNamedMutuals,
      namedMutualsIn: namedMutualsIn,
      facetHrefFor: facetHrefFor,
      slugFromHref: slugFromHref,
    };
  }
})();
