import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

/**
 * Accessibility across markets — configuration and judging.
 *
 * The browser work (running axe) lives in tools/a11y-audit.ts. Everything here
 * is pure, so every rule can be tested against known-bad input without a page.
 *
 * The design point worth knowing: axe is necessary and not sufficient. It
 * checks a page against WCAG and has no concept of which language the page is
 * supposed to be in, so two failure classes that only exist in a multi-market
 * store are invisible to it:
 *
 *   - a localized page still declaring lang="en", which makes a screen reader
 *     pronounce German or Japanese with English phonemes
 *   - alt text and aria-labels left in English on a localized page, which
 *     sighted users never notice and which is the only content a blind
 *     customer in that market receives
 *
 * Both are checked here explicitly. A generic scan that missed them would
 * report every market as accessible while two of them were not.
 */

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type FindingKind =
  /** An axe rule failed. The rule id travels in `rule`. */
  | 'wcag_violation'
  /** The page declares a different language than the locale it serves. */
  | 'html_lang_mismatch'
  /** Alt text is byte-identical to the English page's. */
  | 'untranslated_alt'
  | 'untranslated_aria_label'
  /** A rule that passes in other locales fails in this one. */
  | 'locale_only_violation'
  /** Our own gap: the scan did not run. */
  | 'not_scanned';

export type LocaleSpec = {
  readonly code: string;
  readonly lang: string;
  readonly market: string;
  readonly isSource: boolean;
};

export type RouteSpec = { readonly path: string; readonly name: string };

export type Exemption = {
  readonly rule: string;
  readonly route: string;
  readonly locales: readonly string[];
  readonly reason: string;
  readonly owner: string;
};

export type A11yConfig = {
  readonly locales: readonly LocaleSpec[];
  readonly routes: readonly RouteSpec[];
  readonly wcagTags: readonly string[];
  readonly severities: Readonly<Record<string, Severity>>;
  readonly maxCritical: number;
  readonly maxMajor: number;
  readonly maxMinor: number;
  readonly minAltCharsToCompare: number;
  readonly exemptions: readonly Exemption[];
};

/** One axe violation, reduced to what a report needs. */
export type AxeViolation = {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly helpUrl: string;
  readonly nodes: readonly { readonly target: readonly string[]; readonly html: string }[];
};

/** Image and control labelling, read from a page. */
export type LabelObservation = {
  readonly alts: readonly string[];
  readonly ariaLabels: readonly string[];
};

export type PageScan = {
  readonly locale: string;
  readonly market: string;
  readonly route: string;
  readonly routeName: string;
  readonly status: number;
  /** Undefined means axe did not run — never treated as "no violations". */
  readonly violations: readonly AxeViolation[] | undefined;
  /** The `lang` attribute the page actually declared. */
  readonly htmlLang: string | undefined;
  readonly labels: LabelObservation | undefined;
};

export type Finding = {
  readonly severity: Severity;
  readonly kind: FindingKind;
  readonly rule: string;
  readonly locale: string;
  readonly market: string;
  readonly route: string;
  readonly detail: string;
  /** A selector or sample, so a fix has somewhere to start. */
  readonly evidence: string;
};

// ── config ───────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`a11y.yaml: ${path} must be a non-empty string`);
  }
  return value.trim();
};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asSeverity = (value: unknown, path: string): Severity => {
  const name = asString(value, path);
  if (name !== 'critical' && name !== 'major' && name !== 'minor' && name !== 'harness') {
    throw new Error(`a11y.yaml: ${path} must be critical, major, minor or harness`);
  }
  return name;
};

export const loadA11yConfig = (path = 'config/a11y.yaml'): A11yConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.locales) || !Array.isArray(raw.routes)) {
    throw new Error(`${path}: expected "locales" and "routes"`);
  }
  if (raw.locales.length === 0 || raw.routes.length === 0) {
    // Either being empty would produce a clean run having scanned nothing.
    throw new Error(`${path}: locales and routes must both be non-empty`);
  }

  const locales = raw.locales.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}: locales[${String(index)}]`);
    return {
      code: asString(entry.code, `locales[${String(index)}].code`),
      lang: asString(entry.lang, `locales[${String(index)}].lang`),
      market: asString(entry.market, `locales[${String(index)}].market`),
      isSource: entry.source === true,
    };
  });
  if (!locales.some((locale) => locale.isSource)) {
    // Untranslated alt text is decided by comparison against the source
    // locale. With no source declared there is nothing to compare against and
    // that whole class of finding would silently never fire.
    throw new Error(`${path}: exactly one locale must be marked "source: true"`);
  }

  const severitySource = isRecord(raw.severities) ? raw.severities : {};
  const severities: Record<string, Severity> = {};
  for (const [name, value] of Object.entries(severitySource)) {
    severities[name] = asSeverity(value, `severities.${name}`);
  }

  const thresholds = isRecord(raw.thresholds) ? raw.thresholds : {};
  const wcag = isRecord(raw.wcag) ? raw.wcag : {};

  return {
    locales,
    routes: raw.routes.map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${path}: routes[${String(index)}]`);
      return {
        path: asString(entry.path, `routes[${String(index)}].path`),
        name: asString(entry.name, `routes[${String(index)}].name`),
      };
    }),
    wcagTags: Array.isArray(wcag.tags)
      ? wcag.tags.map((tag, index) => asString(tag, `wcag.tags[${String(index)}]`))
      : ['wcag2a', 'wcag2aa'],
    severities,
    maxCritical: asNumber(thresholds.max_critical, 0),
    maxMajor: asNumber(thresholds.max_major, 0),
    maxMinor: asNumber(thresholds.max_minor, 25),
    minAltCharsToCompare: asNumber(thresholds.min_alt_chars_to_compare, 12),
    exemptions: (Array.isArray(raw.exemptions) ? raw.exemptions : []).map((entry, index) => {
      if (!isRecord(entry)) throw new Error(`${path}: exemptions[${String(index)}]`);
      return {
        rule: asString(entry.rule, `exemptions[${String(index)}].rule`),
        route: typeof entry.route === 'string' ? entry.route : 'all',
        locales: Array.isArray(entry.locales)
          ? entry.locales.map((code, i) => asString(code, `exemptions[${String(index)}].locales[${String(i)}]`))
          : ['all'],
        // Required, not optional: an exemption with no reason is
        // indistinguishable from a rule someone switched off.
        reason: asString(entry.reason, `exemptions[${String(index)}].reason`),
        owner: asString(entry.owner, `exemptions[${String(index)}].owner`),
      };
    }),
  };
};

export const isExempt = (
  config: A11yConfig,
  rule: string,
  route: string,
  locale: string,
): boolean =>
  config.exemptions.some(
    (exemption) =>
      exemption.rule === rule &&
      (exemption.route === 'all' || exemption.route === route) &&
      (exemption.locales.includes('all') || exemption.locales.includes(locale)),
  );

// ── judging one page ─────────────────────────────────────────────────────

const severityOf = (config: A11yConfig, key: string, fallback: Severity): Severity =>
  config.severities[key] ?? fallback;

/**
 * Judges one scanned page: WCAG violations plus the two locale-specific rules
 * axe cannot express.
 */
export const judgePage = (config: A11yConfig, scan: PageScan, source?: PageScan): readonly Finding[] => {
  const out: Finding[] = [];
  const add = (
    kind: FindingKind,
    rule: string,
    severity: Severity,
    detail: string,
    evidence: string,
  ): void => {
    out.push({
      severity,
      kind,
      rule,
      locale: scan.locale,
      market: scan.market,
      route: scan.route,
      detail,
      evidence,
    });
  };

  if (scan.status !== 200) {
    add(
      'not_scanned',
      'page',
      'harness',
      `HTTP ${String(scan.status)} — the page was not scanned, so nothing about its ` +
        'accessibility is known',
      scan.route,
    );
    return out;
  }
  if (scan.violations === undefined) {
    // Never "no violations". A scan that did not run and a clean page look
    // identical in a count, and only one of them is good news.
    add('not_scanned', 'axe', 'harness', 'axe did not run on this page', scan.route);
    return out;
  }

  // ── WCAG ──
  for (const violation of scan.violations) {
    if (isExempt(config, violation.id, scan.route, scan.locale)) continue;
    const severity = severityOf(config, violation.impact ?? 'minor', 'minor');
    const node = violation.nodes[0];
    add(
      'wcag_violation',
      violation.id,
      severity,
      `${violation.help} (${String(violation.nodes.length)} element(s)) — ${violation.helpUrl}`,
      node?.target.join(' ') ?? '',
    );
  }

  // ── the page's declared language ──
  const expected = config.locales.find((locale) => locale.code === scan.locale)?.lang;
  if (expected !== undefined) {
    if (scan.htmlLang === undefined) {
      add(
        'html_lang_mismatch',
        'html-has-lang',
        severityOf(config, 'html_lang_mismatch', 'major'),
        'the page declares no language, so a screen reader guesses one',
        '<html>',
      );
    } else if (!scan.htmlLang.toLowerCase().startsWith(expected.toLowerCase())) {
      // Region subtags are fine — fr-CA still reads as French. A different
      // primary language is not.
      add(
        'html_lang_mismatch',
        'html-lang-valid',
        severityOf(config, 'html_lang_mismatch', 'major'),
        `the ${scan.market} page declares lang="${scan.htmlLang}" but serves ` +
          `${expected} content. A screen reader will pronounce it with the wrong ` +
          'phonemes, which makes the page unusable rather than merely awkward.',
        `<html lang="${scan.htmlLang}">`,
      );
    }
  }

  // ── labelling left in the source language ──
  if (source !== undefined && !scan.locale.startsWith(source.locale) && scan.labels !== undefined) {
    const sourceAlts = new Set(source.labels?.alts ?? []);
    const shared = scan.labels.alts.filter(
      (alt) => alt.trim().length >= config.minAltCharsToCompare && sourceAlts.has(alt),
    );
    if (shared.length > 0) {
      add(
        'untranslated_alt',
        'alt-translated',
        severityOf(config, 'untranslated_alt', 'major'),
        `${String(shared.length)} image description(s) are identical to the ` +
          `${source.locale} page. Sighted customers in ${scan.market} never see this; ` +
          'a blind one hears English.',
        shared[0] ?? '',
      );
    }

    const sourceLabels = new Set(source.labels?.ariaLabels ?? []);
    const sharedAria = scan.labels.ariaLabels.filter(
      (label) => label.trim().length >= config.minAltCharsToCompare && sourceLabels.has(label),
    );
    if (sharedAria.length > 0) {
      add(
        'untranslated_aria_label',
        'aria-label-translated',
        severityOf(config, 'untranslated_aria_label', 'minor'),
        `${String(sharedAria.length)} control label(s) are identical to the ` +
          `${source.locale} page, so assistive technology announces them in English`,
        sharedAria[0] ?? '',
      );
    }
  }
  return out;
};

// ── comparing across markets ─────────────────────────────────────────────

/**
 * A rule that fails in some locales and passes in others.
 *
 * This is the finding a per-page report cannot produce and the one most worth
 * having: a violation present everywhere is a theme defect, while the same
 * violation in only two markets was introduced by their localization, and the
 * two need different people to fix them.
 */
export const compareAcrossLocales = (
  config: A11yConfig,
  scans: readonly PageScan[],
): readonly Finding[] => {
  const out: Finding[] = [];
  const byRoute = new Map<string, PageScan[]>();
  for (const scan of scans) {
    const list = byRoute.get(scan.route) ?? [];
    list.push(scan);
    byRoute.set(scan.route, list);
  }

  for (const [route, group] of byRoute) {
    // Only pages that were actually scanned can take part; an unscanned locale
    // must not read as "this rule passes there".
    const scanned = group.filter((scan) => scan.violations !== undefined);
    if (scanned.length < 2) continue;

    const rules = new Set(scanned.flatMap((scan) => (scan.violations ?? []).map((v) => v.id)));
    for (const rule of rules) {
      if (isExempt(config, rule, route, 'all')) continue;
      const failing = scanned.filter((scan) =>
        (scan.violations ?? []).some((violation) => violation.id === rule),
      );
      if (failing.length === 0 || failing.length === scanned.length) continue;

      const markets = failing.map((scan) => `${scan.market} (${scan.locale})`);
      out.push({
        severity: severityOf(config, 'locale_only_violation', 'major'),
        kind: 'locale_only_violation',
        rule,
        locale: failing.map((scan) => scan.locale).join(','),
        market: markets.join(', '),
        route,
        detail:
          `"${rule}" fails in ${String(failing.length)} of ${String(scanned.length)} ` +
          `markets on ${route} — ${markets.join(', ')} — and passes in the rest. ` +
          'A defect in some markets and not others came from their localization, ' +
          'not from the theme, and is fixed by different people.',
        evidence: route,
      });
    }
  }
  return out;
};

// ── tally ────────────────────────────────────────────────────────────────

export type Tally = Readonly<Record<Severity, number>>;

export const tally = (findings: readonly Finding[]): Tally => {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, harness: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
};

/** Per-market rollup, so a report can say which countries are affected. */
export const byMarket = (findings: readonly Finding[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    if (finding.severity === 'harness') continue;
    for (const market of finding.market.split(',').map((entry) => entry.trim())) {
      if (market !== '') counts[market] = (counts[market] ?? 0) + 1;
    }
  }
  return counts;
};

export const withinBudget = (config: A11yConfig, counts: Tally): boolean =>
  counts.critical <= config.maxCritical &&
  counts.major <= config.maxMajor &&
  counts.minor <= config.maxMinor;
