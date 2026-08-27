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
const response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });

// This theme renders the buy button after load — A/B and anti-flicker scripts
// hold it back. Looking at domcontentloaded reported "no add-to-cart" on every
// PDP while the button was simply not there yet. Never `networkidle`: the store
// beacons continuously and it would only ever time out.
const settled = await page
  .waitForSelector('button[name="add"], .product-form__submit, [data-testid="add-to-cart"]', {
    timeout: 15000,
    state: 'attached',
  })
  .then(() => true)
  .catch(() => false);

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

  // Everything is searched inside the product's own section. Searching the
  // document reported the same four prices on four different products and on
  // the cart — they were an upsell widget that sits early in the DOM on every
  // page. A price that is not this product's is worse than no price at all.
  const h1 = document.querySelector('h1');
  const scope =
    h1?.closest('.main-product, [class*="product__info-wrapper"], main') ?? document.body;

  const all = (selector) => Array.from(scope.querySelectorAll(selector));
  const money = /(?:[$£€]\s?\d|\d+[.,]\d{2})/u;

  return {
    scope: `${scope.tagName.toLowerCase()}${scope.classList.length > 0 ? `.${scope.classList[0]}` : ''}`,
    title: describe(h1),
    addToCart: [
      ...all('form[action*="/cart/add"] button[type="submit"]'),
      ...all('button[name="add"]'),
      ...all('[data-testid*="add"]'),
      ...all('.product-form__submit'),
    ]
      .filter((el, index, list) => list.indexOf(el) === index)
      .slice(0, 3)
      .map(describe),
    prices: all('*')
      .filter((el) => el.children.length === 0 && money.test(el.textContent ?? ''))
      .slice(0, 8)
      .map(describe),
    struck: [...all('s'), ...all('del'), ...all('[class*="compare"]')].slice(0, 6).map(describe),
  };
});

out('');
out('What this theme actually uses');
out('');
out(`  searched inside: ${found.scope}${settled ? '' : '   (buy button never appeared — see below)'}`);
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
