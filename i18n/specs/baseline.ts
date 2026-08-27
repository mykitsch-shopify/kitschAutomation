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
 * Points at the generated fixture catalogue by default. KITSCH_BASELINE
 * overrides it with a catalogue in the same shape — `keys` and `locales`.
 *
 * Note what that does NOT include: `npm run i18n:parity` writes parity.json,
 * which is findings and a verdict, not a catalogue. There is no supported way
 * to emit a live-store catalogue today, so against a real storefront the
 * content-comparison specs have no baseline to read and cannot say anything.
 * Tracked with the rest of the live-store gap; until then, pointing this at a
 * report file fails here rather than quietly comparing against nothing.
 *
 * The comparison logic itself lives in i18n/lib/sentinels.ts, where it is
 * unit-tested. This file is only the loader — and the loader's one real job,
 * beyond reading the file, is refusing to hand back an empty locale.
 */

const baselinePath = process.env.KITSCH_BASELINE ?? 'fixtures/catalog/catalog-clean.json';

/**
 * Read at module load, so a failure here aborts collection and Playwright
 * reports "No tests found" — which describes nothing that happened. Whatever
 * went wrong has to explain itself here, because nothing downstream will.
 */
const readBaseline = (path: string): CatalogFile => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
  } catch (cause) {
    const fromEnv = process.env.KITSCH_BASELINE !== undefined;
    throw new Error(
      `Cannot read the translation baseline "${path}".\n` +
        (fromEnv
          ? 'It came from KITSCH_BASELINE. That variable outlives the command that set ' +
            'it, so a stale value from an earlier session will break every run in this ' +
            'shell — clear it (Windows: `set KITSCH_BASELINE=`, POSIX: `unset ' +
            'KITSCH_BASELINE`) to fall back to fixtures/catalog/catalog-clean.json.\n' +
            'It must name a catalogue with "keys" and "locales" maps. A parity report ' +
            '(i18n-report/**/parity.json) is not one: it holds findings, not copy.\n'
          : 'Regenerate it with `npx tsx fixtures/catalog/build-catalog.ts`.\n') +
        'Refusing to continue: without a baseline every translation assertion has ' +
        'nothing to compare against.',
      { cause },
    );
  }
};

const catalog = readBaseline(baselinePath);

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
