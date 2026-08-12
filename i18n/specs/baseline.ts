import { readFileSync } from 'node:fs';

import type { CatalogFile } from '../../collectors/fixture-translations.js';

/**
 * The English baseline, as the render layer consumes it.
 *
 * The "no untranslated strings visible" check needs to know two things for
 * every key: what English says, and what this locale is contracted to say
 * instead. That is exactly the data the content layer already pulled, so the
 * render layer reads it rather than re-deriving it — and rather than
 * hardcoding a list of English words, which would go stale the first time
 * marketing changed a nav label.
 *
 * Points at the generated fixture catalogue by default; in CI against a real
 * store, point KITSCH_BASELINE at the artifact the content-layer run wrote.
 */

const baselinePath = process.env.KITSCH_BASELINE ?? 'fixtures/catalog/catalog-clean.json';

const catalog = JSON.parse(readFileSync(baselinePath, 'utf8')) as CatalogFile;

export type Sentinel = {
  readonly key: string;
  readonly english: string;
  readonly expected: string;
};

/**
 * English strings that must NOT appear on a page in `locale`.
 *
 * Deliberately excludes keys whose contracted translation *is* the English
 * string — "Collections" is "Collections" in French, and reporting that as an
 * untranslated fallback would train the team to ignore the check.
 */
export const englishSentinels = (locale: string): readonly Sentinel[] => {
  const english = catalog.locales.en ?? {};
  const target = catalog.locales[locale] ?? {};

  const sentinels: Sentinel[] = [];
  for (const [key, source] of Object.entries(english)) {
    const expected = target[key];
    if (source === null || expected === null || expected === undefined) {
      continue;
    }
    if (source.trim() === expected.trim()) {
      continue;
    }
    // Very short strings collide with unrelated copy; the content layer
    // checks them exhaustively anyway.
    if (source.trim().length < 4) {
      continue;
    }
    sentinels.push({ key, english: source.trim(), expected: expected.trim() });
  }
  return sentinels;
};

/** The contracted translation for a key, used for meta-tag assertions. */
export const expectedValue = (locale: string, key: string): string | undefined =>
  catalog.locales[locale]?.[key] ?? undefined;

/**
 * The literal fragments of a contracted string that must appear on the page.
 *
 * Interpolated strings cannot be matched whole — "{{ count }} avis" never
 * appears verbatim once the count is bound — so the placeholder is removed
 * and the surrounding literals are matched instead. Fragments under four
 * characters are dropped: they collide with unrelated copy and prove nothing.
 */
export const renderedFragments = (locale: string, key: string): readonly string[] => {
  const value = expectedValue(locale, key);
  if (value === null || value === undefined || value.trim() === '') {
    return [];
  }
  return value
    .split(/\{\{[^}]*\}\}|\{[^}]*\}|%\{[^}]*\}|%[sd]/u)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 4);
};

const ASCII_ONLY = /^[\p{ASCII}]+$/u;

/**
 * Whether `haystack` shows `sentinel` as a standalone string. ASCII sentinels
 * are matched on word boundaries so "New" does not match inside
 * "Newsletter"; non-ASCII scripts have no word boundaries to speak of, so
 * those fall back to substring containment.
 */
export const showsEnglish = (haystack: string, sentinel: string): boolean => {
  if (!ASCII_ONLY.test(sentinel)) {
    return haystack.includes(sentinel);
  }
  const escaped = sentinel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'u').test(haystack);
};
