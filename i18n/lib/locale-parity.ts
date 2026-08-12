import type { FindingKind, I18nConfig, LocaleCode, LocaleSpec, Severity } from './config.js';
import {
  containsLetters,
  describeDefects,
  findEncodingDefects,
  matchesScript,
} from './text-integrity.js';

/**
 * Locale parity engine — content layer.
 *
 * Compares every translatable string in a target locale against the English
 * source and emits findings in the same canonical shape the reconciliation
 * diff engine produces, so they flow through the existing severity, gate and
 * escalation machinery rather than a second reporting path.
 *
 * This layer is deliberately browser-free. Every string in the catalogue is
 * checked here; the render layer (i18n/specs) only checks what a DOM can show
 * that an API cannot — formatting, hreflang wiring, meta tags, and overflow.
 */

export type { FindingKind, Severity } from './config.js';

/** Distinguishes "we could not fetch" from "we fetched, the value is absent". */
export type EntryStatus = 'present' | 'absent' | 'fetch_failed';

export type TranslationEntry = {
  readonly key: string;
  readonly locale: LocaleCode;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly status: EntryStatus;
  readonly value: string | undefined;
};

export type Finding = {
  readonly severity: Severity;
  readonly kind: FindingKind;
  readonly key: string;
  readonly locale: LocaleCode;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly detail: string;
  readonly sourceValue: string | undefined;
  readonly targetValue: string | undefined;
};

export type ParitySummary = {
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly harness: number;
  readonly comparedKeys: number;
};

const collapse = (value: string): string => value.replace(/\s+/gu, ' ').trim();

const normalize = (value: string): string =>
  collapse(value)
    .toLocaleLowerCase('en')
    .replace(/[®™©]/gu, '');

/** Strings that carry no translatable content and would produce noise. */
const isNonLinguistic = (value: string): boolean => {
  const text = collapse(value);
  if (text.length <= 2) {
    return true;
  }
  return /^[\d\s\p{P}\p{S}]+$/u.test(text) || /^https?:\/\//u.test(text);
};

export const placeholdersOf = (value: string, config: I18nConfig): readonly string[] => {
  const found: string[] = [];
  for (const pattern of config.placeholderPatterns) {
    // Rebuild per call: a shared global regex carries lastIndex between
    // strings and silently skips matches.
    const scoped = new RegExp(pattern.source, 'gu');
    for (const match of value.matchAll(scoped)) {
      const token = match[0];
      found.push(collapse(token).replace(/\s+/gu, ''));
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
};

const sameMultiset = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((token, index) => token === right[index]);

const isExempt = (config: I18nConfig, key: string, locale: LocaleCode): boolean =>
  config.exemptions.some(
    (exemption) => exemption.key === key && exemption.locales.includes(locale),
  );

const isProtectedTerm = (config: I18nConfig, value: string): boolean => {
  const text = normalize(value);
  return config.doNotTranslate.some((term) => normalize(term) === text);
};

/** Severity is a config decision, not a code decision. See config/i18n.yaml. */
const severityOf = (config: I18nConfig, kind: FindingKind): Severity => config.severities[kind];

const finding = (
  base: Pick<TranslationEntry, 'key' | 'locale' | 'resourceType' | 'resourceId'>,
  config: I18nConfig,
  kind: FindingKind,
  detail: string,
  sourceValue: string | undefined,
  targetValue: string | undefined,
): Finding => ({
  severity: severityOf(config, kind),
  kind,
  key: base.key,
  locale: base.locale,
  resourceType: base.resourceType,
  resourceId: base.resourceId,
  detail,
  sourceValue,
  targetValue,
});

export const comparePair = (
  source: TranslationEntry,
  target: TranslationEntry,
  config: I18nConfig,
  locale?: LocaleSpec,
): readonly Finding[] => {
  const findings: Finding[] = [];
  const sourceText = source.value;

  if (source.status !== 'present' || sourceText === undefined) {
    return [
      finding(
        target,
        config,
        // Our side failed, not the client's. Harness debt, tracked but not
        // reported against the engagement.
        'collector_error',
        `Source locale "${config.sourceLocale}" value unavailable (${source.status}); nothing to compare against.`,
        undefined,
        target.value,
      ),
    ];
  }

  switch (target.status) {
    case 'fetch_failed':
      return [
        finding(
          target,
          config,
          'collector_error',
          'Translation fetch failed. An outage must not be reported as a clean locale.',
          sourceText,
          undefined,
        ),
      ];
    case 'absent':
      if (isExempt(config, target.key, target.locale)) {
        return [];
      }
      return [
        finding(
          target,
          config,
          'missing_translation',
          'No translation registered for this key. The market surface falls back to English.',
          sourceText,
          undefined,
        ),
      ];
    case 'present':
      break;
  }

  const targetText = target.value ?? '';

  if (collapse(targetText).length === 0) {
    return [
      finding(
        target,
        config,
        'empty_translation',
        'Translation exists but is empty — renders as a blank string, not a fallback.',
        sourceText,
        targetText,
      ),
    ];
  }

  // ── Character integrity ────────────────────────────────────────────────
  // Runs before the linguistic checks: a mojibake'd string is damaged
  // regardless of whether it is also the wrong length or a duplicate of the
  // source, and reporting the damage is more actionable than reporting the
  // symptoms.
  const defects = findEncodingDefects(targetText);
  if (defects.length > 0) {
    findings.push(
      finding(
        target,
        config,
        'encoding_error',
        `Character encoding damage in the ${target.locale} value — ${describeDefects(defects)}`,
        sourceText,
        targetText,
      ),
    );
  }

  const sourcePlaceholders = placeholdersOf(sourceText, config);
  const targetPlaceholders = placeholdersOf(targetText, config);
  if (!sameMultiset(sourcePlaceholders, targetPlaceholders)) {
    findings.push(
      finding(
        target,
        config,
        'placeholder_drift',
        `Interpolation tokens differ: source [${sourcePlaceholders.join(', ')}] vs target [${targetPlaceholders.join(', ')}]. A dropped token renders a broken sentence or a missing value.`,
        sourceText,
        targetText,
      ),
    );
  }

  const exempt = isExempt(config, target.key, target.locale);
  const protectedTerm = isProtectedTerm(config, sourceText);
  const identical = normalize(sourceText) === normalize(targetText);
  const untranslated =
    identical && !isNonLinguistic(sourceText) && !protectedTerm && !exempt;

  if (untranslated) {
    findings.push(
      finding(
        target,
        config,
        'untranslated_candidate',
        'Target value is identical to the English source and is not a protected term or declared exemption. In a non-English mode this reaches the customer as an untranslated fallback string.',
        sourceText,
        targetText,
      ),
    );
  }

  // ── Expected script ────────────────────────────────────────────────────
  // Only meaningful for locales that declare one (ko, ja). Skipped when the
  // string is already reported as untranslated — that is the same defect
  // described more precisely, and counting it twice inflates the gate.
  if (
    locale !== undefined &&
    locale.expectScript !== undefined &&
    !untranslated &&
    !exempt &&
    !protectedTerm &&
    containsLetters(targetText) &&
    !isNonLinguistic(targetText) &&
    !matchesScript(targetText, locale.expectScript)
  ) {
    findings.push(
      finding(
        target,
        config,
        'script_missing',
        `Value contains no ${locale.market} script characters. The string differs from English but is not rendered in the locale's writing system — it will read as untranslated to the customer.`,
        sourceText,
        targetText,
      ),
    );
  }

  if (protectedTerm && !identical) {
    findings.push(
      finding(
        target,
        config,
        'protected_term_translated',
        `"${collapse(sourceText)}" is declared do-not-translate but differs in this locale.`,
        sourceText,
        targetText,
      ),
    );
  }

  const sourceLength = collapse(sourceText).length;
  if (sourceLength >= config.thresholds.lengthRatioMinSourceChars) {
    const lengthRatio = collapse(targetText).length / sourceLength;
    if (lengthRatio > config.thresholds.lengthRatioWarn) {
      findings.push(
        finding(
          target,
          config,
          // Flag for the render layer to confirm; length alone is not a break.
          'length_overflow_risk',
          `Target is ${lengthRatio.toFixed(2)}x the source length (warn above ${String(config.thresholds.lengthRatioWarn)}x). Check for truncation or overflow on the 390px viewport.`,
          sourceText,
          targetText,
        ),
      );
    }
  }

  return findings;
};

/**
 * Minimum translated strings before the catalogue-wide diacritic check is
 * meaningful. Below this, an absence of umlauts is a small sample, not a
 * stripped character set.
 */
const DIACRITIC_SAMPLE_FLOOR = 10;

/**
 * Catalogue-level check: a German catalogue with not one umlaut in it across
 * hundreds of strings is not a German catalogue with plain vocabulary — it is
 * a character set being stripped somewhere in the pipeline. Per-string this is
 * invisible; only the aggregate shows it.
 */
const auditDiacritics = (
  entries: readonly TranslationEntry[],
  locale: LocaleSpec,
  config: I18nConfig,
): readonly Finding[] => {
  if (!locale.expectDiacritics || locale.diacritics.length === 0) {
    return [];
  }

  const present = entries.filter(
    (entry) =>
      entry.status === 'present' &&
      entry.value !== undefined &&
      containsLetters(entry.value) &&
      !isNonLinguistic(entry.value),
  );
  if (present.length < DIACRITIC_SAMPLE_FLOOR) {
    return [];
  }

  const distinct = new Set<string>();
  for (const entry of present) {
    for (const character of locale.diacritics) {
      if ((entry.value ?? '').includes(character)) {
        distinct.add(character);
      }
    }
  }
  if (distinct.size > 0) {
    return [];
  }

  return [
    finding(
      {
        key: `${locale.code}.catalog`,
        locale: locale.code,
        resourceType: 'CATALOG',
        resourceId: `locale:${locale.code}`,
      },
      config,
      'diacritic_absent',
      `Not one of ${locale.market}'s accented characters (${locale.diacritics.join(' ')}) appears anywhere across ${String(present.length)} translated strings. Either the copy is not really in ${locale.code}, or the character set is being stripped in transit.`,
      undefined,
      undefined,
    ),
  ];
};

/**
 * Terminology consistency — test plan §13.1.
 *
 * Within a locale, if the same English string is translated two different
 * ways, one of them is probably wrong, and the customer meets both while
 * moving between the homepage, a collection and the cart.
 *
 * The trap this check has to avoid: "Checkout" is a cart button and a page
 * heading, and those are correctly different words in most of these locales.
 * Grouping by resource type does not separate them — both are theme strings —
 * so the divergences that are legitimate are declared in
 * `consistency_exemptions` with a reason, exactly like the other exemptions.
 * The alternative was shipping a check that cried wolf five times on a clean
 * catalogue, which costs more trust than the check is worth.
 */
const auditConsistency = (
  sourceEntries: readonly TranslationEntry[],
  targetEntries: readonly TranslationEntry[],
  locale: LocaleSpec,
  config: I18nConfig,
): readonly Finding[] => {
  const exemptSources = new Set(
    config.consistencyExemptions.map((exemption) => normalize(exemption.source)),
  );

  const sourceByKey = new Map(sourceEntries.map((entry) => [entry.key, entry]));

  // English value → the target renderings it maps to, with the key each
  // rendering came from.
  const groups = new Map<string, Map<string, { key: string; value: string }>>();

  for (const target of targetEntries) {
    if (target.status !== 'present' || target.value === undefined) {
      continue;
    }
    const source = sourceByKey.get(target.key);
    if (source?.status !== 'present' || source.value === undefined) {
      continue;
    }
    if (
      isNonLinguistic(source.value) ||
      isProtectedTerm(config, source.value) ||
      isExempt(config, target.key, target.locale)
    ) {
      continue;
    }

    const sourceNorm = normalize(source.value);
    if (exemptSources.has(sourceNorm)) {
      continue;
    }

    const renderings = groups.get(sourceNorm) ?? new Map();
    const targetNorm = normalize(target.value);
    if (!renderings.has(targetNorm)) {
      renderings.set(targetNorm, { key: target.key, value: collapse(target.value) });
    }
    groups.set(sourceNorm, renderings);
  }

  const findings: Finding[] = [];
  for (const [sourceNorm, renderings] of groups) {
    if (renderings.size < 2) {
      continue;
    }
    const [reference, ...divergent] = [...renderings.values()];
    if (reference === undefined) {
      continue;
    }
    const source = sourceEntries.find((entry) => normalize(entry.value ?? '') === sourceNorm);

    // One finding per divergent key, not one per group. A finding keyed on
    // the group's first occurrence names the string that is probably
    // *correct* and never names the one that needs changing, which makes the
    // row unactionable — and invisible to anything checking coverage by key.
    for (const variant of divergent) {
      findings.push(
        finding(
          {
            key: variant.key,
            locale: locale.code,
            resourceType: 'CATALOG',
            resourceId: `consistency:${locale.code}`,
          },
          config,
          'inconsistent_translation',
          `"${source?.value ?? sourceNorm}" is rendered "${variant.value}" here but "${reference.value}" at ${reference.key}. Same concept, two terms, both visible while moving between pages.`,
          source?.value,
          variant.value,
        ),
      );
    }
  }

  return findings;
};

/**
 * English baseline audit — test plan §4. The source locale is the reference
 * every other check leans on, so damage in it is worth its own finding rather
 * than being inherited silently by all six targets.
 */
export const auditSource = (
  sourceEntries: readonly TranslationEntry[],
  config: I18nConfig,
): readonly Finding[] => {
  const findings: Finding[] = [];
  for (const entry of sourceEntries) {
    if (entry.status === 'fetch_failed') {
      findings.push(
        finding(
          entry,
          config,
          'collector_error',
          'English baseline value could not be fetched. Every target comparison for this key is unverifiable.',
          undefined,
          undefined,
        ),
      );
      continue;
    }
    if (entry.status === 'absent' || entry.value === undefined) {
      continue;
    }
    if (collapse(entry.value).length === 0) {
      findings.push(
        finding(
          entry,
          config,
          'empty_translation',
          'English baseline string is empty — the source of truth itself renders blank.',
          entry.value,
          undefined,
        ),
      );
      continue;
    }
    const defects = findEncodingDefects(entry.value);
    if (defects.length > 0) {
      findings.push(
        finding(
          entry,
          config,
          'encoding_error',
          `Character encoding damage in the English baseline — ${describeDefects(defects)}`,
          entry.value,
          undefined,
        ),
      );
    }
  }
  return findings;
};

export const compareCatalog = (
  sourceEntries: readonly TranslationEntry[],
  targetEntries: readonly TranslationEntry[],
  config: I18nConfig,
): readonly Finding[] => {
  const sourceByKey = new Map<string, TranslationEntry>();
  for (const entry of sourceEntries) {
    sourceByKey.set(entry.key, entry);
  }

  const localeByCode = new Map<LocaleCode, LocaleSpec>(
    config.locales.map((locale) => [locale.code, locale]),
  );

  const findings: Finding[] = [];
  const seenLocales = new Set<LocaleCode>();

  for (const target of targetEntries) {
    seenLocales.add(target.locale);
    const source = sourceByKey.get(target.key);
    if (source === undefined) {
      findings.push(
        finding(
          target,
          config,
          // A key present in a target locale but not in the source means our
          // key extraction is wrong, not that the client mistranslated.
          'collector_error',
          'Key exists in the target locale but not in the source catalogue — key extraction is inconsistent.',
          undefined,
          target.value,
        ),
      );
      continue;
    }
    findings.push(...comparePair(source, target, config, localeByCode.get(target.locale)));
  }

  for (const code of seenLocales) {
    const locale = localeByCode.get(code);
    if (locale === undefined) {
      // Comparing against a locale nobody declared means the run is not
      // testing what the contract says it tests.
      findings.push(
        finding(
          {
            key: `${code}.catalog`,
            locale: code,
            resourceType: 'CATALOG',
            resourceId: `locale:${code}`,
          },
          config,
          'collector_error',
          `Collector returned entries for locale "${code}", which is not declared in config/i18n.yaml.`,
          undefined,
          undefined,
        ),
      );
      continue;
    }
    const forLocale = targetEntries.filter((entry) => entry.locale === code);
    findings.push(...auditDiacritics(forLocale, locale, config));
    findings.push(...auditConsistency(sourceEntries, forLocale, locale, config));
  }

  return findings;
};

export const summarize = (
  findings: readonly Finding[],
  comparedKeys: number,
): ParitySummary => ({
  critical: findings.filter((item) => item.severity === 'critical').length,
  major: findings.filter((item) => item.severity === 'major').length,
  minor: findings.filter((item) => item.severity === 'minor').length,
  harness: findings.filter((item) => item.severity === 'harness').length,
  comparedKeys,
});

export type GateVerdict = {
  readonly passed: boolean;
  readonly reasons: readonly string[];
};

export const evaluateGate = (summary: ParitySummary, config: I18nConfig): GateVerdict => {
  const reasons: string[] = [];
  if (summary.critical > 0) {
    reasons.push(`${String(summary.critical)} critical finding(s)`);
  }
  if (summary.major > config.thresholds.maxMajor) {
    reasons.push(
      `${String(summary.major)} major finding(s), gate allows ${String(config.thresholds.maxMajor)}`,
    );
  }
  if (summary.minor > config.thresholds.maxMinor) {
    reasons.push(
      `${String(summary.minor)} minor finding(s), gate allows ${String(config.thresholds.maxMinor)}`,
    );
  }
  return { passed: reasons.length === 0, reasons };
};
