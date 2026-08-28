/**
 * Template markers that reached the customer — in the text *and* in the
 * attributes.
 *
 * The render layer already scans `body.innerText`. That is half the page. The
 * Kitsch health check of 2026-04-28 found exactly two issues across twenty
 * PDPs, and they divide neatly on this line:
 *
 *   ISSUE 2  `<div class="sr-only">Quick view of {{ product_title }}</div>`
 *            — sr-only is clipped, not hidden, so innerText carries it and the
 *            existing check catches it.
 *   ISSUE 1  `aria-label="Translation missing: en.products.product
 *            .quick_view.close"` — an attribute. innerText has never seen it,
 *            and never will.
 *
 * Measured rather than assumed: rendering both in a browser and reading
 * innerText returns the first and not the second. So a scan of visible text
 * alone would have validated one of that report's two findings and passed the
 * other as clean — on all twenty products.
 *
 * That asymmetry is not a curiosity. Both defects are invisible to a sighted
 * shopper and audible to a screen reader, which is the population least able to
 * work around them, and it means the surface where these leak *most* is the
 * surface a text scan covers *least*.
 */

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type MarkerKind =
  /** Shopify's literal when a locale key is absent at request time. */
  | 'translation_missing'
  /** A Liquid or Alpine variable that was never bound. */
  | 'unbound_variable';

/** Where a marker was found. Attributes carry which one, so a fix has an address. */
export type MarkerSite =
  | { readonly kind: 'text' }
  | { readonly kind: 'attribute'; readonly attribute: string; readonly selector: string };

export type Marker = {
  readonly kind: MarkerKind;
  readonly site: MarkerSite;
  /** The marker with enough surrounding text to find it in the template. */
  readonly quote: string;
  readonly severity: Severity;
};

/** One attribute value observed on the page. */
export type ObservedAttribute = {
  /** A selector a person can paste into devtools. */
  readonly selector: string;
  readonly attribute: string;
  readonly value: string;
};

export type PageSnapshot = {
  readonly url: string;
  /** `body.innerText` — what a sighted shopper reads. */
  readonly text: string;
  /** Attribute values a screen reader reads. */
  readonly attributes: readonly ObservedAttribute[];
};

/**
 * Attributes worth scanning: every one of them is spoken, or shown when
 * something else fails.
 *
 * Deliberately not "all attributes" — `data-*` payloads and JSON blobs
 * legitimately carry Liquid-looking braces in analytics config, and flagging
 * those would bury the real findings under noise that never reaches anybody.
 */
export const SPOKEN_ATTRIBUTES: readonly string[] = [
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'title',
  'placeholder',
  'label',
];

const PATTERNS: readonly {
  readonly kind: MarkerKind;
  readonly test: RegExp;
  readonly meaning: string;
}[] = [
  {
    kind: 'translation_missing',
    // Shopify renders "Translation missing: en.some.key". Matched case
    // insensitively because themes have been seen to title-case it.
    test: /translation missing:?\s*[\w.]*/iu,
    meaning: 'a locale key is unresolved at request time',
  },
  {
    kind: 'unbound_variable',
    // `{{ x }}` from Liquid or Alpine. The closing braces are required so a
    // lone brace in copy — "{{" appears in code samples — is not a finding.
    test: /\{\{\s*[\w.[\]'"| -]+\s*\}\}/u,
    meaning: 'a template variable was never substituted',
  },
];

/**
 * A marker in an attribute is major, in visible text it is critical.
 *
 * Not a judgement about which user matters. Visible copy is seen by every
 * shopper and screenshots into a support ticket within the hour; an attribute
 * reaches a smaller audience and reaches it silently, which makes it more
 * likely to survive for months and less likely to stop a sale today. Both are
 * defects and both get a ticket.
 */
const severityFor = (site: MarkerSite): Severity =>
  site.kind === 'text' ? 'critical' : 'major';

const quote = (value: string, at: number, marker: string): string =>
  `${value.slice(Math.max(0, at - 30), at + marker.length + 30).replace(/\s+/gu, ' ').trim()}`;

/**
 * Every marker on the page, text and attributes alike.
 *
 * Reports each occurrence rather than the first: a theme-level leak shows up
 * on every card in a grid, and "one finding" would understate a defect that is
 * on the page forty times.
 */
export const findMarkers = (snapshot: PageSnapshot): readonly Marker[] => {
  const found: Marker[] = [];

  for (const pattern of PATTERNS) {
    const global = new RegExp(pattern.test.source, `${pattern.test.flags}g`);
    for (const match of snapshot.text.matchAll(global)) {
      found.push({
        kind: pattern.kind,
        site: { kind: 'text' },
        quote: quote(snapshot.text, match.index, match[0]),
        severity: severityFor({ kind: 'text' }),
      });
    }
  }

  for (const observed of snapshot.attributes) {
    for (const pattern of PATTERNS) {
      const match = pattern.test.exec(observed.value);
      if (match === null) continue;
      const site: MarkerSite = {
        kind: 'attribute',
        attribute: observed.attribute,
        selector: observed.selector,
      };
      found.push({
        kind: pattern.kind,
        site,
        quote: `${observed.selector}[${observed.attribute}] = "${observed.value.trim()}"`,
        severity: severityFor(site),
      });
    }
  }

  return found;
};

/** One line per marker, addressed enough to fix without reproducing it. */
export const describeMarker = (marker: Marker): string => {
  const meaning = PATTERNS.find((pattern) => pattern.kind === marker.kind)?.meaning ?? marker.kind;
  const where =
    marker.site.kind === 'text'
      ? 'visible copy'
      : `${marker.site.attribute} (read aloud by screen readers, invisible on screen)`;
  return `${meaning} — in ${where}: ${marker.quote}`;
};

/**
 * Whether a page is clean of a specific claimed marker.
 *
 * Used when re-checking an issue from a health-check report: the question is
 * not "are there markers" but "is *this* one still there".
 */
export const stillPresent = (markers: readonly Marker[], needle: string): boolean =>
  markers.some((marker) => marker.quote.toLowerCase().includes(needle.toLowerCase()));
