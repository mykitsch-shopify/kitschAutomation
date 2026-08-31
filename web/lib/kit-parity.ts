import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { normalizeTitle } from './top-products.js';

/**
 * Welcome-kit free-item parity — pure logic.
 *
 * What this catches that an API check cannot: two kits can hold identical
 * line items and still make different promises to the customer. One shows
 * "Free" where the other shows a struck-through price; one auto-adds the
 * gift, the other waits to be noticed; one lets the gift be deleted on its
 * own. None of that is visible in the product payload — it lives in how the
 * theme renders and how the cart behaves.
 *
 * Deliberately a *comparison*, never an expectation. The live winter kit
 * defines correct; the summer kits are measured against it. So this file
 * contains no opinion about what a free item should do, which is what keeps
 * it right when merchandising changes the reference.
 *
 * ── Everything is read from the CART, not the PDP ────────────────────────
 *
 * It used to be read from both. The PDP half is gone, and not because it was
 * less interesting — because mykitsch.com does not render it. The theme lists
 * no kit contents on the product page: the only repeating structure inside
 * `.main-product` is the image gallery, so `kit_item` matched nothing on every
 * kit and there is no selector anybody could write that would change that.
 * There is no free-gift selector on the page either.
 *
 * A dimension that cannot be observed does not fail — it falls to its default
 * on both kits, they agree, and the run goes green having looked at nothing.
 * That is the failure mode this suite exists to prevent, so the unobservable
 * dimensions were removed rather than left in place to be silently skipped.
 *
 * What is lost, said plainly: the §12 "no MSRP leakage on the PDP" check and
 * the §7 badge check, as read from the product page, and the §7 gift-selector
 * count (WK-TC-020, 024). The money questions all survive, because the cart
 * and the order summary do render — and the cart is where a leaked price
 * actually costs someone money.
 */

export type KitDimension =
  | 'free_line_count'
  | 'paid_line_count'
  | 'free_line_price_label'
  | 'counted_in_subtotal'
  | 'independently_removable'
  | 'removed_with_qualifying_product'
  | 'free_at_checkout';

export const ALL_DIMENSIONS: readonly KitDimension[] = [
  'free_line_count',
  'paid_line_count',
  'free_line_price_label',
  'counted_in_subtotal',
  'independently_removable',
  'removed_with_qualifying_product',
  'free_at_checkout',
];

/**
 * How one kit treats its free items, as a customer would experience it.
 *
 * `free_line_count` and `paid_line_count` are both here on purpose, and the
 * pair is what makes a finding legible. Adding the qualifying product to an
 * empty cart should produce one paid line and one free one. If the gift is
 * never added, free goes 1 → 0 and paid stays 1. If the gift is added but
 * charged, free goes 1 → 0 and paid goes 1 → 2. Either alone reads as "the
 * gift is missing"; together they say which of the two actually happened.
 */
export type KitProfile = {
  /** Cart lines that cost the customer nothing. Zero means no gift arrived. */
  readonly free_line_count: number;
  /** Cart lines that cost money. A charged gift shows up as one of these. */
  readonly paid_line_count: number;
  /** Normalised, sorted — "Free", "FREE" and " free " are the same promise. */
  readonly free_line_price_label: readonly string[];
  readonly counted_in_subtotal: boolean;
  readonly independently_removable: boolean;
  readonly removed_with_qualifying_product: boolean;
  readonly free_at_checkout: boolean;
};

export type KitSpec = {
  readonly name: string;
  readonly handle: string;
  /**
   * What the storefront currently calls this product, read off the page.
   *
   * A handle resolving 200 does not mean it still points at the kit anybody
   * meant. `winter-welcome-kit-combos` resolves and serves a page titled
   * "Shampoo & Conditioner Bundle with Free Welcome Kit" — the reference has
   * been renamed, and nothing here would have said so. The identical backstop
   * in config/top-products.yaml caught four wrong products the same way.
   *
   * Undefined means it has not been recorded yet, which is reported as
   * unverified rather than passed over in silence.
   */
  readonly canonicalTitle: string | undefined;
};

export type SelectorName =
  | 'pdp_title'
  | 'pdp_price'
  | 'pdp_compare_at'
  | 'add_to_cart'
  | 'cart_line'
  | 'cart_line_price'
  | 'cart_line_remove'
  | 'cart_subtotal'
  | 'checkout_button'
  | 'summary_line'
  | 'summary_price';

const SELECTOR_NAMES: readonly SelectorName[] = [
  'pdp_title', 'pdp_price', 'pdp_compare_at', 'add_to_cart', 'cart_line',
  'cart_line_price', 'cart_line_remove', 'cart_subtotal', 'checkout_button',
  'summary_line', 'summary_price',
];

/**
 * Whether the page on screen is still the product the config names.
 *
 * Normalised the same way top-products does it — case, ampersands and dash
 * variants folded — so a typographic change is not reported as a rename.
 */
export const isSameProduct = (canonicalTitle: string, observed: string): boolean =>
  normalizeTitle(canonicalTitle) === normalizeTitle(observed);

export type KitConfig = {
  readonly reference: KitSpec;
  readonly candidates: readonly KitSpec[];
  readonly compare: readonly KitDimension[];
  readonly selectors: Readonly<Record<SelectorName, string>>;
  readonly freePricePattern: RegExp;
};

export type KitDifference = {
  readonly dimension: KitDimension;
  readonly reference: string;
  readonly candidate: string;
  readonly explanation: string;
};

/** Why each dimension matters, quoted straight into the finding. */
const WHY: Readonly<Record<KitDimension, string>> = {
  free_line_count:
    'Adding the qualifying product puts a different number of free lines in the cart. A drop to zero is the auto-add failing: the gift is only received if the customer goes and finds it. Test plan §8, WK-TC-017 and 021.',
  paid_line_count:
    'Adding the qualifying product puts a different number of paid lines in the cart. Read this beside free_line_count: if free fell and paid rose, the gift is in the cart and being charged for, which is a different defect from the gift not arriving at all.',
  free_line_price_label:
    'The free line is priced differently to the customer in the cart — "Free", "$0.00" and a struck-through price are three different promises. Test plan §12, WK-TC-018 and 022.',
  counted_in_subtotal:
    'The free item contributes to the subtotal in one kit and not the other, so the same promise produces different order values.',
  independently_removable:
    'The free item can be removed on its own in one kit but not the other — that is a different product, not a different price. Test plan §7: the free gift cannot be removed or charged separately.',
  removed_with_qualifying_product:
    'Removing the qualifying product takes the free kit with it in one and leaves it behind in the other. A free kit stranded in the cart is either given away unearned or charged for. Test plan §8, negative cases.',
  free_at_checkout:
    'The free item is $0 in one kit and not the other by the time the customer reaches the order summary — the last place anyone looks and the only one that takes money. Test plan §10.',
};

export const normalizeLabel = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en');

/** Sorted and normalised so ordering in the DOM is not mistaken for a defect. */
export const normalizeLabels = (values: readonly string[]): readonly string[] =>
  [...values.map(normalizeLabel).filter((value) => value !== '')].sort();

const render = (value: number | boolean | readonly string[]): string =>
  Array.isArray(value) ? (value.length === 0 ? '(none)' : value.join(', ')) : String(value);

/**
 * Every way `candidate` handles free items differently from `reference`.
 * Empty means the two are handled identically across the compared dimensions.
 */
export const diffKits = (
  reference: KitProfile,
  candidate: KitProfile,
  dimensions: readonly KitDimension[] = ALL_DIMENSIONS,
): readonly KitDifference[] =>
  dimensions.flatMap((dimension) => {
    // Compared through `render` rather than by structural equality: each
    // dimension has one fixed type, so the rendered form is faithful, and it
    // is the same string the report shows — so a difference can never be
    // reported with text that does not explain it.
    const left = render(reference[dimension]);
    const right = render(candidate[dimension]);

    return left === right
      ? []
      : [{ dimension, reference: left, candidate: right, explanation: WHY[dimension] }];
  });

// ── config loading ────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`kits.yaml: expected a non-empty string at "${at}"`);
  }
  return value;
};

const parseKit = (value: unknown, at: string): KitSpec => {
  if (!isRecord(value)) {
    throw new Error(`kits.yaml: expected a mapping at "${at}"`);
  }
  return {
    name: requireString(value.name, `${at}.name`),
    handle: requireString(value.handle, `${at}.handle`),
    // Optional, and absent is a real state rather than a placeholder: the
    // candidates' live titles have not been read off the store yet. Blank and
    // whitespace-only are treated as absent so a half-filled row cannot pass
    // an identity check against the empty string.
    canonicalTitle:
      typeof value.canonical_title === 'string' && value.canonical_title.trim() !== ''
        ? value.canonical_title.trim()
        : undefined,
  };
};

/**
 * Whether a rendered price means "this costs nothing".
 *
 * Classifying by price text rather than by a `data-free` attribute is what
 * lets the same spec run against a real theme: the fixture's attribute is a
 * fixture invention, but every storefront has to tell the customer the price
 * one way or another.
 */
export const isFreePrice = (value: string, pattern: RegExp): boolean =>
  new RegExp(pattern.source, pattern.flags).test(normalizeLabel(value));

export const loadKitConfig = (path = 'config/kits.yaml'): KitConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.candidates) || !Array.isArray(raw.compare)) {
    throw new Error(`${path}: expected "reference", "candidates" and "compare"`);
  }

  const compare = raw.compare.map((entry, index) => {
    const dimension = requireString(entry, `compare[${String(index)}]`);
    if (!ALL_DIMENSIONS.includes(dimension as KitDimension)) {
      throw new Error(
        `kits.yaml: "${dimension}" is not a known dimension. Known: ${ALL_DIMENSIONS.join(', ')}`,
      );
    }
    return dimension as KitDimension;
  });

  if (compare.length === 0) {
    // A comparison with nothing to compare passes silently and proves nothing.
    throw new Error('kits.yaml: "compare" is empty — the check would assert nothing.');
  }

  const selectorSource = isRecord(raw.selectors) ? raw.selectors : {};
  const selectors: Record<string, string> = {};
  for (const name of SELECTOR_NAMES) {
    selectors[name] = requireString(selectorSource[name], `selectors.${name}`);
  }

  return {
    reference: parseKit(raw.reference, 'reference'),
    candidates: raw.candidates.map((entry, index) => parseKit(entry, `candidates[${String(index)}]`)),
    compare,
    selectors: selectors as Record<SelectorName, string>,
    freePricePattern: new RegExp(requireString(raw.free_price_pattern, 'free_price_pattern'), 'u'),
  };
};
