import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { toCents } from './compare-at.js';

/**
 * Daily top-10 product check — configuration and judging.
 *
 * The browser work lives in tools/top-products-audit.ts. Everything here is
 * pure: it takes what a page was observed to contain and decides what is
 * wrong with it, so each rule can be unit-tested against known-bad input
 * without a storefront.
 *
 * The governing idea is that "not observed" and "observed to be fine" must
 * never collapse into the same result. Every field on Observation is
 * deliberately optional, and an absent one produces a `harness` finding
 * naming the selector rather than a silent pass. A daily check that goes
 * green because it stopped looking is worse than one that fails.
 */

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type CheckName =
  | 'availability'
  | 'add_to_cart'
  | 'title'
  | 'description'
  | 'images'
  | 'videos'
  | 'pricing'
  | 'specifications'
  | 'variations'
  | 'discount_stacking';

export const ALL_CHECKS: readonly CheckName[] = [
  'availability',
  'add_to_cart',
  'title',
  'description',
  'images',
  'videos',
  'pricing',
  'specifications',
  'variations',
  'discount_stacking',
];

export type FindingKind =
  /** The list names a product we have no URL for, so it was not checked. */
  | 'handle_unresolved'
  /** The page at this handle is a different product than the list names. */
  | 'title_mismatch'
  /** No canonical title recorded, so product identity could not be confirmed. */
  | 'canonical_title_unrecorded'
  /** Page did not load. */
  | 'page_unreachable'
  | 'sold_out'
  | 'add_to_cart_failed'
  | 'description_missing'
  | 'images_missing'
  | 'image_broken'
  | 'video_missing'
  | 'price_missing'
  | 'price_zero'
  | 'specifications_missing'
  | 'variant_broken'
  | 'cart_math_wrong'
  | 'discount_not_applied'
  | 'discount_stacking_wrong'
  /** No stacking rules were supplied, so stacking was not verified. */
  | 'discount_rules_absent'
  | 'slow_page'
  /** Our own failure: a selector matched nothing, so nothing was verified. */
  | 'not_observed';

export const SEVERITY_OF: Readonly<Record<FindingKind, Severity>> = {
  // Cannot be bought — for a top-10 seller this is revenue stopping now.
  sold_out: 'critical',
  add_to_cart_failed: 'critical',
  price_missing: 'critical',
  price_zero: 'critical',
  cart_math_wrong: 'critical',
  discount_stacking_wrong: 'critical',
  // Wrong product entirely, or the page is gone.
  title_mismatch: 'critical',
  page_unreachable: 'critical',
  variant_broken: 'major',
  images_missing: 'major',
  image_broken: 'major',
  discount_not_applied: 'major',
  description_missing: 'major',
  // A gap in our own list, actionable by us, not a store defect.
  handle_unresolved: 'major',
  canonical_title_unrecorded: 'minor',
  specifications_missing: 'minor',
  video_missing: 'minor',
  slow_page: 'minor',
  discount_rules_absent: 'minor',
  not_observed: 'harness',
};

export type Finding = {
  readonly severity: Severity;
  readonly kind: FindingKind;
  readonly check: CheckName | 'config';
  readonly product: string;
  readonly detail: string;
};

export type ProductSpec = {
  /** The merchandising list's wording. Used to find the product and by humans. */
  readonly title: string;
  /** Undefined means unresolved: the audit refuses to guess. */
  readonly handle: string | undefined;
  /**
   * The title the storefront actually has for this handle, recorded when the
   * handle was resolved and confirmed. When present it is compared exactly,
   * which is the only reliable identity check — see judgeProduct.
   */
  readonly canonicalTitle: string | undefined;
  readonly expectVideo: boolean;
};

export type DiscountCode = { readonly code: string; readonly kind: string; readonly value: number };
export type StackingRule = {
  readonly codes: readonly string[];
  readonly applies: 'both' | 'first_only' | 'neither';
  readonly note: string;
};

export type Thresholds = {
  readonly minDescriptionChars: number;
  readonly minSpecificationChars: number;
  readonly minImages: number;
  readonly maxLoadMs: number;
};

export type TopProductsConfig = {
  readonly products: readonly ProductSpec[];
  readonly checks: readonly CheckName[];
  readonly thresholds: Thresholds;
  readonly codes: readonly DiscountCode[];
  readonly expectedStacking: readonly StackingRule[];
  readonly selectors: Readonly<Record<string, string>>;
};

/** One selectable variant, as observed after selecting it. */
export type VariantObservation = {
  readonly label: string;
  readonly selectable: boolean;
  /** Undefined when no price could be read after selecting. */
  readonly priceText: string | undefined;
  readonly soldOut: boolean;
};

/**
 * What a browser saw. Every field is optional on purpose: undefined means "not
 * observed", which is a harness finding, and is never treated as a pass.
 */
export type Observation = {
  readonly product: string;
  readonly handle: string;
  readonly status: number;
  readonly loadMs: number;
  readonly titleText: string | undefined;
  readonly priceText: string | undefined;
  readonly descriptionText: string | undefined;
  readonly specificationsText: string | undefined;
  /** Undefined means the image selector matched nothing. */
  readonly imageCount: number | undefined;
  readonly brokenImageCount: number | undefined;
  readonly videoCount: number | undefined;
  readonly soldOut: boolean | undefined;
  readonly addToCartWorked: boolean | undefined;
  readonly variants: readonly VariantObservation[] | undefined;
};

/** Cart totals in cents, after any codes were applied. */
export type CartObservation = {
  readonly subtotalCents: number | undefined;
  readonly discountCents: number | undefined;
  readonly totalCents: number | undefined;
  /** Codes the cart reported as accepted. */
  readonly appliedCodes: readonly string[];
};

// ── config ───────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`top-products.yaml: ${path} must be a non-empty string`);
  }
  return value.trim();
};

const requireNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`top-products.yaml: ${path} must be a number`);
  }
  return value;
};

export const loadTopProductsConfig = (path = 'config/top-products.yaml'): TopProductsConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.products) || !Array.isArray(raw.checks)) {
    throw new Error(`${path}: expected "products" and "checks"`);
  }
  if (raw.products.length === 0) {
    // An empty list would pass every check below having examined nothing.
    throw new Error(`${path}: "products" is empty — the check would assert nothing.`);
  }
  if (raw.checks.length === 0) {
    throw new Error(`${path}: "checks" is empty — every product would trivially pass.`);
  }

  const checks = raw.checks.map((entry, index) => {
    const name = requireString(entry, `checks[${String(index)}]`);
    if (!ALL_CHECKS.includes(name as CheckName)) {
      throw new Error(`${path}: "${name}" is not a known check. Known: ${ALL_CHECKS.join(', ')}`);
    }
    return name as CheckName;
  });

  const products = raw.products.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}: products[${String(index)}] must be a mapping`);
    const handle = entry.handle;
    return {
      title: requireString(entry.title, `products[${String(index)}].title`),
      // null is what YAML gives for a key with no value — the unresolved case.
      handle:
        typeof handle === 'string' && handle.trim() !== '' ? handle.trim() : undefined,
      canonicalTitle:
        typeof entry.canonical_title === 'string' && entry.canonical_title.trim() !== ''
          ? entry.canonical_title.trim()
          : undefined,
      expectVideo: entry.expect_video === true,
    };
  });

  const thresholdSource = isRecord(raw.thresholds) ? raw.thresholds : {};
  const discountSource = isRecord(raw.discounts) ? raw.discounts : {};
  const codesRaw = Array.isArray(discountSource.codes) ? discountSource.codes : [];
  const stackingRaw = Array.isArray(discountSource.expected_stacking)
    ? discountSource.expected_stacking
    : [];

  const selectorSource = isRecord(raw.selectors) ? raw.selectors : {};
  const selectors: Record<string, string> = {};
  for (const [name, value] of Object.entries(selectorSource)) {
    selectors[name] = requireString(value, `selectors.${name}`);
  }

  return {
    products,
    checks,
    thresholds: {
      minDescriptionChars: requireNumber(
        thresholdSource.min_description_chars ?? 80,
        'thresholds.min_description_chars',
      ),
      minSpecificationChars: requireNumber(
        thresholdSource.min_specification_chars ?? 40,
        'thresholds.min_specification_chars',
      ),
      minImages: requireNumber(thresholdSource.min_images ?? 1, 'thresholds.min_images'),
      maxLoadMs: requireNumber(thresholdSource.max_load_ms ?? 15_000, 'thresholds.max_load_ms'),
    },
    codes: codesRaw.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${path}: discounts.codes[${String(index)}]`);
      return {
        code: requireString(entry.code, `discounts.codes[${String(index)}].code`),
        kind: requireString(entry.kind, `discounts.codes[${String(index)}].kind`),
        value: typeof entry.value === 'number' ? entry.value : 0,
      };
    }),
    expectedStacking: stackingRaw.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${path}: discounts.expected_stacking[${String(index)}]`);
      const applies = requireString(entry.applies, `expected_stacking[${String(index)}].applies`);
      if (applies !== 'both' && applies !== 'first_only' && applies !== 'neither') {
        throw new Error(
          `${path}: expected_stacking[${String(index)}].applies must be ` +
            'both, first_only or neither',
        );
      }
      return {
        codes: (Array.isArray(entry.codes) ? entry.codes : []).map((code, i) =>
          requireString(code, `expected_stacking[${String(index)}].codes[${String(i)}]`),
        ),
        applies,
        note: typeof entry.note === 'string' ? entry.note : '',
      };
    }),
    selectors,
  };
};

// ── title comparison ─────────────────────────────────────────────────────

/**
 * Titles are compared loosely on purpose. A storefront prints "&" as "&amp;",
 * varies dash characters, and appends things like " | Kitsch". Demanding an
 * exact string would fail every product every morning, which trains people to
 * ignore the report — the failure mode that makes a daily check worthless.
 *
 * Loose does not mean weak: it still catches a different product, which is the
 * defect this guard exists for.
 */
export const normalizeTitle = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&amp;/gu, '&')
    .replace(/&/gu, ' and ')
    .replace(/[‐-―]/gu, '-')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();

const words = (value: string): readonly string[] =>
  normalizeTitle(value)
    .split(' ')
    .filter((word) => word.length > 2 && word !== 'and' && word !== 'the' && word !== 'for');

/**
 * Share of the expected title's distinctive words present in the observed one.
 *
 * Used to RANK CANDIDATES in the handle resolver, where a human confirms the
 * result. It is deliberately not the identity check, because it cannot be one.
 * Measured against this catalogue:
 *
 *   0.667  "Rice Water Shampoo Bar for Hair Growth" vs "Rice Water Shampoo Bar"
 *          — the same product, with the suffix dropped
 *   0.833  "Rice Water Shampoo Bar for Hair Growth" vs "Rice Water Conditioner
 *          Bar for Hair Growth" — a different product
 *
 * The wrong product scores higher than the right one, because these titles
 * share their boilerplate and differ by the one word that matters. No threshold
 * over this metric separates them, so identity is decided by an exact
 * comparison against `canonicalTitle` instead.
 */
export const titleOverlap = (expected: string, observed: string): number => {
  const wanted = words(expected);
  if (wanted.length === 0) return 0;
  const seen = new Set(words(observed));
  return wanted.filter((word) => seen.has(word)).length / wanted.length;
};

/**
 * Bar for the loose fallback below, used only where no canonical title has been
 * recorded yet. It is a weak check by nature: measured against this catalogue,
 * the wrong product outscores the right one, so it can only catch a wildly
 * unrelated page.
 */
export const TITLE_MATCH_FLOOR = 0.6;

// ── judging ──────────────────────────────────────────────────────────────

const finding = (
  kind: FindingKind,
  check: CheckName | 'config',
  product: string,
  detail: string,
): Finding => ({ severity: SEVERITY_OF[kind], kind, check, product, detail });

/** Products the list names but gives no URL for. Reported once, before any browsing. */
export const auditConfig = (config: TopProductsConfig): readonly Finding[] =>
  config.products
    .filter((product) => product.handle === undefined)
    .map((product) =>
      finding(
        'handle_unresolved',
        'config',
        product.title,
        'no handle in config/top-products.yaml, so this product was not checked at all. ' +
          'Resolve it with `npm run resolve:handles` — guessing one would test a ' +
          'different product and report it green.',
      ),
    );

/**
 * One branch per requirement in the daily brief, deliberately kept together:
 * splitting it would scatter the checks away from the list they implement.
 */
export const judgeProduct = (
  spec: ProductSpec,
  config: TopProductsConfig,
  observation: Observation,
): readonly Finding[] => {
  const out: Finding[] = [];
  const add = (kind: FindingKind, check: CheckName | 'config', detail: string): void => {
    out.push(finding(kind, check, spec.title, detail));
  };
  const enabled = (check: CheckName): boolean => config.checks.includes(check);
  const { thresholds } = config;

  if (observation.status !== 200) {
    add(
      'page_unreachable',
      'title',
      `HTTP ${String(observation.status)} at /products/${observation.handle}. ` +
        'A top-10 seller that does not load is losing sales now.',
    );
    return out;
  }

  // ── title, and the wrong-handle guard ──
  if (enabled('title')) {
    if (observation.titleText === undefined) {
      add('not_observed', 'title', 'no title element matched; the page was not verified');
      // Without a title we cannot confirm this is even the right product, so
      // nothing below would mean anything.
      return out;
    }
    const seen = observation.titleText.trim();
    if (spec.canonicalTitle !== undefined) {
      // Exact, normalized. This is the identity check: it catches a rename, a
      // replaced product, or a handle pointing somewhere else. Overlap cannot
      // do this job — see titleOverlap.
      if (normalizeTitle(seen) !== normalizeTitle(spec.canonicalTitle)) {
        add(
          'title_mismatch',
          'title',
          `page at /products/${observation.handle} is titled "${seen}" but was ` +
            `recorded as "${spec.canonicalTitle}". Either the product was renamed ` +
            '(update canonical_title) or the handle now points at a different ' +
            'product. Every other result for this row would describe that other ' +
            'product, so they are not reported.',
        );
        return out;
      }
    } else {
      // No canonical title recorded yet, so identity cannot be confirmed. Say
      // so rather than implying this row was verified, and apply only the weak
      // check, which catches a wildly unrelated page and little else.
      add(
        'canonical_title_unrecorded',
        'title',
        `no canonical_title recorded, so it cannot be confirmed that ` +
          `/products/${observation.handle} is still this product. Run ` +
          '`npm run resolve:handles -- --write` to record what the storefront ' +
          'currently calls it.',
      );
      if (titleOverlap(spec.title, seen) < TITLE_MATCH_FLOOR) {
        add(
          'title_mismatch',
          'title',
          `page at /products/${observation.handle} is titled "${seen}", which does ` +
            `not resemble "${spec.title}" at all.`,
        );
        return out;
      }
    }
  }

  if (enabled('availability')) {
    if (observation.soldOut === undefined) {
      add('not_observed', 'availability', 'could not tell whether this product is purchasable');
    } else if (observation.soldOut) {
      add(
        'sold_out',
        'availability',
        'shown as sold out / unavailable to buy' +
          (enabled('add_to_cart')
            ? '. Add-to-cart was not exercised, because a sold-out product has no buy button to press'
            : ''),
      );
    }
  }

  // Skipped when the product is sold out, and only then.
  //
  // Both checks fired on a sold-out product and it read as two separate
  // criticals: "sold out" and "clicking add-to-cart did not put a line in the
  // cart". The second is a true sentence about a false problem — it describes
  // a broken button, and sends somebody to debug one, when the shelf is simply
  // empty. One condition, one finding, and the sold_out detail above now says
  // what was and was not exercised.
  //
  // Narrow on purpose: `soldOut === false` still runs the check, and
  // `undefined` — meaning we could not tell — still reports `not_observed`
  // rather than assuming either way.
  if (enabled('add_to_cart') && observation.soldOut !== true) {
    if (observation.addToCartWorked === undefined) {
      add('not_observed', 'add_to_cart', 'add-to-cart was not exercised');
    } else if (!observation.addToCartWorked) {
      add(
        'add_to_cart_failed',
        'add_to_cart',
        'clicking add-to-cart did not put a line in the cart',
      );
    }
  }

  if (enabled('pricing')) {
    const cents = toCents(observation.priceText ?? '');
    if (observation.priceText === undefined) {
      add('not_observed', 'pricing', 'no price element matched');
    } else if (cents === undefined) {
      add(
        'price_missing',
        'pricing',
        `price element read "${observation.priceText.trim()}", which is not a price`,
      );
    } else if (cents === 0) {
      add('price_zero', 'pricing', 'price is $0.00');
    }
  }

  if (enabled('description')) {
    const text = (observation.descriptionText ?? '').trim();
    if (observation.descriptionText === undefined) {
      add('not_observed', 'description', 'no description element matched');
    } else if (text.length < thresholds.minDescriptionChars) {
      add(
        'description_missing',
        'description',
        `description is ${String(text.length)} characters, under the ` +
          `${String(thresholds.minDescriptionChars)} minimum — a placeholder, not copy`,
      );
    }
  }

  if (enabled('specifications')) {
    const text = (observation.specificationsText ?? '').trim();
    if (observation.specificationsText === undefined) {
      add('not_observed', 'specifications', 'no specifications element matched');
    } else if (text.length < thresholds.minSpecificationChars) {
      add(
        'specifications_missing',
        'specifications',
        `specifications block holds ${String(text.length)} characters — ` +
          'a heading with nothing under it',
      );
    }
  }

  if (enabled('images')) {
    if (observation.imageCount === undefined) {
      add('not_observed', 'images', 'no image element matched');
    } else {
      if (observation.imageCount < thresholds.minImages) {
        add(
          'images_missing',
          'images',
          `${String(observation.imageCount)} image(s), expected at least ` +
            String(thresholds.minImages),
        );
      }
      if ((observation.brokenImageCount ?? 0) > 0) {
        add(
          'image_broken',
          'images',
          `${String(observation.brokenImageCount ?? 0)} image(s) are in the markup but ` +
            'did not load — the customer sees a gap',
        );
      }
    }
  }

  // Only required where the config says to expect one. Most of these products
  // have no video, and a blanket requirement would report false failures daily.
  if (enabled('videos') && spec.expectVideo) {
    if (observation.videoCount === undefined) {
      add('not_observed', 'videos', 'video presence was not observed');
    } else if (observation.videoCount === 0) {
      add('video_missing', 'videos', 'a video is expected on this product and none is present');
    }
  }

  if (enabled('variations')) {
    if (observation.variants === undefined) {
      add('not_observed', 'variations', 'variant options were not observed');
    } else {
      for (const variant of observation.variants) {
        if (!variant.selectable) {
          add(
            'variant_broken',
            'variations',
            `variant "${variant.label}" could not be selected`,
          );
          continue;
        }
        // A usable price, not merely a present element. Clearing a price leaves
        // the element in place with empty text, so `textContent` returns "" —
        // defined, and therefore indistinguishable from healthy if the test is
        // only for undefined. That is exactly how the broken picker in the
        // fixture went undetected until the control caught it.
        if (toCents(variant.priceText ?? '') === undefined) {
          add(
            'variant_broken',
            'variations',
            `selecting variant "${variant.label}" left no readable price ` +
              `(price element read ${JSON.stringify(variant.priceText ?? '')}). ` +
              'The option looks selectable and cannot be priced, so it cannot be bought.',
          );
        }
      }
    }
  }
  return out;
};

// ── cart and discounts ───────────────────────────────────────────────────

/**
 * Cart arithmetic, which needs no business rules: whatever discount the cart
 * displays must actually come off the total. A cart that shows a discount and
 * charges full price is the common failure, and this catches it alone.
 */
export const judgeCart = (
  config: TopProductsConfig,
  cart: CartObservation,
): readonly Finding[] => {
  const out: Finding[] = [];
  const add = (kind: FindingKind, detail: string): void => {
    out.push(finding(kind, 'discount_stacking', '(cart)', detail));
  };

  if (cart.subtotalCents === undefined || cart.totalCents === undefined) {
    add('not_observed', 'cart subtotal or total could not be read; cart maths not verified');
    return out;
  }

  const discount = cart.discountCents ?? 0;
  const expected = cart.subtotalCents - discount;
  if (expected !== cart.totalCents) {
    add(
      'cart_math_wrong',
      `subtotal ${String(cart.subtotalCents)}c minus discounts ${String(discount)}c ` +
        `is ${String(expected)}c, but the cart total is ${String(cart.totalCents)}c. ` +
        'The cart is not charging what it displays.',
    );
  }

  for (const code of config.codes) {
    if (!cart.appliedCodes.includes(code.code)) {
      add('discount_not_applied', `code ${code.code} was submitted but the cart did not apply it`);
    }
  }

  // Stacking rules are a business decision. Without them this check has
  // verified arithmetic and nothing about stacking, and says so.
  if (config.expectedStacking.length === 0 && config.codes.length > 0) {
    add(
      'discount_rules_absent',
      'codes are configured but no expected_stacking rules are, so which ' +
        'combinations should apply was not verified. Add them to ' +
        'config/top-products.yaml once merchandising confirms the rules.',
    );
  }

  for (const rule of config.expectedStacking) {
    const applied = rule.codes.filter((code) => cart.appliedCodes.includes(code));
    const label = rule.codes.join(' + ');
    if (rule.applies === 'both' && applied.length !== rule.codes.length) {
      add(
        'discount_stacking_wrong',
        `${label} should stack, but only ${String(applied.length)} of ` +
          `${String(rule.codes.length)} applied. ${rule.note}`,
      );
    }
    if (rule.applies === 'first_only' && applied.length > 1) {
      add(
        'discount_stacking_wrong',
        `${label} should not stack — ${String(applied.length)} applied together. ${rule.note}`,
      );
    }
    if (rule.applies === 'neither' && applied.length > 0) {
      add(
        'discount_stacking_wrong',
        `${label} should not apply at all, but ${applied.join(', ')} did. ${rule.note}`,
      );
    }
  }
  return out;
};

export type Tally = Readonly<Record<Severity, number>>;

export const tally = (findings: readonly Finding[]): Tally => {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, harness: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return counts;
};

export const clientFindings = (findings: readonly Finding[]): readonly Finding[] =>
  findings.filter((item) => item.severity !== 'harness');
