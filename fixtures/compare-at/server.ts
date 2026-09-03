import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { readImportCsv, readRollbackCsv, toCents } from '../../web/lib/compare-at.js';
import { SEEDED, type SeededDefect } from './seeded.js';

/**
 * Storefront fixture for the compare-at audit.
 *
 * Serves a product page per handle from the real sheets, so the audit can be
 * exercised end to end with no network. Two profiles:
 *
 *   clean   — the removal applied correctly. No compare-at anywhere.
 *   seeded  — the removal half-failed. Every defect below is planted on
 *             purpose, and verify-compare-at.ts asserts each one is caught.
 *
 * The seeded profile is the point of this file. A check that has never been
 * watched to fail is not evidence of anything, and "no strikethrough found"
 * is exactly what a broken check also reports.
 */

const PORT = Number(process.env.KITSCH_COMPARE_AT_PORT ?? '4185');
const PROFILE = process.env.KITSCH_COMPARE_AT_PROFILE ?? 'clean';

const imports = readImportCsv(readFileSync('data/compare-at/removal-import.csv', 'utf8'));
const rollbacks = readRollbackCsv(readFileSync('data/compare-at/rollback-values.csv', 'utf8'));
const rollbackByHandle = new Map(rollbacks.map((row) => [row.handle, row]));

const seededFor = (handle: string): SeededDefect | undefined =>
  PROFILE === 'seeded' ? SEEDED.find((entry) => entry.handle === handle) : undefined;

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const page = (handle: string): string | undefined => {
  const row = imports.find((entry) => entry.handle === handle);
  if (row === undefined) return undefined;

  const rollback = rollbackByHandle.get(handle);
  // Drafts are not on a real storefront, so the fixture 404s them too —
  // otherwise the audit's draft handling would never be exercised.
  if (rollback?.status === 'DRAFT') return undefined;

  const priceCents = toCents(row.price);
  if (priceCents === undefined) return undefined;

  const defect = seededFor(handle);
  const shownPrice = defect?.kind === 'price_mismatch' ? priceCents + 200 : priceCents;
  const oldCents = rollback === undefined ? undefined : toCents(rollback.liveCompareAt);
  const compareAt = defect?.kind === 'compare_at_still_rendered' ? (oldCents ?? priceCents) : undefined;

  const priceMarkup =
    defect?.kind === 'price_not_observed'
      ? '<div class="price-item--sale"></div>'
      : `<div data-testid="pdp-price" class="price-item--sale">${money(shownPrice)}</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${handle}</title></head>
<body>
  <h1 data-testid="pdp-title" class="product__title">${handle}</h1>
  ${priceMarkup}
  ${
    compareAt === undefined
      ? '<!-- no compare-at: removal applied -->'
      : `<s data-testid="pdp-compare-at" class="price-item--regular">${money(compareAt)}</s>`
  }
</body></html>`;
};

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0] ?? '/';
  const match = /^\/products\/([^/]+)$/u.exec(path);

  if (path === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<h1>compare-at fixture (${PROFILE})</h1>`);
    return;
  }
  if (match === null) {
    response.writeHead(404).end('not found');
    return;
  }

  const body = page(decodeURIComponent(match[1] ?? ''));
  if (body === undefined) {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>404</h1>');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `compare-at fixture (${PROFILE}) on http://127.0.0.1:${String(PORT)}\n` +
      (PROFILE === 'seeded' ? `  ${String(SEEDED.length)} planted defects\n` : ''),
  );
});
