// @vitest-environment node
//
// Regression pin for the named-inline mutual-connections capture. LinkedIn
// renders "Phil and Fred are mutual connections" inside a nested <span> within
// the facet anchor, alongside a degree badge and avatar initials that the
// anchor's own textContent folds together — which defeated a single-node parse
// and reported zero mutuals on a profile that plainly showed two.
//
// linkedom gives us a real DOM (no browser env needed) so we exercise the
// actual descendant scan, not a hand-rolled fake.
import { parseHTML } from "linkedom";
import { expect, test } from "vitest";
import content from "./content.js";

const { namedMutualsIn, facetHrefFor, parseNamedMutuals } = content as {
  namedMutualsIn: (root: Element) => string[];
  facetHrefFor: (anchor: Element) => string | null;
  parseNamedMutuals: (text: string) => string[];
};

// The exact reported shape: a single facet anchor whose visible names live in a
// nested <span>, next to a visually-hidden degree line and avatar initials.
const NAMED_INLINE = `
  <section>
    <a href="https://www.linkedin.com/search/results/people/?facetConnectionOf=%5B%22ACoAAB123%22%5D&origin=MEMBER_PROFILE_CANOS">
      <span class="visually-hidden">3rd degree connection</span>
      <span aria-hidden="true"><span>PS</span><span>FJ</span></span>
      <span class="mutuals-sentence">Phil and Fred are mutual connections</span>
    </a>
  </section>`;

test("named-inline: extracts both names from the nested span, not the anchor's folded text", () => {
  const { document } = parseHTML(`<body>${NAMED_INLINE}</body>`);
  const anchor = document.querySelector("a")!;

  // Reading the anchor's whole text folds in "3rd degree connection PSFJ …",
  // which the single-node parse could not recover both names from. The
  // descendant scan finds the tight sentence span and gets both.
  expect(namedMutualsIn(anchor)).toEqual(["Phil", "Fred"]);

  // The facet href still survives for the results-page handoff.
  const href = facetHrefFor(anchor);
  expect(href).toContain("facetConnectionOf");
});

test("named-inline: 'A, B, and N other' keeps only the named people", () => {
  const { document } = parseHTML(
    `<body><section><a href="/x?facetConnectionOf=1"><span>Ada, Grace, and 7 other mutual connections</span></a></section></body>`,
  );
  expect(namedMutualsIn(document.querySelector("a")!)).toEqual(["Ada", "Grace"]);
});

test("count-only facet link yields no named mutuals", () => {
  const { document } = parseHTML(
    `<body><section><a href="/x?facetConnectionOf=1"><span>1,234 mutual connections</span></a></section></body>`,
  );
  expect(namedMutualsIn(document.querySelector("a")!)).toEqual([]);
  // And the pure string parser agrees, for good measure.
  expect(parseNamedMutuals("1,234 mutual connections")).toEqual([]);
});
