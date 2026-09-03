import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  byMarket,
  compareAcrossLocales,
  isExempt,
  judgePage,
  loadA11yConfig,
  tally,
  withinBudget,
  type A11yConfig,
  type AxeViolation,
  type PageScan,
} from './a11y.js';
import { loadI18nConfig } from '../../i18n/lib/config.js';

const config = (over: Partial<A11yConfig> = {}): A11yConfig => ({
  locales: [
    { code: 'en', lang: 'en', market: 'US', isSource: true },
    { code: 'de', lang: 'de', market: 'DE', isSource: false },
    { code: 'ja', lang: 'ja', market: 'JP', isSource: false },
  ],
  routes: [{ path: '/', name: 'Home' }],
  wcagTags: ['wcag2aa'],
  severities: {
    critical: 'critical',
    serious: 'major',
    moderate: 'minor',
    minor: 'minor',
    html_lang_mismatch: 'major',
    untranslated_alt: 'major',
    untranslated_aria_label: 'minor',
    locale_only_violation: 'major',
  },
  maxCritical: 0,
  maxMajor: 0,
  maxMinor: 25,
  minAltCharsToCompare: 12,
  exemptions: [],
  ...over,
});

const violation = (id: string, impact: string): AxeViolation => ({
  id,
  impact,
  help: `${id} help text`,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
  nodes: [{ target: [`#${id}`], html: '<div></div>' }],
});

const scan = (over: Partial<PageScan> = {}): PageScan => ({
  locale: 'de',
  market: 'DE',
  route: '/',
  routeName: 'Home',
  status: 200,
  violations: [],
  htmlLang: 'de',
  labels: { alts: [], ariaLabels: [] },
  ...over,
});

const kinds = (findings: readonly { readonly kind: string }[]): readonly string[] =>
  findings.map((f) => f.kind).sort();

// ── the shipped config ───────────────────────────────────────────────────

void test('config: a11y.yaml scans exactly the markets the locale contract declares', () => {
  // Asserted against config/i18n.yaml rather than a hardcoded list, because a
  // hardcoded list is what let these two drift.
  //
  // The locale contract narrowed to ES/DE/IT/FR when KO and JA were removed —
  // the store does not serve those markets — and this file kept scanning `/ja/`
  // and `/ko/` for weeks afterwards. `judgePage` reported those honestly, as
  // `not_scanned` harness findings rather than passes, so nothing was falsely
  // clean. What they cost was eight harness findings a run about markets we do
  // not sell in, which is the noise that trains people to skim the section the
  // real "could not check" findings live in.
  //
  // Pinning them to each other means adding a market is one edit and removing
  // one cannot be half-done.
  const loaded = loadA11yConfig();
  const contracted = loadI18nConfig().locales.map((locale) => locale.market).sort();

  assert.deepEqual(
    loaded.locales.map((locale) => locale.market).sort(),
    contracted,
    'config/a11y.yaml and config/i18n.yaml must cover the same markets',
  );
  assert.ok(loaded.routes.length >= 4);
  assert.ok(loaded.wcagTags.includes('wcag22aa'));
});

void test('config: exactly one locale is the source, and it is required', () => {
  // Untranslated alt text is decided by comparison against the source locale.
  // With none declared, that whole class of finding would silently never fire.
  const loaded = loadA11yConfig();
  assert.equal(loaded.locales.filter((locale) => locale.isSource).length, 1);
});

void test('config: every exemption carries a reason and an owner', () => {
  // An exemption with no reason is indistinguishable from a rule someone
  // switched off because it was inconvenient.
  for (const exemption of loadA11yConfig().exemptions) {
    assert.ok(exemption.reason.length > 20, `${exemption.rule} needs a real reason`);
    assert.ok(exemption.owner.length > 0, `${exemption.rule} needs an owner`);
  }
});

// ── WCAG violations ──────────────────────────────────────────────────────

void test('judgePage: a clean page produces no findings', () => {
  assert.deepEqual(judgePage(config(), scan()), []);
});

void test('judgePage: axe impact maps onto the suite severities', () => {
  const findings = judgePage(
    config(),
    scan({ violations: [violation('image-alt', 'critical'), violation('label', 'moderate')] }),
  );
  assert.deepEqual(findings.map((f) => f.severity).sort(), ['critical', 'minor']);
  assert.ok(findings.every((f) => f.kind === 'wcag_violation'));
});

void test('judgePage: an exempt rule is skipped, an unexempt one is not', () => {
  const exempt = config({
    exemptions: [
      { rule: 'color-contrast', route: '/', locales: ['all'], reason: 'x'.repeat(30), owner: 'design' },
    ],
  });
  assert.deepEqual(judgePage(exempt, scan({ violations: [violation('color-contrast', 'serious')] })), []);
  assert.equal(judgePage(exempt, scan({ violations: [violation('image-alt', 'serious')] })).length, 1);
});

void test('isExempt: honours route and locale scoping', () => {
  const scoped = config({
    exemptions: [
      { rule: 'r', route: '/cart', locales: ['de'], reason: 'x'.repeat(30), owner: 'o' },
    ],
  });
  assert.equal(isExempt(scoped, 'r', '/cart', 'de'), true);
  assert.equal(isExempt(scoped, 'r', '/', 'de'), false, 'a different route must not be exempt');
  assert.equal(isExempt(scoped, 'r', '/cart', 'ja'), false, 'a different locale must not be exempt');
});

// ── the locale rules axe cannot express ──────────────────────────────────

void test('judgePage: a localized page declaring the wrong language is major', () => {
  // Passes every axe rule and is still unusable: a screen reader pronounces
  // German text with English phonemes.
  const findings = judgePage(config(), scan({ locale: 'de', market: 'DE', htmlLang: 'en' }));
  assert.deepEqual(kinds(findings), ['html_lang_mismatch']);
  assert.equal(findings[0]?.severity, 'major');
  assert.match(findings[0]?.detail ?? '', /wrong\s+phonemes/u);
});

void test('judgePage: a region subtag is accepted, a different language is not', () => {
  // fr-CA still reads as French; en on a French page does not.
  assert.deepEqual(
    judgePage(
      config({ locales: [{ code: 'fr', lang: 'fr', market: 'CA', isSource: false }] }),
      scan({ locale: 'fr', market: 'CA', htmlLang: 'fr-CA' }),
    ),
    [],
  );
});

void test('judgePage: a page with no lang attribute at all is reported', () => {
  const findings = judgePage(config(), scan({ htmlLang: undefined }));
  assert.deepEqual(kinds(findings), ['html_lang_mismatch']);
  assert.match(findings[0]?.detail ?? '', /declares no language/u);
});

void test('judgePage: alt text identical to the source locale is major', () => {
  // The failure sighted testers never catch: the page looks perfectly German
  // and every image description is still English.
  const source = scan({
    locale: 'en',
    market: 'US',
    htmlLang: 'en',
    labels: { alts: ['Self-draining soap dish in terracotta'], ariaLabels: [] },
  });
  const findings = judgePage(
    config(),
    scan({ labels: { alts: ['Self-draining soap dish in terracotta'], ariaLabels: [] } }),
    source,
  );
  assert.deepEqual(kinds(findings), ['untranslated_alt']);
  assert.match(findings[0]?.detail ?? '', /a blind one hears English/u);
});

void test('judgePage: translated alt text produces nothing', () => {
  const source = scan({
    locale: 'en',
    market: 'US',
    labels: { alts: ['Self-draining soap dish in terracotta'], ariaLabels: [] },
  });
  assert.deepEqual(
    judgePage(config(), scan({ labels: { alts: ['Seifenschale mit Ablauf in Terrakotta'], ariaLabels: [] } }), source),
    [],
  );
});

void test('judgePage: short alt text is not compared across locales', () => {
  // Codes and units are legitimately identical everywhere; comparing them
  // produces noise rather than findings.
  const source = scan({ locale: 'en', market: 'US', labels: { alts: ['SKU 4102'], ariaLabels: [] } });
  assert.deepEqual(
    judgePage(config(), scan({ labels: { alts: ['SKU 4102'], ariaLabels: [] } }), source),
    [],
  );
});

void test('judgePage: an untranslated aria-label is minor, not major', () => {
  const source = scan({
    locale: 'en',
    market: 'US',
    labels: { alts: [], ariaLabels: ['Add to shopping cart'] },
  });
  const findings = judgePage(
    config(),
    scan({ labels: { alts: [], ariaLabels: ['Add to shopping cart'] } }),
    source,
  );
  assert.deepEqual(kinds(findings), ['untranslated_aria_label']);
  assert.equal(findings[0]?.severity, 'minor');
});

// ── vacuity ──────────────────────────────────────────────────────────────

void test('judgePage: a page that did not load is harness, never clean', () => {
  const findings = judgePage(config(), scan({ status: 500 }));
  assert.deepEqual(kinds(findings), ['not_scanned']);
  assert.equal(findings[0]?.severity, 'harness');
});

void test('judgePage: axe not running is never "no violations"', () => {
  // A scan that did not run and a clean page look identical in a count, and
  // only one of them is good news.
  const findings = judgePage(config(), scan({ violations: undefined }));
  assert.deepEqual(kinds(findings), ['not_scanned']);
  assert.equal(findings[0]?.severity, 'harness');
});

// ── across markets ───────────────────────────────────────────────────────

void test('compareAcrossLocales: a rule failing everywhere is a theme defect, not locale-only', () => {
  const failing = [violation('color-contrast', 'serious')];
  const findings = compareAcrossLocales(config(), [
    scan({ locale: 'en', market: 'US', violations: failing }),
    scan({ locale: 'de', market: 'DE', violations: failing }),
  ]);
  assert.deepEqual(findings, []);
});

void test('compareAcrossLocales: a rule failing in some markets only is reported with the markets', () => {
  // The finding a per-page report cannot produce, and the one worth most: a
  // defect in two markets came from their localization, not the theme.
  const findings = compareAcrossLocales(config(), [
    scan({ locale: 'en', market: 'US', violations: [] }),
    scan({ locale: 'de', market: 'DE', violations: [violation('label', 'serious')] }),
    scan({ locale: 'ja', market: 'JP', violations: [violation('label', 'serious')] }),
  ]);
  assert.deepEqual(kinds(findings), ['locale_only_violation']);
  assert.match(findings[0]?.market ?? '', /DE/u);
  assert.match(findings[0]?.market ?? '', /JP/u);
  assert.match(findings[0]?.detail ?? '', /came from their localization/u);
});

void test('compareAcrossLocales: an unscanned locale never counts as passing', () => {
  // Otherwise a locale that failed to load makes every rule look locale-only.
  const findings = compareAcrossLocales(config(), [
    scan({ locale: 'en', market: 'US', violations: undefined }),
    scan({ locale: 'de', market: 'DE', violations: [violation('label', 'serious')] }),
  ]);
  assert.deepEqual(findings, [], 'one scanned locale is not a comparison');
});

// ── budgets and rollup ───────────────────────────────────────────────────

void test('byMarket: rolls findings up per country and excludes harness', () => {
  const findings = [
    ...judgePage(config(), scan({ locale: 'de', market: 'DE', htmlLang: 'en' })),
    ...judgePage(config(), scan({ locale: 'ja', market: 'JP', status: 500 })),
  ];
  const rollup = byMarket(findings);
  assert.equal(rollup.DE, 1);
  assert.equal(rollup.JP, undefined, 'a harness finding is not a market defect');
});

void test('withinBudget: criticals and majors block, minors have a budget', () => {
  assert.equal(withinBudget(config(), tally([])), true);
  assert.equal(
    withinBudget(config(), { critical: 0, major: 1, minor: 0, harness: 0 }),
    false,
    'one major must fail the gate',
  );
  assert.equal(
    withinBudget(config(), { critical: 0, major: 0, minor: 25, harness: 0 }),
    true,
    'minors are budgeted, because a gate nobody can pass gets switched off',
  );
  assert.equal(withinBudget(config(), { critical: 0, major: 0, minor: 26, harness: 0 }), false);
});
