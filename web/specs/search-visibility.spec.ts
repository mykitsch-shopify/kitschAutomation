import { expect, test } from '@playwright/test';

import { sla } from '@kitsch/config';
import { awaitConsistency } from '@kitsch/core/consistency.js';
import { searchIndex } from '@kitsch/collectors/constructor.js';
import { launchSet } from '@kitsch/fixtures/launch-set.js';

/**
 * What this catches that an API check cannot: a SKU that is present in the
 * Constructor index but does not actually render in the storefront's results
 * grid — a template, pagination or client-filter defect invisible to the
 * reconciliation engine.
 *
 * What it does not claim: that the index contains the SKU (API), or that the
 * price agrees across nodes (diff engine). Those are asserted elsewhere and
 * re-asserting them here would buy flakiness for no coverage.
 *
 * Phase 1 reference spec. It needs a real store with a real search index, so
 * it skips against the local storefront fixture rather than being quietly
 * rewritten into something that passes without proving anything.
 */

// An unset KITSCH_BASE_URL means the local fixture — playwright.config
// defaults to it rather than to a real store.
const baseURL = process.env.KITSCH_BASE_URL;
const isFixture = baseURL === undefined || baseURL.includes('127.0.0.1');

test.describe('search visibility @smoke', () => {
  test.skip(
    isFixture || process.env.CONSTRUCTOR_API_URL === undefined,
    'needs a Shopify store and a Constructor index — see open question §12.4',
  );

  test('launch SKU renders in search results on mobile', async ({ page }) => {
    const sku = launchSet.primary;

    // Gate on the index first, with the declared SLA. If this times out it is
    // a reportable propagation breach, not a UI failure — and the error
    // carries the elapsed time and the SLA so triage does not start from zero.
    await awaitConsistency({
      check: async () => await searchIndex.contains(sku.id),
      timeout: sla.constructor.catalogPropagation,
      label: `constructor index contains ${sku.id}`,
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill(sku.searchTerm);
    await page.getByRole('searchbox', { name: 'Search' }).press('Enter');

    const results = page.getByTestId('search-result-card');
    await expect(results.first()).toBeVisible();
    await expect(results.filter({ hasText: sku.title })).toHaveCount(1);
  });
});
