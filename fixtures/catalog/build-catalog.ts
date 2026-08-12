import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { CatalogFile } from '../../collectors/fixture-translations.js';
import { CONTENT, KEYS, LOCALES } from './content.js';
import type { Locale, LocaleContent } from './content.js';
import { FETCH_FAILED, SEEDED_DEFECTS } from './defects.js';

/**
 * Emits the two JSON catalogues the content-layer run reads:
 *
 *   fixtures/catalog/catalog-clean.json     — no defects; the run must pass
 *   fixtures/catalog/catalog-seeded.json    — every defect in defects.ts
 *
 * Generated rather than hand-maintained so the clean and seeded catalogues
 * cannot drift apart, which would make a detection failure look like a
 * fixture bug.
 *
 *   tsx fixtures/catalog/build-catalog.ts
 */

export type Profile = 'clean' | 'seeded';

export const buildCatalog = (profile: Profile): CatalogFile => {
  const keys: Record<string, { resourceType: string; resourceId: string }> = {};
  for (const entry of KEYS) {
    keys[entry.key] = { resourceType: entry.resourceType, resourceId: entry.resourceId };
  }

  const locales: Record<string, Record<string, string | null>> = {};
  for (const locale of LOCALES) {
    const content: LocaleContent = CONTENT[locale];
    const values: Record<string, string | null> = {};
    for (const entry of KEYS) {
      values[entry.key] = content[entry.key] ?? null;
    }
    locales[locale] = values;
  }

  const fetchFailed: Record<string, string[]> = {};

  if (profile === 'seeded') {
    for (const defect of SEEDED_DEFECTS) {
      const target: Record<string, string | null> | undefined = locales[defect.locale];
      if (target === undefined) {
        throw new Error(`defects.ts seeds locale "${defect.locale}", which is not in LOCALES`);
      }
      if (!(defect.key in target)) {
        throw new Error(`defects.ts seeds key "${defect.key}", which is not in KEYS`);
      }
      if (defect.value === FETCH_FAILED) {
        (fetchFailed[defect.locale] ??= []).push(defect.key);
        continue;
      }
      target[defect.key] = defect.value;
    }
  }

  return { keys, locales, fetchFailed };
};

const writeCatalog = (profile: Profile, path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(buildCatalog(profile), null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${path}\n`);
};

const isEntrypoint = process.argv[1]?.endsWith('build-catalog.ts') ?? false;
if (isEntrypoint) {
  writeCatalog('clean', 'fixtures/catalog/catalog-clean.json');
  writeCatalog('seeded', 'fixtures/catalog/catalog-seeded.json');
}

export const localeOf = (value: string): Locale | undefined =>
  LOCALES.find((locale) => locale === value);
