import { readFileSync } from 'node:fs';

import type { EntryStatus, TranslationEntry } from '../i18n/lib/locale-parity.js';

/**
 * Offline translation collector, backed by a JSON catalogue.
 *
 * Two jobs, both real:
 *
 *   1. It is what the suite runs against in CI-without-credentials, in the
 *      Phase 2 shadow week, and in this sample run — the engine gets
 *      exercised end to end without an Admin token or a live store.
 *   2. It is the negative control. A catalogue with known planted defects
 *      proves the comparators actually fire; a gate that has never been
 *      watched to fail is not a gate.
 *
 * The file format mirrors what the Shopify collector produces, so swapping
 * one for the other changes nothing downstream.
 */

export type CatalogFile = {
  readonly keys: Readonly<Record<string, { readonly resourceType: string; readonly resourceId: string }>>;
  readonly locales: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
  /** Keys the collector should report as unreachable, per locale. */
  readonly fetchFailed?: Readonly<Record<string, readonly string[]>>;
  /**
   * Which storefront this catalogue's copy was captured from.
   *
   * `'fixture'` for anything this repo generates; a storefront origin
   * (`'https://www.mykitsch.com'`) for a catalogue pulled from a real store.
   * Absent means fixture — the only catalogues that exist today.
   *
   * It matters because a catalogue is not just a list of locales, it is a list
   * of *this store's strings*. Comparing mykitsch.com against the fixture's
   * copy reported "footer is missing its en copy" on 30 specs: the live footer
   * does not say "Join the list" because that sentence was invented for the
   * fixture. The English row is the tell — English cannot be missing its own
   * translation — and the render layer now refuses the comparison rather than
   * reporting a baseline mismatch as a defect. See i18n/specs/baseline.ts.
   */
  readonly describes?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseCatalog = (path: string): CatalogFile => {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || !isRecord(raw.keys) || !isRecord(raw.locales)) {
    throw new Error(`${path}: expected an object with "keys" and "locales" maps`);
  }
  return raw as unknown as CatalogFile;
};

export const createFixtureTranslationCollector = (
  catalogPath: string,
): {
  readonly fetchCatalog: (
    locale: string,
    resourceTypes: readonly string[],
  ) => Promise<readonly TranslationEntry[]>;
} => {
  const catalog = parseCatalog(catalogPath);

  return {
    fetchCatalog: async (
      locale: string,
      resourceTypes: readonly string[],
    ): Promise<readonly TranslationEntry[]> => {
      const allowed = new Set(resourceTypes);
      const values = catalog.locales[locale] ?? {};
      const failed = new Set(catalog.fetchFailed?.[locale] ?? []);

      const entries: TranslationEntry[] = [];
      for (const [key, meta] of Object.entries(catalog.keys)) {
        if (!allowed.has(meta.resourceType)) {
          continue;
        }

        const raw = values[key];
        let status: EntryStatus;
        if (failed.has(key)) {
          status = 'fetch_failed';
        } else if (raw === undefined || raw === null) {
          status = 'absent';
        } else {
          status = 'present';
        }

        entries.push({
          key,
          locale,
          resourceType: meta.resourceType,
          resourceId: meta.resourceId,
          status,
          value: status === 'present' ? (raw ?? undefined) : undefined,
        });
      }

      return await Promise.resolve(entries);
    },
  };
};
