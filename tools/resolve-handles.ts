import { readFileSync, writeFileSync } from 'node:fs';

import { loadTopProductsConfig, titleOverlap } from '../web/lib/top-products.js';

/**
 * Resolves the top-10 list's product titles to storefront handles.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run resolve:handles
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run resolve:handles -- --write
 *
 * Why this exists: the list arrives as marketing titles and the check needs URL
 * slugs. Deriving one from the other by string similarity does not work here —
 * "Rice Water Conditioner Bar for Hair Growth" scores *higher* against "Rice
 * Water Shampoo Bar for Hair Growth" than the correct page does, because these
 * titles share their boilerplate and differ by one word. A wrong handle does
 * not fail; it checks a different product and reports it healthy.
 *
 * So this tool asks the storefront rather than guessing, prints what it found
 * with the confidence for each, and writes nothing unless given --write. Even
 * then it records the storefront's own title as `canonical_title`, which is
 * what the daily check compares against exactly.
 */

const baseURL = (process.env.KITSCH_BASE_URL ?? '').replace(/\/$/u, '');
if (baseURL === '') {
  process.stderr.write(
    'Set KITSCH_BASE_URL to the storefront, e.g.\n' +
      '  KITSCH_BASE_URL=https://www.mykitsch.com npm run resolve:handles\n',
  );
  process.exit(2);
}

const configPath = 'config/top-products.yaml';
const shouldWrite = process.argv.includes('--write');
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

type Suggestion = { readonly title: string; readonly handle: string };

/**
 * Shopify's public search suggestion endpoint. No credentials, read-only, and
 * the same data the site's own search box uses.
 */
const search = async (query: string): Promise<readonly Suggestion[]> => {
  const url =
    `${baseURL}/search/suggest.json?q=${encodeURIComponent(query)}` +
    '&resources[type]=product&resources[limit]=10';
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} from ${url}`);
  const body: unknown = await response.json();

  const products = (body as { resources?: { results?: { products?: unknown } } }).resources?.results
    ?.products;
  if (!Array.isArray(products)) return [];
  return products.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { title, handle } = entry as { title?: unknown; handle?: unknown };
    if (typeof title !== 'string' || typeof handle !== 'string') return [];
    return [{ title, handle }];
  });
};

const config = loadTopProductsConfig(configPath);

write('');
write(`Resolving ${String(config.products.length)} titles against ${baseURL}`);
write('');

type Resolution = {
  readonly title: string;
  readonly handle: string | undefined;
  readonly canonicalTitle: string | undefined;
  readonly confidence: number;
  readonly alternatives: readonly Suggestion[];
};

const resolutions: Resolution[] = [];
let failed = 0;

for (const product of config.products) {
  let suggestions: readonly Suggestion[];
  try {
    suggestions = await search(product.title);
  } catch (error) {
    failed += 1;
    write(`  ERROR   ${product.title}`);
    write(`            ${(error as Error).message}`);
    resolutions.push({
      title: product.title,
      handle: product.handle,
      canonicalTitle: product.canonicalTitle,
      confidence: 0,
      alternatives: [],
    });
    continue;
  }

  const ranked = [...suggestions]
    .map((entry) => ({ entry, score: titleOverlap(product.title, entry.title) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];

  if (best === undefined) {
    write(`  NONE    ${product.title}`);
    write('            storefront search returned no products for this title');
    resolutions.push({
      title: product.title,
      handle: product.handle,
      canonicalTitle: product.canonicalTitle,
      confidence: 0,
      alternatives: [],
    });
    continue;
  }

  // Exact normalized equality is the only confident case. Everything else is
  // shown with its runners-up for a person to choose, because near-misses here
  // are neighbouring products, not typos.
  const confident = best.score === 1 && ranked.filter((r) => r.score === 1).length === 1;
  write(`  ${confident ? 'OK     ' : 'CHECK  '} ${product.title}`);
  write(`            -> ${best.entry.handle}  "${best.entry.title}"  (${best.score.toFixed(2)})`);
  for (const alt of ranked.slice(1, 4)) {
    write(`               alt: ${alt.entry.handle}  "${alt.entry.title}"  (${alt.score.toFixed(2)})`);
  }

  resolutions.push({
    title: product.title,
    handle: confident ? best.entry.handle : product.handle,
    canonicalTitle: confident ? best.entry.title : product.canonicalTitle,
    confidence: best.score,
    alternatives: ranked.slice(0, 4).map((r) => r.entry),
  });
}

const confidentCount = resolutions.filter(
  (r) => r.confidence === 1 && r.handle !== undefined,
).length;

write('');
write(
  `  ${String(confidentCount)} resolved confidently, ` +
    `${String(resolutions.length - confidentCount)} need a human, ` +
    `${String(failed)} errored`,
);

if (!shouldWrite) {
  write('');
  write('  Nothing written. Re-run with --write to record the confident ones:');
  write('    npm run resolve:handles -- --write');
  write('');
  write('  The rest are ambiguous by nature — a near-miss here is a neighbouring');
  write('  product, not a typo — so pick those by hand in config/top-products.yaml');
  write('  and paste the storefront\'s exact title into canonical_title.');
  process.exit(0);
}

// Written as a patch against the YAML text rather than by re-serialising it:
// the file carries explanatory comments that a dump-and-rewrite would discard.
let text = readFileSync(configPath, 'utf8');
let written = 0;
for (const resolution of resolutions) {
  if (resolution.confidence !== 1 || resolution.handle === undefined) continue;
  const escaped = resolution.title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const pattern = new RegExp(
    `(  - title: ${escaped}\\n)(    handle:.*\\n)`,
    'u',
  );
  if (!pattern.test(text)) continue;
  text = text.replace(
    pattern,
    `$1    handle: ${resolution.handle}\n` +
      `    canonical_title: ${resolution.canonicalTitle ?? resolution.title}\n`,
  );
  written += 1;
}
writeFileSync(configPath, text, 'utf8');
write('');
write(`  wrote ${String(written)} handle(s) to ${configPath}`);
write('  Review the diff before committing.');
