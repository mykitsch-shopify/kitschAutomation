// Local scratch aid, not part of the suite. Delete when you are done.
//
// Loads a PDP and reports two things preflight cannot:
//   1. how many elements each selector in config/kits.yaml actually matches,
//      so you can see over-matching as well as no match at all;
//   2. what the theme really uses for the roles that matched nothing, as a
//      selector you can paste.
//
//   node scratch-report/discover.mjs https://www.mykitsch.com/products/<handle>
//   node scratch-report/discover.mjs --add https://www.mykitsch.com/products/<handle>
//   node scratch-report/discover.mjs https://www.mykitsch.com/cart
//
// `--add` loads the PDP, clicks add-to-cart, and then probes the cart. Use it:
// the cart roles are the load-bearing ones now — every dimension the parity
// spec compares is read from the cart and the order summary — and a bare /cart
// URL almost always finds an empty cart.
//
// An empty cart is the trap this script exists to avoid walking into. Probed
// directly, it answered with twelve "repeated blocks" that were the nav, the
// footer and the payment-icon strip, and reported "no remove control found"
// and "no subtotal found" as though those were facts about the theme. They
// were facts about an empty page. It now detects that and says so instead.

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const addFirst = args.includes('--add');
const url = args.find((value) => !value.startsWith('--'));
if (url === undefined) {
  process.stderr.write(
    'usage: node scratch-report/discover.mjs [--add] <product-url | cart-url>\n',
  );
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

const isCartUrl = (value) => /\/cart(\/|\?|$)/u.test(new URL(value).pathname);
let onCart = isCartUrl(url);

const browser = await chromium.launch(
  process.env.KITSCH_CHROMIUM_PATH ? { executablePath: process.env.KITSCH_CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });

// This theme renders the buy button after load — A/B and anti-flicker scripts
// hold it back. Looking at domcontentloaded reported "no add-to-cart" on every
// PDP while the button was simply not there yet. Never `networkidle`: the store
// beacons continuously and it would only ever time out.
const buyButton = 'button[name="add"], .product-form__submit, [data-testid="add-to-cart"], .bundle-buy-button';
const settled = onCart
  ? true
  : await page
      .waitForSelector(buyButton, { timeout: 15000, state: 'attached' })
      .then(() => true)
      .catch(() => false);

// ── --add: put something in the cart, then look at the cart ───────────────
//
// Reported rather than assumed at every step. "Clicked add-to-cart and the
// cart is empty" and "never managed to click anything" are different findings
// about the theme, and the second one is the more interesting.
let addNote = '';
if (addFirst && !onCart) {
  const clicked = await page
    .locator(buyButton)
    .first()
    .click({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!clicked) {
    addNote = 'the buy button never became clickable — nothing was added';
  } else {
    // Most themes open a drawer and stay on the PDP; some navigate. Wait for a
    // navigation, then go to the cart if none came.
    await page
      .waitForURL((next) => isCartUrl(next), { timeout: 5000 })
      .catch(() => undefined);
    // Only navigate if the click did not. Going to a bare /cart regardless
    // would throw away whatever query the theme put on the URL — the fixture
    // carries the kit in `?kit=`, and dropping it served a generic cart.
    if (isCartUrl(page.url())) {
      addNote = 'the click navigated to the cart';
    } else {
      addNote = 'the click opened a drawer rather than navigating; went to /cart';
      response = await page.goto(new URL('/cart', url).href, {
        waitUntil: 'load',
        timeout: 60000,
      });
    }
  }
  onCart = isCartUrl(page.url());
}

const out = (line) => process.stdout.write(`${line}\n`);

out('');
out(`${url}`);
out(`  HTTP ${String(response?.status() ?? 'no response')}`);
out('');
out('Current config/kits.yaml selectors');
out('');

// Roles that only exist on the cart and checkout pages, and roles that only
// exist on a PDP. Zero on the wrong page is correct, not a finding.
const CART_ROLES = new Set([
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
  const belongsHere = CART_ROLES.has(role) === onCart;
  const note = !belongsHere
    ? `  (${CART_ROLES.has(role) ? 'cart/checkout' : 'PDP'} role — not expected on this page)`
    : count === 0
      ? '  ← matches nothing'
      : count > 3
        ? '  ← suspiciously many'
        : '';
  out(`  ${role.padEnd(20)} ${String(count).padStart(3)}${note}`);
}

// ── cart page ─────────────────────────────────────────────────────────────
//
// A separate probe rather than a branch inside the PDP one, because nothing
// carries over: there is no `.main-product` to scope to, "the price" is per
// line rather than per page, and the interesting structure is the repeated
// line itself.
//
// Written flat, with no nested named functions. tsx/esbuild runs with
// `keepNames`, which wraps a nested named function in `__name(...)` — and
// `__name` does not exist inside `page.evaluate`, where the code is
// stringified and run in the browser. That produced `__name is not defined`
// at runtime in the health-check audit and cost a whole control run.
if (onCart) {
  const cart = await page.evaluate(() => {
    const suggest = (el) => {
      const testid = el.getAttribute('data-testid');
      if (testid !== null) return `[data-testid="${testid}"]`;
      if (el.id !== '') return `#${el.id}`;
      const first = el.classList[0];
      return first === undefined ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()}.${first}`;
    };
    const money = /(?:[$£€]\s?\d|\d+[.,]\d{2})/u;

    // Scoped to the cart region, for the same reason the PDP probe scopes to
    // `.main-product`. Unscoped, this reported the nav, the footer, the
    // announcement bar and the payment-icon strip as candidates for
    // `cart_line`, and the free-shipping banner's "$35.00" as a line price.
    let region = document.body;
    for (const candidate of [
      'form[action*="/cart"]',
      '[class*="cart-items"]',
      '[class*="cart__items"]',
      '[id*="cart" i][class*="item" i]',
      'main',
    ]) {
      const found = document.querySelector(candidate);
      if (found !== null) {
        region = found;
        break;
      }
    }

    // Never `script`, `style`, `noscript` or `template`. They are leaf nodes
    // full of text, and JSON blobs and CSS both contain things that look like
    // money — the unscoped run offered `#apple-pay-shop-capabilities` and a
    // TriplePixel bootstrap as candidates for `cart_line_price`.
    const DEAD = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE']);
    const all = (selector) =>
      Array.from(region.querySelectorAll(selector)).filter((el) => !DEAD.has(el.tagName));

    // How full the cart is, decided before anything is interpreted. An empty
    // cart makes every answer below meaningless, and it looks identical to a
    // theme whose selectors do not fit.
    const emptyText = /your (cart|bag) is empty|cart is currently empty/iu.test(
      document.body.innerText,
    );

    // Repeated sibling blocks inside the cart region. On a cart page the line
    // item is by far the most likely repeating structure, and the counts make
    // it recognisable: two or three of the same thing, not thirty.
    const groups = new Map();
    for (const element of all('*')) {
      const parent = element.parentElement;
      if (parent === null) continue;
      const testid = element.getAttribute('data-testid');
      const own =
        testid !== null
          ? `[data-testid="${testid}"]`
          : element.classList[0] === undefined
            ? ''
            : `${element.tagName.toLowerCase()}.${element.classList[0]}`;
      if (own === '') continue;
      groups.set(own, (groups.get(own) ?? 0) + 1);
    }

    return {
      empty: emptyText,
      region: `${region.tagName.toLowerCase()}${region.classList[0] === undefined ? '' : `.${region.classList[0]}`}`,
      repeated: Array.from(groups.entries())
        .filter(([, count]) => count >= 2 && count <= 12)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([key, count]) => `${String(count)}x  ${key}`),
      prices: all('*')
        .filter((el) => el.children.length === 0 && money.test(el.textContent ?? ''))
        .slice(0, 12)
        .map((el) => `${suggest(el)}   "${(el.textContent ?? '').trim().slice(0, 40)}"`),
      removes: [
        ...all('a[href*="/cart/change"]'),
        ...all('[href*="quantity=0"]'),
        ...all('button[name="minus"]'),
        ...all('[class*="remove"]'),
        ...all('[aria-label*="emove"]'),
        // The repo's own convention, and the fixture's. Without it this probe
        // reported "no remove control found" against a cart that has one.
        ...all('[data-testid*="remove"]'),
      ]
        .filter((el, index, list) => list.indexOf(el) === index)
        .slice(0, 8)
        .map((el) => `${suggest(el)}   "${(el.textContent ?? '').trim().slice(0, 40)}"`),
      subtotals: [
        ...all('[class*="subtotal"]'),
        ...all('[class*="total"]'),
        ...all('[data-testid*="total"]'),
      ]
        .filter((el, index, list) => list.indexOf(el) === index)
        .filter((el) => el.children.length === 0)
        .slice(0, 8)
        .map((el) => `${suggest(el)}   "${(el.textContent ?? '').trim().slice(0, 40)}"`),
      // Only things a customer can press. `[href*="/checkout"]` unrestricted
      // matched six `<link rel="prefetch">` tags in the document head and
      // printed them as six nameless candidates.
      checkout: [
        ...all('button[name="checkout"]'),
        ...all('a[href*="/checkout"]'),
        ...all('button[class*="checkout"]'),
        ...all('a[class*="checkout"]'),
        ...all('input[type="submit"][name*="checkout"]'),
      ]
        .filter((el, index, list) => list.indexOf(el) === index)
        .slice(0, 6)
        .map((el) => `${suggest(el)}   "${(el.textContent ?? '').trim().slice(0, 40)}"`),
    };
  });

  const section = (title, role, lines, empty) => {
    out('');
    out(`  ${title}  →  ${role}`);
    if (lines.length === 0) out(`    ${empty}`);
    else for (const line of lines) out(`    ${line}`);
  };

  out('');
  if (addNote !== '') out(`  note: ${addNote}`);

  // Say this before anything is interpreted, and stop.
  //
  // An empty cart makes every section below a statement about page furniture.
  // Printed anyway, the first run offered `li.list-payment__item` and
  // `div.announcement__item` as candidates for `cart_line` and reported "no
  // subtotal found" — which reads as a fact about the theme and is a fact
  // about an empty page. Guessing from that output would have mapped the
  // payment-icon strip as the cart line.
  // Not "nothing repeats". A cart holding exactly one line has nothing to
  // repeat, and that heuristic declared the fixture's one-line cart empty —
  // the same confident-wrong-answer failure this section exists to stop, in
  // the code written to stop it. A cart with anything in it always prices it,
  // so the absence of a price is the reliable signal, alongside the theme
  // saying so in words.
  if (cart.empty || cart.prices.length === 0) {
    out('  THE CART IS EMPTY.');
    out('');
    out('  Nothing below would be about the cart, so nothing below is printed.');
    out('  Every "no X found" here would describe an empty page, not this theme.');
    out('');
    out('  Fill it first — the script can do it:');
    out('');
    out('    node scratch-report/discover.mjs --add <product-url>');
    out('');
    out('  which loads the PDP, presses add-to-cart, and then probes the cart.');
    out('');
    await browser.close();
    process.exit(2);
  }

  out(`What this theme actually uses on the cart   (searched inside ${cart.region})`);

  section(
    'repeated blocks',
    'cart_line',
    cart.repeated,
    'nothing repeats — expected if the cart holds exactly one line. Add a' +
      ' second product and re-run to see the line structure.',
  );
  section('price-bearing leaves', 'cart_line_price', cart.prices, 'no prices found');
  section('remove controls', 'cart_line_remove', cart.removes, 'no remove control found');
  section('totals', 'cart_subtotal', cart.subtotals, 'no subtotal found');
  section('checkout', 'checkout_button', cart.checkout, 'no checkout control found');
  out('');
  out('  cart_line must be the LINE, not the price inside it: the spec walks');
  out('  each line and looks for that line\'s own price and remove control, so a');
  out('  cart_line that matches the price element finds neither.');
  out('');

  await browser.close();
  process.exit(0);
}

// ── product page ──────────────────────────────────────────────────────────
//
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
  // Widest product scope first, and tried in order.
  //
  // `closest()` with a comma list returns the NEAREST match, not the first
  // listed — so asking for `.main-product, [class*="product__info-wrapper"]`
  // got the wrapper, which sits inside .main-product and excludes the buy
  // button and the bundle builder. On a BYOB page that made the report look
  // like the product had no options when the search had simply been fenced
  // out of the part of the page holding them.
  const h1 = document.querySelector('h1');
  let scope = document.body;
  for (const candidate of ['.main-product', 'main', '[class*="product__info-wrapper"]']) {
    const found = h1?.closest(candidate) ?? document.querySelector(candidate);
    if (found !== null && found !== undefined) {
      scope = found;
      break;
    }
  }

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
    // Bundle-builder / BYOB slots. Named separately because "0 option(s)" on
    // every BYOB flow is the single largest block of findings in the
    // ad-landing audit, and it is worth knowing whether that is a wrong
    // selector or a genuinely empty builder before anyone acts on it.
    options: [
      ...all('[class*="bundle-builder"]'),
      ...all('[class*="byob"]'),
      ...all('[class*="builder__"]'),
      ...all('[data-bundle]'),
      ...all('fieldset input[type="radio"]'),
      ...all('fieldset input[type="checkbox"]'),
    ]
      .filter((el, index, list) => list.indexOf(el) === index)
      .slice(0, 8)
      .map(describe),
    // Repeated sibling blocks inside the product section.
    //
    // This is how a "what's in the kit" list looks in the DOM whatever it is
    // called: siblings sharing a class signature. Kept as a diagnostic, not as
    // a mapping aid — there is no `kit_item` role any more. This probe is what
    // established there is nothing to map: on mykitsch.com every repeating
    // block inside `.main-product` is the image gallery (32 zoom buttons, 8
    // slides, 8 media wrappers), so the PDP-side dimensions were removed
    // rather than left unobservable. Re-run it if the theme changes and a
    // contents list appears; until then a gallery is all it will show.
    repeated: (() => {
      const groups = new Map();
      for (const element of Array.from(scope.querySelectorAll('*'))) {
        const parent = element.parentElement;
        if (parent === null) continue;
        // Keyed by class OR data-testid. Requiring a class reported "this
        // theme does not list kit contents" against the fixture, whose kit
        // items carry a data-testid and nothing else — a probe blind to the
        // one markup style this repo already uses everywhere.
        const testid = element.getAttribute('data-testid');
        const own =
          testid !== null
            ? `[data-testid="${testid}"]`
            : element.classList.length > 0
              ? `${element.tagName.toLowerCase()}.${element.classList[0] ?? ''}`
              : '';
        if (own === '') continue;
        const parentTestid = parent.getAttribute('data-testid');
        const parentName =
          parentTestid !== null
            ? `[data-testid="${parentTestid}"]`
            : `${parent.tagName.toLowerCase()}${parent.classList.length > 0 ? `.${parent.classList[0] ?? ''}` : ''}`;
        const key = `${parentName}>${own}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      return Array.from(groups.entries())
        .filter(([, count]) => count >= 2)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([key, count]) => `${String(count)}x  ${key.split('>')[1] ?? key}   (inside ${key.split('>')[0] ?? ''})`);
    })(),
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
out('  repeated blocks inside the product section  (diagnostic — no role maps');
out('  to these; on this theme they are the image gallery)');
if (found.repeated.length === 0) {
  out('    none — nothing inside the product section repeats.');
} else {
  for (const line of found.repeated) out(`    ${line}`);
}
out('');
out('  bundle-builder / BYOB option candidates');
if (found.options.length === 0) {
  out('    none — the builder is genuinely absent from the DOM, not merely');
  out('    unmatched by config/ad-landing.yaml. Either it renders only after an');
  out('    interaction, or this page has no builder at all.');
} else {
  for (const item of found.options) out(`    ${item?.suggested ?? ''}   "${item?.text ?? ''}"`);
}
out('');

await browser.close();
