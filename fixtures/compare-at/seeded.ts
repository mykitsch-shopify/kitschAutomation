/**
 * The defects the seeded fixture profile plants, and nothing else.
 *
 * Separate from server.ts because that module listens on a port as an import
 * side effect. The detection check needs this list without starting a server,
 * and importing it from server.ts started a second one on the default port.
 */

export type SeededDefect = {
  readonly handle: string;
  readonly kind: 'compare_at_still_rendered' | 'price_mismatch' | 'price_not_observed';
  readonly note: string;
};

/**
 * Chosen from the three ACTIVE products that actually showed a strikethrough,
 * plus two ordinary ones, so the planted set covers both the visible-change
 * rows and the invisible majority.
 */
export const SEEDED: readonly SeededDefect[] = [
  {
    handle: 'volumizing-thermal-round-brush',
    kind: 'compare_at_still_rendered',
    note: 'import missed this row; $79.99 is still struck through',
  },
  {
    handle: 'kitsch-large-thermal-round-brush-haze-blue',
    kind: 'compare_at_still_rendered',
    note: 'same, on the second of the two thermal brushes',
  },
  {
    handle: 'recycled-plastic-medium-rhinestone-cloud-claw-clip-camel',
    kind: 'price_mismatch',
    note: 'compare-at cleared but the price moved from $7 to $9 in the process',
  },
  {
    handle: 'black-flat-cloud-clip-large',
    kind: 'compare_at_still_rendered',
    note: 'a row whose compare-at equalled its price, now rendering as a strikethrough',
  },
  {
    handle: 'satin-pillowcase-ivory',
    kind: 'price_not_observed',
    note: 'price markup absent, so the page cannot be judged either way',
  },
];
