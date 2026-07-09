// @vitest-environment node
//
// Regression pin for the named-inline mutual-connections capture. On the live
// layout each mutual's name is wrapped in its own <strong> directly inside the
// facet anchor (connectors in sibling spacer spans), so no single node's text
// matches the full "… are mutual connections" sentence — the tightest-text
// scan returned nothing and a profile showing two mutuals reported zero. We now
// read each <strong> as a name.
//
// linkedom gives us a real DOM (no browser env needed) so we exercise the
// actual extraction, not a hand-rolled fake.
import { parseHTML } from "linkedom";
import { expect, test } from "vitest";
import content from "./content.js";

const { strongNamesIn, namedMutualsIn, facetHrefFor, parseNamedMutuals } =
  content as {
    strongNamesIn: (anchor: Element) => string[];
    namedMutualsIn: (root: Element) => string[];
    facetHrefFor: (anchor: Element) => string | null;
    parseNamedMutuals: (text: string) => string[];
  };

// Verbatim live markup: <strong>-wrapped names, sibling spacer spans, and a
// connectionOf facet href.
const LIVE = `<a class="_69ebbc25 _6398628b" href="https://www.linkedin.com/search/results/people/?origin=MEMBER_PROFILE_CANNED_SEARCH&network=%5B%22F%22%5D&connectionOf=%5B%22ACoAAB8mJpQBTshB0v3XqwPcmCPYoRPsCB53uN8%22%5D" target="_blank"><strong>Phil</strong><span class="_915571b0 _3b42afd3"> </span>and<span class="_915571b0 _3b42afd3"> </span><strong>Fred</strong><span class="_915571b0 _3b42afd3"> </span>are mutual connections</a>`;

test("named-inline: reads both <strong> names and preserves the facet href", () => {
  const { document } = parseHTML(`<body>${LIVE}</body>`);
  const anchor = document.querySelector("a")!;

  expect(strongNamesIn(anchor)).toEqual(["Phil", "Fred"]);

  const href = facetHrefFor(anchor);
  expect(href).toContain("connectionOf");
});

test("named-inline: 'A, B, and N other' keeps only the named people", () => {
  const { document } = parseHTML(
    `<body><section><a href="/x?facetConnectionOf=1"><span>Ada, Grace, and 7 other mutual connections</span></a></section></body>`,
  );
  // No <strong> here, so the sentence-text fallback carries it.
  expect(strongNamesIn(document.querySelector("a")!)).toEqual([]);
  expect(namedMutualsIn(document.querySelector("a")!)).toEqual(["Ada", "Grace"]);
});

test("count-only facet link yields no named mutuals", () => {
  const { document } = parseHTML(
    `<body><section><a href="/x?facetConnectionOf=1"><span>1,234 mutual connections</span></a></section></body>`,
  );
  expect(strongNamesIn(document.querySelector("a")!)).toEqual([]);
  expect(namedMutualsIn(document.querySelector("a")!)).toEqual([]);
  // And the pure string parser agrees, for good measure.
  expect(parseNamedMutuals("1,234 mutual connections")).toEqual([]);
});
