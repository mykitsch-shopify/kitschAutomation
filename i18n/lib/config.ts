import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

/**
 * Typed access to config/i18n.yaml.
 *
 * The YAML is parsed as `unknown` and narrowed explicitly. A loader that
 * casts its input hands malformed config straight to the comparison engine,
 * which then reports nothing and looks green — the exact failure mode this
 * harness exists to prevent.
 */

export type LocaleCode = string;

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type FindingKind =
  | 'missing_translation'
  | 'empty_translation'
  | 'placeholder_drift'
  | 'untranslated_candidate'
  | 'protected_term_translated'
  | 'length_overflow_risk'
  | 'encoding_error'
  | 'script_missing'
  | 'diacritic_absent'
  | 'meta_untranslated'
  | 'inconsistent_translation'
  | 'collector_error';

/**
 * Defaults matching the Aug-11 framework proposal. config/i18n.yaml overrides
 * these; the Translations test plan raises several of them to `major`.
 */
const DEFAULT_SEVERITIES: Readonly<Record<FindingKind, Severity>> = {
  missing_translation: 'major',
  empty_translation: 'major',
  placeholder_drift: 'major',
  untranslated_candidate: 'minor',
  protected_term_translated: 'minor',
  length_overflow_risk: 'minor',
  encoding_error: 'major',
  script_missing: 'major',
  diacritic_absent: 'minor',
  meta_untranslated: 'minor',
  inconsistent_translation: 'minor',
  // Never configurable. A collector failure is our fault, and letting a
  // config edit downgrade it is how an outage becomes a clean report.
  collector_error: 'harness',
};

const SEVERITY_VALUES: readonly Severity[] = ['critical', 'major', 'minor', 'harness'];

export type LocaleSpec = {
  readonly code: LocaleCode;
  readonly market: string;
  readonly currency: string;
  readonly pricePattern: RegExp;
  /**
   * Unicode script the locale's copy must contain to count as translated.
   * `undefined` for Latin-script locales, where script presence proves
   * nothing — those rely on the identical-to-source check instead.
   */
  readonly expectScript: RegExp | undefined;
  readonly expectDiacritics: boolean;
  readonly diacritics: readonly string[];
  /**
   * Font families the theme must declare for this locale's script. Empty for
   * locales where the default Latin stack is sufficient.
   */
  readonly fontFamilies: readonly string[];
};

export type RouteSpec = {
  readonly path: string;
  readonly name: string;
  readonly tags: readonly string[];
};

export type Exemption = {
  readonly key: string;
  readonly locales: readonly LocaleCode[];
  readonly reason: string;
};

/**
 * An English source string that is allowed to translate differently in
 * different places. "Checkout" is a button in the cart and a heading on the
 * checkout page, and those are correctly different words in five of the six
 * target locales — without this list the consistency check would report all
 * five as defects.
 */
export type ConsistencyExemption = {
  readonly source: string;
  readonly reason: string;
};

export type Thresholds = {
  readonly lengthRatioWarn: number;
  /**
   * Source strings shorter than this are exempt from the length-ratio check.
   * "New" → "Nouveautés" is 3.3× and cannot break a layout; applying the
   * ratio to nav labels buries the handful of genuinely long strings under
   * dozens of rows nobody will read.
   */
  readonly lengthRatioMinSourceChars: number;
  readonly overflowPx: number;
  readonly maxMajor: number;
  readonly maxMinor: number;
};

export type I18nConfig = {
  readonly sourceLocale: LocaleCode;
  readonly locales: readonly LocaleSpec[];
  readonly routes: readonly RouteSpec[];
  readonly resources: readonly string[];
  readonly doNotTranslate: readonly string[];
  readonly exemptions: readonly Exemption[];
  readonly consistencyExemptions: readonly ConsistencyExemption[];
  readonly severities: Readonly<Record<FindingKind, Severity>>;
  readonly thresholds: Thresholds;
  readonly placeholderPatterns: readonly RegExp[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, at: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`i18n.yaml: expected a mapping at "${at}"`);
  }
  return value;
};

const requireString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`i18n.yaml: expected a non-empty string at "${at}"`);
  }
  return value;
};

const requireNumber = (value: unknown, at: string): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`i18n.yaml: expected a number at "${at}"`);
  }
  return value;
};

const requireArray = (value: unknown, at: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`i18n.yaml: expected a list at "${at}"`);
  }
  return value;
};

const stringList = (value: unknown, at: string): readonly string[] =>
  requireArray(value, at).map((entry, index) => requireString(entry, `${at}[${String(index)}]`));

const optionalStringList = (value: unknown, at: string): readonly string[] =>
  value === undefined ? [] : stringList(value, at);

const optionalBoolean = (value: unknown, at: string): boolean => {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`i18n.yaml: expected a boolean at "${at}"`);
  }
  return value;
};

/**
 * `\p{Script=…}` is validated here rather than at first use. A typo in a
 * script name would otherwise throw halfway through a nightly run, after the
 * report had already been half-written.
 */
const parseScript = (value: unknown, at: string): RegExp | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const names = requireString(value, at).split('|');
  const source = names.map((name) => `\\p{Script=${name.trim()}}`).join('|');
  try {
    return new RegExp(source, 'u');
  } catch {
    throw new Error(`i18n.yaml: "${at}" is not a valid Unicode script name: ${JSON.stringify(value)}`);
  }
};

const parseLocales = (value: unknown): readonly LocaleSpec[] => {
  const record = requireRecord(value, 'locales');
  return Object.entries(record).map(([code, raw]) => {
    const spec = requireRecord(raw, `locales.${code}`);
    return {
      code,
      market: requireString(spec.market, `locales.${code}.market`),
      currency: requireString(spec.currency, `locales.${code}.currency`),
      pricePattern: new RegExp(requireString(spec.price_pattern, `locales.${code}.price_pattern`), 'u'),
      expectScript: parseScript(spec.expect_script, `locales.${code}.expect_script`),
      expectDiacritics: optionalBoolean(spec.expect_diacritics, `locales.${code}.expect_diacritics`),
      diacritics: optionalStringList(spec.diacritics, `locales.${code}.diacritics`),
      fontFamilies: optionalStringList(spec.font_families, `locales.${code}.font_families`),
    };
  });
};

const parseRoutes = (value: unknown): readonly RouteSpec[] =>
  requireArray(value, 'routes').map((raw, index) => {
    const route = requireRecord(raw, `routes[${String(index)}]`);
    const tags = route.tags;
    return {
      path: requireString(route.path, `routes[${String(index)}].path`),
      name: requireString(route.name, `routes[${String(index)}].name`),
      tags: tags === undefined ? [] : stringList(tags, `routes[${String(index)}].tags`),
    };
  });

const parseExemptions = (value: unknown): readonly Exemption[] => {
  if (value === undefined) {
    return [];
  }
  return requireArray(value, 'exemptions').map((raw, index) => {
    const entry = requireRecord(raw, `exemptions[${String(index)}]`);
    return {
      key: requireString(entry.key, `exemptions[${String(index)}].key`),
      locales: stringList(entry.locales, `exemptions[${String(index)}].locales`),
      // An exemption without a stated reason is indistinguishable from a
      // dropped requirement six months later.
      reason: requireString(entry.reason, `exemptions[${String(index)}].reason`),
    };
  });
};

const parseConsistencyExemptions = (value: unknown): readonly ConsistencyExemption[] => {
  if (value === undefined) {
    return [];
  }
  return requireArray(value, 'consistency_exemptions').map((raw, index) => {
    const entry = requireRecord(raw, `consistency_exemptions[${String(index)}]`);
    return {
      source: requireString(entry.source, `consistency_exemptions[${String(index)}].source`),
      reason: requireString(entry.reason, `consistency_exemptions[${String(index)}].reason`),
    };
  });
};

const parseSeverities = (value: unknown): Readonly<Record<FindingKind, Severity>> => {
  if (value === undefined) {
    return DEFAULT_SEVERITIES;
  }
  const record = requireRecord(value, 'severities');
  const merged: Record<string, Severity> = { ...DEFAULT_SEVERITIES };

  for (const [kind, raw] of Object.entries(record)) {
    if (!(kind in DEFAULT_SEVERITIES)) {
      throw new Error(`i18n.yaml: "severities.${kind}" is not a known finding kind`);
    }
    if (kind === 'collector_error') {
      throw new Error(
        'i18n.yaml: "severities.collector_error" cannot be overridden — a collector failure is harness debt by definition.',
      );
    }
    const severity = requireString(raw, `severities.${kind}`);
    if (!SEVERITY_VALUES.includes(severity as Severity)) {
      throw new Error(
        `i18n.yaml: "severities.${kind}" must be one of ${SEVERITY_VALUES.join(', ')}, got "${severity}"`,
      );
    }
    merged[kind] = severity as Severity;
  }

  return merged as Record<FindingKind, Severity>;
};

const parseThresholds = (value: unknown): Thresholds => {
  const record = requireRecord(value, 'thresholds');
  return {
    lengthRatioWarn: requireNumber(record.length_ratio_warn, 'thresholds.length_ratio_warn'),
    lengthRatioMinSourceChars: requireNumber(
      record.length_ratio_min_source_chars,
      'thresholds.length_ratio_min_source_chars',
    ),
    overflowPx: requireNumber(record.overflow_px, 'thresholds.overflow_px'),
    maxMajor: requireNumber(record.max_major, 'thresholds.max_major'),
    maxMinor: requireNumber(record.max_minor, 'thresholds.max_minor'),
  };
};

export const loadI18nConfig = (path = 'config/i18n.yaml'): I18nConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  const root = requireRecord(raw, '<root>');

  const config: I18nConfig = {
    sourceLocale: requireString(root.source_locale, 'source_locale'),
    locales: parseLocales(root.locales),
    routes: parseRoutes(root.routes),
    resources: stringList(root.resources, 'resources'),
    doNotTranslate: stringList(root.do_not_translate, 'do_not_translate'),
    exemptions: parseExemptions(root.exemptions),
    consistencyExemptions: parseConsistencyExemptions(root.consistency_exemptions),
    severities: parseSeverities(root.severities),
    thresholds: parseThresholds(root.thresholds),
    placeholderPatterns: stringList(root.placeholder_syntaxes, 'placeholder_syntaxes').map(
      (pattern) => new RegExp(pattern, 'g'),
    ),
  };

  // A source locale that is not declared makes every comparison silently
  // vacuous — every locale would be a "target" with nothing to compare to.
  if (!config.locales.some((locale) => locale.code === config.sourceLocale)) {
    throw new Error(
      `i18n.yaml: source_locale "${config.sourceLocale}" is not present in the locales map`,
    );
  }

  return config;
};

export const localeFor = (config: I18nConfig, code: LocaleCode): LocaleSpec => {
  const found = config.locales.find((locale) => locale.code === code);
  if (found === undefined) {
    throw new Error(`Locale "${code}" is not declared in config/i18n.yaml`);
  }
  return found;
};

export const targetLocales = (config: I18nConfig): readonly LocaleSpec[] =>
  config.locales.filter((locale) => locale.code !== config.sourceLocale);
