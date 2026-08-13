import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

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
 */

export type KitDimension =
  | 'free_item_count'
  | 'free_item_price_label'
  | 'free_item_badge'
  | 'auto_added_to_cart'
  | 'counted_in_subtotal'
  | 'independently_removable'
  | 'removed_with_qualifying_product'
  | 'free_at_checkout'
  | 'free_gift_option_count'
  | 'free_gift_single_select';

export const ALL_DIMENSIONS: readonly KitDimension[] = [
  'free_item_count',
  'free_item_price_label',
  'free_item_badge',
  'auto_added_to_cart',
  'counted_in_subtotal',
  'independently_removable',
  'removed_with_qualifying_product',
  'free_at_checkout',
  'free_gift_option_count',
  'free_gift_single_select',
];

/** How one kit treats its free items, as a customer would experience it. */
export type KitProfile = {
  readonly free_item_count: number;
  /** Normalised, sorted — "Free", "FREE" and " free " are the same promise. */
  readonly free_item_price_label: readonly string[];
  readonly free_item_badge: readonly string[];
  readonly auto_added_to_cart: boolean;
  readonly counted_in_subtotal: boolean;
  readonly independently_removable: boolean;
  readonly removed_with_qualifying_product: boolean;
  readonly free_at_checkout: boolean;
  readonly free_gift_option_count: number;
  readonly free_gift_single_select: boolean;
};

export type KitSpec = { readonly name: string; readonly handle: string };

export type KitConfig = {
  readonly reference: KitSpec;
  readonly candidates: readonly KitSpec[];
  readonly compare: readonly KitDimension[];
};

export type KitDifference = {
  readonly dimension: KitDimension;
  readonly reference: string;
  readonly candidate: string;
  readonly explanation: string;
};

/** Why each dimension matters, quoted straight into the finding. */
const WHY: Readonly<Record<KitDimension, string>> = {
  free_item_count: 'The kits include a different number of free items.',
  free_item_price_label:
    'The free item is priced differently to the customer — "Free", "$0.00" and a struck-through price are three different promises.',
  free_item_badge: 'The free item carries a different badge, so it reads as a different kind of offer.',
  auto_added_to_cart:
    'One kit puts the free item in the cart automatically and the other does not, so the gift is only received if the customer notices it.',
  counted_in_subtotal:
    'The free item contributes to the subtotal in one kit and not the other, so the same promise produces different order values.',
  independently_removable:
    'The free item can be removed on its own in one kit but not the other — that is a different product, not a different price. Test plan §7: the free gift cannot be removed or charged separately.',
  removed_with_qualifying_product:
    'Removing the qualifying product takes the free kit with it in one and leaves it behind in the other. A free kit stranded in the cart is either given away unearned or charged for. Test plan §8, negative cases.',
  free_at_checkout:
    'The free item is $0 in one kit and not the other by the time the customer reaches the order summary — the last place anyone looks and the only one that takes money. Test plan §10.',
  free_gift_option_count:
    'The free-gift selector offers a different number of options, so the same promise buys a different choice. Test plan §7.',
  free_gift_single_select:
    'One kit allows several free gifts to be selected at once and the other does not. Test plan §7: only one free gift can be selected at a time.',
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
  };
};

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

  return {
    reference: parseKit(raw.reference, 'reference'),
    candidates: raw.candidates.map((entry, index) => parseKit(entry, `candidates[${String(index)}]`)),
    compare,
  };
};
