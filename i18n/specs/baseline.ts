import { readFileSync } from 'node:fs';

import type { CatalogFile } from '../../collectors/fixture-translations.js';
import { buildSentinels, fragmentsOf } from '../lib/sentinels.js';
import type { LocaleStrings, Sentinel } from '../lib/sentinels.js';

/**
 * The English baseline, as the render layer consumes it.
 *
 * Both render-layer content checks need two things per key: what English
 * says, and what this locale is contracted to say instead. That is exactly
 * the data the content layer already pulled, so the render layer reads it
 * rather than re-deriving it — and rather than hardcoding a list of English
 * words, which would go stale the first time marketing changed a nav label.
 *
 * Points at the generated fixture catalogue by default; in CI against a real
 * store, point KITSCH_BASELINE at the artifact the content-layer run wrote.
 *
 * The comparison logic itself lives in i18n/lib/sentinels.ts, where it is
 * unit-tested. This file is only the loader — and the loader's one real job,
 * beyond reading the file, is refusing to hand back an empty locale.
 */

const baselinePath = process.env.KITSCH_BASELINE ?? 'fixtures/catalog/catalog-clean.json';

const catalog = JSON.parse(readFileSync(baselinePath, 'utf8')) as CatalogFile;

export type { Sentinel } from '../lib/sentinels.js';
export { showsEnglish } from '../lib/sentinels.js';

/**
 * Strings for a locale, or a loud failure.
 *
 * The `?? {}` this replaces was the most dangerous line in the render layer.
 * A locale missing from the baseline — a typo in KITSCH_BASELINE, or an
 * eighth language added to config/i18n.yaml before the baseline artifact
 * caught up — produced an empty map, which produced zero sentinels and zero
 * expected fragments, which made every content assertion in the suite pass
 * without examining anything. Green, fast, and meaningless.
 */
const localeStrings = (locale: string): LocaleStrings => {
  const strings = catalog.locales[locale];
  if (strings === undefined) {
    throw new Error(
      `Baseline "${baselinePath}" has no entry for locale "${locale}". ` +
        'Refusing to continue: an empty baseline silently turns every ' +
        'translation assertion into a no-op. Regenerate the baseline (npx tsx ' +
        'fixtures/catalog/build-catalog.ts) or point KITSCH_BASELINE at one ' +
        'that covers every locale in config/i18n.yaml.',
    );
  }
  return strings;
};

/** English strings that must NOT appear on a page rendered in `locale`. */
export const englishSentinels = (locale: string): readonly Sentinel[] =>
  buildSentinels(localeStrings('en'), localeStrings(locale));

/** Literal fragments of a contracted string that must appear on the page. */
export const renderedFragments = (locale: string, key: string): readonly string[] =>
  fragmentsOf(localeStrings(locale)[key]);
