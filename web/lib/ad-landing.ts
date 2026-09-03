import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { toCents } from './compare-at.js';

/**
 * Daily QA for ad-traffic landing pages — configuration and judging.
 *
 * These pages are where paid traffic lands, so a broken one spends money to
 * show a customer something wrong. Six things are checked, from the daily
 * brief: discount non-stacking, auto-ship pricing, discount redirect flows,
 * BYOB builder flows, out-of-stock redirect behaviour, and compare-at accuracy.
 *
 * Everything here is pure. The browser work is in tools/ad-landing-audit.ts.
 *
 * Two principles carried from the other suites, because both were paid for by
 * a real false green:
 *
 *   1. "Not observed" is never "fine". Every observed field is optional, and an
 *      absent one becomes a `harness` finding naming what was not seen.
 *   2. A check with nothing to check says so. A non-stacking check with no
 *      site-wide code to attempt, or an auto-ship check with no expected rate,
 *      reports that it could not verify rather than passing.
 */

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type FindingKind =
  /** A fixed-discount code stacked with a site-wide one. Money out the door. */
  | 'discount_stacked'
  /** The code the page depends on was rejected. */
  | 'fixed_code_rejected'
  /** Cart shows a discount it does not deduct. */
  | 'cart_math_wrong'
  /** /discount/CODE did not land anywhere useful. */
  | 'redirect_broken'
  /** /discount/CODE landed somewhere other than the configured page. */
  | 'redirect_wrong_target'
  /** The builder rendered but offers nothing to build with. */
  | 'byob_no_options'
  /** Choosing items did not move the bundle price. */
  | 'byob_price_static'
  /** Sold out, and no redirect happened. */
  | 'oos_no_redirect'
  /** Sold out, redirected, but not to the configured product. */
  | 'oos_wrong_target'
  /** Auto-ship priced at or above the one-time price. */
  | 'autoship_not_cheaper'
  /** Auto-ship discount is not the advertised percentage. */
  | 'autoship_rate_wrong'
  /** Auto-ship expected on this product and not offered. */
  | 'autoship_missing'
  /** A struck-through price that is not a real reduction. */
  | 'compare_at_invalid'
  | 'page_unreachable'
  | 'sold_out'
  /** Named in the brief with no handle. Not checked. */
  | 'handle_unresolved'
  /** No site-wide code configured, so non-stacking was not verified. */
  | 'non_stacking_unverifiable'
  /** No expected rate configured, so the auto-ship rate was not verified. */
  | 'autoship_rate_unverified'
  /** Our own failure: a selector matched nothing. */
  | 'not_observed';

export const SEVERITY_OF: Readonly<Record<FindingKind, Severity>> = {
  // Two codes where one was intended is revenue leaving on every order.
  discount_stacked: 'critical',
  cart_math_wrong: 'critical',
  // An ad landing page that cannot be bought from, or whose offer is refused.
  fixed_code_rejected: 'critical',
  redirect_broken: 'critical',
  byob_no_options: 'critical',
  page_unreachable: 'critical',
  sold_out: 'critical',
  // Sends a customer somewhere they cannot buy the thing the ad promised.
  oos_no_redirect: 'major',
  oos_wrong_target: 'major',
  redirect_wrong_target: 'major',
  byob_price_static: 'major',
  autoship_not_cheaper: 'major',
  autoship_rate_wrong: 'major',
  compare_at_invalid: 'major',
  autoship_missing: 'minor',
  handle_unresolved: 'major',
  non_stacking_unverifiable: 'minor',
  autoship_rate_unverified: 'minor',
  not_observed: 'harness',
};

export type CheckName =
  | 'discount_non_stacking'
  | 'autoship_pricing'
  | 'discount_redirect'
  | 'byob_flow'
  | 'oos_redirect'
  | 'compare_at';

export type Finding = {
  readonly severity: Severity;
  readonly kind: FindingKind;
  readonly check: CheckName | 'config';
  readonly target: string;
  readonly detail: string;
};

// ── config ───────────────────────────────────────────────────────────────

export type PageSpec = {
  readonly handle: string;
  readonly group: string;
  readonly fixedDiscountCode: string | undefined;
};

/** Named in the brief but with no handle to check. */
export type UnresolvedSpec = { readonly title: string; readonly note: string };

export type RedirectSpec = { readonly code: string; readonly expectHandle: string };
export type OosSpec = { readonly handle: string; readonly expectHandle: string };

export type AdLandingConfig = {
  readonly pages: readonly PageSpec[];
  readonly byob: readonly PageSpec[];
  readonly unresolved: readonly UnresolvedSpec[];
  readonly discountRedirects: readonly RedirectSpec[];
  readonly oosRedirects: readonly OosSpec[];
  readonly fixedCodes: readonly string[];
  readonly siteWideCodes: readonly string[];
  readonly autoshipPercent: number | undefined;
  readonly autoshipRequiredOn: readonly string[];
  readonly maxLoadMs: number;
  readonly minByobOptions: number;
  readonly selectors: Readonly<Record<string, string>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const asStringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.flatMap((entry) => asString(entry) ?? []) : [];

export const loadAdLandingConfig = (path = 'config/ad-landing.yaml'): AdLandingConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw)) throw new Error(`${path}: not a mapping`);

  const pages: PageSpec[] = [];
  const kits = isRecord(raw.welcome_kits) ? raw.welcome_kits : {};
  for (const [group, value] of Object.entries(kits)) {
    for (const handle of asStringList(value)) {
      pages.push({ handle, group: `welcome_kit:${group}`, fixedDiscountCode: undefined });
    }
  }

  const parseEntries = (value: unknown, group: string): readonly PageSpec[] =>
    (Array.isArray(value) ? value : []).flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const handle = asString(entry.handle);
      if (handle === undefined) return [];
      return [
        { handle, group, fixedDiscountCode: asString(entry.fixed_discount_code) },
      ];
    });

  const byob = parseEntries(raw.byob, 'byob');
  const traffic = parseEntries(raw.traffic, 'traffic');

  // Entries with a title and no handle are the brief's items we cannot check.
  const unresolved = (Array.isArray(raw.traffic) ? raw.traffic : []).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const title = asString(entry.title);
    if (title === undefined || asString(entry.handle) !== undefined) return [];
    return [{ title, note: asString(entry.note) ?? '' }];
  });

  const nonStacking = isRecord(raw.non_stacking) ? raw.non_stacking : {};
  const autoship = isRecord(raw.autoship) ? raw.autoship : {};
  const thresholds = isRecord(raw.thresholds) ? raw.thresholds : {};
  const selectorSource = isRecord(raw.selectors) ? raw.selectors : {};
  const selectors: Record<string, string> = {};
  for (const [name, value] of Object.entries(selectorSource)) {
    const css = asString(value);
    if (css !== undefined) selectors[name] = css;
  }

  const all = [...pages, ...byob, ...traffic];
  if (all.length === 0) {
    // An empty scope would sail through every check having examined nothing.
    throw new Error(`${path}: no pages configured — the daily check would assert nothing.`);
  }

  return {
    pages: all,
    byob,
    unresolved,
    discountRedirects: (Array.isArray(raw.discount_redirects) ? raw.discount_redirects : []).flatMap(
      (entry) => {
        if (!isRecord(entry)) return [];
        const code = asString(entry.code);
        const expectHandle = asString(entry.expect_handle);
        if (code === undefined || expectHandle === undefined) return [];
        return [{ code, expectHandle }];
      },
    ),
    oosRedirects: (Array.isArray(raw.oos_redirects) ? raw.oos_redirects : []).flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const handle = asString(entry.handle);
      const expectHandle = asString(entry.expect_handle);
      if (handle === undefined || expectHandle === undefined) return [];
      return [{ handle, expectHandle }];
    }),
    fixedCodes: asStringList(nonStacking.fixed_codes),
    siteWideCodes: asStringList(nonStacking.site_wide_codes),
    autoshipPercent:
      typeof autoship.expected_discount_percent === 'number'
        ? autoship.expected_discount_percent
        : undefined,
    autoshipRequiredOn: asStringList(autoship.required_on),
    maxLoadMs: typeof thresholds.max_load_ms === 'number' ? thresholds.max_load_ms : 15_000,
    minByobOptions:
      typeof thresholds.min_byob_options === 'number' ? thresholds.min_byob_options : 2,
    selectors,
  };
};

// ── observations ─────────────────────────────────────────────────────────

export type PageObservation = {
  readonly handle: string;
  readonly status: number;
  /** The handle actually landed on. Differs from `handle` when redirected. */
  readonly finalHandle: string | undefined;
  /**
   * Where the product's own URL redirected to, read WITHOUT following it.
   *
   * This has to be observed separately. Following the redirect and reading
   * stock from the destination tells you about the substitute, not about the
   * product that was out of stock — so a misrouted OOS product looked
   * identical to an in-stock one that redirected. Undefined means the URL
   * served its own page.
   */
  readonly redirectedTo: string | undefined;
  readonly soldOut: boolean | undefined;
  readonly priceText: string | undefined;
  readonly compareAtText: string | undefined;
  readonly autoshipOffered: boolean | undefined;
  readonly autoshipPriceText: string | undefined;
};

export type ByobObservation = {
  readonly handle: string;
  readonly status: number;
  readonly optionCount: number | undefined;
  /** Bundle price before and after choosing items. */
  readonly priceBeforeText: string | undefined;
  readonly priceAfterText: string | undefined;
  readonly selectedCount: number | undefined;
};

export type RedirectObservation = {
  readonly code: string;
  readonly status: number;
  readonly finalHandle: string | undefined;
  readonly finalPath: string | undefined;
};

export type StackObservation = {
  readonly fixedCode: string;
  readonly siteWideCode: string;
  readonly appliedCodes: readonly string[];
  readonly subtotalCents: number | undefined;
  readonly discountCents: number | undefined;
  readonly totalCents: number | undefined;
};

const finding = (
  kind: FindingKind,
  check: CheckName | 'config',
  target: string,
  detail: string,
): Finding => ({ severity: SEVERITY_OF[kind], kind, check, target, detail });

// ── config-level ─────────────────────────────────────────────────────────

export const auditConfig = (config: AdLandingConfig): readonly Finding[] => {
  const out: Finding[] = config.unresolved.map((entry) =>
    finding(
      'handle_unresolved',
      'config',
      entry.title,
      `named in the daily brief but no URL is known, so it is not checked. ${entry.note} ` +
        'Supply the URL — a guessed handle checks a different page and reports it healthy.',
    ),
  );

  if (config.fixedCodes.length > 0 && config.siteWideCodes.length === 0) {
    out.push(
      finding(
        'non_stacking_unverifiable',
        'discount_non_stacking',
        '(config)',
        'fixed codes are configured but no site-wide code is, so there was nothing to ' +
          'attempt stacking with and non-stacking was NOT verified. Add a currently-live ' +
          'site-wide code to non_stacking.site_wide_codes.',
      ),
    );
  }
  if (config.autoshipPercent === undefined) {
    out.push(
      finding(
        'autoship_rate_unverified',
        'autoship_pricing',
        '(config)',
        'no expected auto-ship discount percentage configured, so only "cheaper than ' +
          'one-time" was checked, not the advertised rate. Set ' +
          'autoship.expected_discount_percent.',
      ),
    );
  }
  return out;
};

// ── page: compare-at, availability, autoship ─────────────────────────────

export const judgePage = (
  spec: PageSpec,
  config: AdLandingConfig,
  observation: PageObservation,
): readonly Finding[] => {
  const out: Finding[] = [];
  const add = (kind: FindingKind, check: CheckName, detail: string): void => {
    out.push(finding(kind, check, spec.handle, detail));
  };

  if (observation.status !== 200) {
    add(
      'page_unreachable',
      'compare_at',
      `HTTP ${String(observation.status)} — an ad is sending paid traffic to this page.`,
    );
    return out;
  }

  if (observation.soldOut === true) {
    add('sold_out', 'compare_at', 'sold out while carrying ad traffic');
  }

  // ── compare-at accuracy ──
  const price = toCents(observation.priceText ?? '');
  const compareAt = toCents(observation.compareAtText ?? '');
  if (observation.priceText === undefined) {
    add('not_observed', 'compare_at', 'no price element matched; nothing about this page verified');
  } else if (compareAt !== undefined && price !== undefined && compareAt <= price) {
    // A strikethrough that is not a reduction is a false discount claim.
    add(
      'compare_at_invalid',
      'compare_at',
      `struck-through price ${observation.compareAtText?.trim() ?? ''} is not above the ` +
        `selling price ${observation.priceText.trim()}, so the page shows a saving that ` +
        'does not exist.',
    );
  }

  // ── auto-ship ──
  const wantsAutoship = config.autoshipRequiredOn.includes(spec.handle);
  if (observation.autoshipOffered === undefined) {
    if (wantsAutoship) {
      add('not_observed', 'autoship_pricing', 'auto-ship option was not observed');
    }
  } else if (!observation.autoshipOffered) {
    if (wantsAutoship) {
      add('autoship_missing', 'autoship_pricing', 'auto-ship is expected here and not offered');
    }
  } else {
    const autoship = toCents(observation.autoshipPriceText ?? '');
    if (autoship === undefined) {
      add(
        'not_observed',
        'autoship_pricing',
        'auto-ship is offered but its price could not be read',
      );
    } else if (price !== undefined) {
      if (autoship >= price) {
        add(
          'autoship_not_cheaper',
          'autoship_pricing',
          `auto-ship ${observation.autoshipPriceText?.trim() ?? ''} is not below the one-time ` +
            `price ${observation.priceText?.trim() ?? ''}, so subscribing saves nothing.`,
        );
      } else if (config.autoshipPercent !== undefined) {
        const expected = Math.round(price * (1 - config.autoshipPercent / 100));
        // One cent of tolerance: themes round the discounted price themselves.
        if (Math.abs(expected - autoship) > 1) {
          add(
            'autoship_rate_wrong',
            'autoship_pricing',
            `auto-ship is ${String(autoship)}c but ${String(config.autoshipPercent)}% off ` +
              `${String(price)}c is ${String(expected)}c.`,
          );
        }
      }
    }
  }
  return out;
};

// ── BYOB ─────────────────────────────────────────────────────────────────

export const judgeByob = (
  config: AdLandingConfig,
  observation: ByobObservation,
): readonly Finding[] => {
  const out: Finding[] = [];
  const add = (kind: FindingKind, detail: string): void => {
    out.push(finding(kind, 'byob_flow', observation.handle, detail));
  };

  if (observation.status !== 200) {
    add('page_unreachable', `HTTP ${String(observation.status)} on a BYOB carrying ad traffic`);
    return out;
  }
  if (observation.optionCount === undefined) {
    add('not_observed', 'no builder options matched; the flow was not exercised');
    return out;
  }
  if (observation.optionCount < config.minByobOptions) {
    add(
      'byob_no_options',
      `the builder offers ${String(observation.optionCount)} option(s), under the ` +
        `${String(config.minByobOptions)} minimum — the page renders but nothing can be ` +
        'built. Either the builder is genuinely empty, or byob_option in ' +
        'config/ad-landing.yaml does not match this theme; both block the daily QA ' +
        'and both need someone to look.',
    );
    return out;
  }

  // A price that does not move when items are chosen means the builder is not
  // wired up, which looks fine until the customer reaches checkout.
  const before = toCents(observation.priceBeforeText ?? '');
  const after = toCents(observation.priceAfterText ?? '');
  if (observation.priceAfterText === undefined) {
    add('not_observed', 'bundle price could not be read after selecting items');
  } else if (before !== undefined && after !== undefined && before === after) {
    if ((observation.selectedCount ?? 0) > 0) {
      add(
        'byob_price_static',
        `bundle price stayed at ${observation.priceAfterText.trim()} after selecting ` +
          `${String(observation.selectedCount ?? 0)} item(s) — the builder is not pricing.`,
      );
    }
  }
  return out;
};

// ── discount redirects ───────────────────────────────────────────────────

export const judgeRedirect = (
  spec: RedirectSpec,
  observation: RedirectObservation,
): readonly Finding[] => {
  const target = `/discount/${spec.code}`;
  if (observation.status !== 200) {
    return [
      finding(
        'redirect_broken',
        'discount_redirect',
        target,
        `HTTP ${String(observation.status)} — the ad's discount link is dead.`,
      ),
    ];
  }
  // Landing on the homepage means the code was set but the customer was not
  // taken to the offer, which reads as a working link and converts poorly.
  if (observation.finalHandle === undefined) {
    return [
      finding(
        'redirect_wrong_target',
        'discount_redirect',
        target,
        `landed on ${observation.finalPath ?? 'an unknown page'} rather than a product page. ` +
          `Expected /products/${spec.expectHandle}.`,
      ),
    ];
  }
  if (observation.finalHandle !== spec.expectHandle) {
    return [
      finding(
        'redirect_wrong_target',
        'discount_redirect',
        target,
        `landed on /products/${observation.finalHandle}, expected ` +
          `/products/${spec.expectHandle}.`,
      ),
    ];
  }
  return [];
};

// ── out-of-stock redirect ────────────────────────────────────────────────

/**
 * Conditional by nature. While the product is in stock there is nothing to
 * redirect, and asserting a redirect would fail every day it is available — so
 * the assertion is only made when the page reports itself sold out.
 */
export const judgeOosRedirect = (
  spec: OosSpec,
  observation: PageObservation,
): readonly Finding[] => {
  const out: Finding[] = [];
  const add = (kind: FindingKind, detail: string): void => {
    out.push(finding(kind, 'oos_redirect', spec.handle, detail));
  };

  // A redirect is judged on its destination alone. Whether the origin was
  // actually out of stock is not observable once the storefront redirects —
  // the page never renders, so there is no stock state to read. Asserting on
  // it would mean inventing the fact.
  if (observation.redirectedTo !== undefined) {
    if (observation.redirectedTo !== spec.expectHandle) {
      add(
        'oos_wrong_target',
        `redirects to /products/${observation.redirectedTo}, but ` +
          `/products/${spec.expectHandle} is configured as the substitute. Ad traffic ` +
          'is landing on the wrong product.',
      );
    }
    return out;
  }

  if (observation.status !== 200) {
    add('page_unreachable', `HTTP ${String(observation.status)}`);
    return out;
  }
  if (observation.soldOut === undefined) {
    add('not_observed', 'could not tell whether this product is in stock');
    return out;
  }
  if (observation.soldOut) {
    add(
      'oos_no_redirect',
      'sold out and still serving its own page. Ad traffic lands somewhere it cannot ' +
        `buy; it should redirect to /products/${spec.expectHandle}.`,
    );
  }
  return out;
};

// ── non-stacking ─────────────────────────────────────────────────────────

/**
 * The brief's standing rule: fixed-discount codes must not stack with
 * site-wide offers. Verified by applying the fixed code, then attempting a
 * site-wide one, and requiring that the second is refused.
 */
export const judgeStacking = (observation: StackObservation): readonly Finding[] => {
  const out: Finding[] = [];
  const target = `${observation.fixedCode} + ${observation.siteWideCode}`;
  const add = (kind: FindingKind, detail: string): void => {
    out.push(finding(kind, 'discount_non_stacking', target, detail));
  };

  const fixedApplied = observation.appliedCodes.includes(observation.fixedCode);
  const siteWideApplied = observation.appliedCodes.includes(observation.siteWideCode);

  if (!fixedApplied) {
    add(
      'fixed_code_rejected',
      `${observation.fixedCode} was refused by the cart. The offer the ad promises is ` +
        'not available, whatever happens to stacking.',
    );
    return out;
  }
  if (siteWideApplied) {
    add(
      'discount_stacked',
      `${observation.siteWideCode} applied on top of ${observation.fixedCode}. These are ` +
        'not meant to stack, so every order through this page is discounted twice.',
    );
  }

  if (observation.subtotalCents === undefined || observation.totalCents === undefined) {
    add('not_observed', 'cart subtotal or total could not be read; the maths was not checked');
    return out;
  }
  const expected = observation.subtotalCents - (observation.discountCents ?? 0);
  if (expected !== observation.totalCents) {
    add(
      'cart_math_wrong',
      `subtotal ${String(observation.subtotalCents)}c minus discount ` +
        `${String(observation.discountCents ?? 0)}c is ${String(expected)}c but the total ` +
        `is ${String(observation.totalCents)}c.`,
    );
  }
  return out;
};

// ── tally ────────────────────────────────────────────────────────────────

export type Tally = Readonly<Record<Severity, number>>;

export const tally = (findings: readonly Finding[]): Tally => {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, harness: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return counts;
};

export const clientFindings = (findings: readonly Finding[]): readonly Finding[] =>
  findings.filter((item) => item.severity !== 'harness');
