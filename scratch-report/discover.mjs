// Local scratch aid, not part of the suite. Delete when you are done.
//
// Loads a PDP and reports two things preflight cannot:
//   1. how many elements each selector in config/kits.yaml actually matches,
//      so you can see over-matching as well as no match at all;
//   2. what the theme really uses for the roles that matched nothing, as a
//      selector you can paste.
//
//   node scratch-report/discover.mjs https://www.mykitsch.com/products/<handle>

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const url = process.argv[2];
if (url === undefined) {
  process.stderr.write('usage: node scratch-report/discover.mjs <product-url>\n');
  process.exit(2);
}

// Read the selectors straight out of the config so this cannot drift from it.
// Only the ones under `selectors:` — other blocks have two-space quoted keys
// too, and `note: 'Live kit, SKU 2.'` is not a CSS selector.
const selectors = {};
let inSelectors = false;
for (const line of readFileSync('config/kits.yaml', 'utf8').split('\n')) {
  if (/^[a-z_]+:/u.test(line)) inSelectors = line.startsWith('selectors:');
  if (!inSelectors) continue;
  const match = /^\s{2}([a-z_]+):\s*'(.+)'\s*$/u.exec(line);
  if (match !== null) selectors[match[1]] = match[2];
}

const browser = await chromium.launch(
  process.env.KITSCH_CHROMIUM_PATH ? { executablePath: process.env.KITSCH_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

const out = (line) => process.stdout.write(`${line}\n`);

out('');
out(`${url}`);
out(`  HTTP ${String(response?.status() ?? 'no response')}`);
out('');
out('Current config/kits.yaml selectors');
out('');

// These live on the cart and checkout pages. Zero here is correct, not a
// finding — run this against /cart to exercise them.
const ELSEWHERE = new Set([
  'cart_line',
  'cart_line_price',
  'cart_line_remove',
  'cart_subtotal',
  'checkout_button',
  'summary_line',
  'summary_price',
]);

for (const [role, selector] of Object.entries(selectors)) {
  const count = await page.locator(selector).count();
  const note =
    ELSEWHERE.has(role) && count === 0
      ? '  (cart/checkout role — expected on a PDP)'
      : count === 0
        ? '  ← matches nothing'
        : count > 3
          ? '  ← suspiciously many'
          : '';
  out(`  ${role.padEnd(20)} ${String(count).padStart(3)}${note}`);
}

// What the theme actually uses. Found semantically — by role, not by class —
// then rendered back as a selector you can paste.
const found = await page.evaluate(() => {
  const describe = (el) => {
    if (el === null) return null;
    const testid = el.getAttribute('data-testid');
    const classes = Array.from(el.classList);
    const suggested =
      testid !== null
        ? `[data-testid="${testid}"]`
        : el.id !== ''
          ? `#${el.id}`
          : classes.length > 0
            ? `${el.tagName.toLowerCase()}.${classes[0]}`
            : el.tagName.toLowerCase();
    const ancestors = [];
    for (let node = el.parentElement; node !== null && ancestors.length < 4; node = node.parentElement) {
      const id = node.id !== '' ? `#${node.id}` : '';
      const cls = node.classList.length > 0 ? `.${node.classList[0]}` : '';
      ancestors.push(`${node.tagName.toLowerCase()}${id}${cls}`);
    }
    return {
      suggested,
      classes: classes.join(' '),
      text: (el.textContent ?? '').trim().slice(0, 60),
      ancestors,
    };
  };

  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const money = /(?:[$£€]\s?\d|\d+[.,]\d{2})/u;

  return {
    title: describe(document.querySelector('h1')),
    addToCart: [
      ...all('form[action*="/cart/add"] button[type="submit"]'),
      ...all('button[name="add"]'),
      ...all('[data-testid*="add"]'),
    ]
      .slice(0, 3)
      .map(describe),
    // Prices inside the product form only — a PDP prints many prices, and the
    // ones in a recommendations carousel are not this product's.
    prices: all('form[action*="/cart/add"] *, [class*="product__info"] *, [class*="price"]')
      .filter((el) => el.children.length === 0 && money.test(el.textContent ?? ''))
      .slice(0, 8)
      .map(describe),
    struck: [...all('s'), ...all('del'), ...all('[class*="compare"]')].slice(0, 6).map(describe),
  };
});

out('');
out('What this theme actually uses');
out('');
out(`  pdp_title      ${found.title?.suggested ?? 'no <h1> found'}`);
out(`                 text: ${found.title?.text ?? ''}`);
out(`                 inside: ${(found.title?.ancestors ?? []).join(' < ')}`);
out('');
out('  add_to_cart candidates');
for (const item of found.addToCart) out(`    ${item?.suggested ?? ''}   "${item?.text ?? ''}"`);
out('');
out('  price-bearing leaves near the product form');
for (const item of found.prices) out(`    ${item?.suggested ?? ''}   "${item?.text ?? ''}"`);
out('');
out('  struck-through / compare-at candidates');
for (const item of found.struck) out(`    ${item?.suggested ?? ''}   "${item?.text ?? ''}"`);
out('');

await browser.close();
