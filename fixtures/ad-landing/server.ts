import { createServer } from 'node:http';

import { SEEDED } from './seeded.js';

/**
 * Storefront fixture for the ad-landing daily QA.
 *
 *   clean   — everything healthy. The audit must report nothing.
 *   seeded  — one planted defect per check in the daily brief.
 *
 * The seeded profile is the point of the file: "no findings" is exactly what a
 * check looking at nothing also reports, so each check has to be watched to
 * fail before its green means anything.
 */

const PORT = Number(process.env.KITSCH_AD_LANDING_PORT ?? '4195');
const PROFILE = process.env.KITSCH_AD_LANDING_PROFILE ?? 'clean';
const seeded = PROFILE === 'seeded';

/** Handles the fixture config lists, plus one page per planted defect. */
const HEALTHY = [
  'cart-carrier',
  'spring-welcome-kit',
  'winter-welcome-kit-combos',
  'thermal-in-stock',
  'thermal-substitute',
];
const BYOB_HEALTHY = ['byob-healthy'];

let cartLines = 0;
let appliedCodes: string[] = [];

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const pdp = (handle: string): string => {
  const price = 3600;
  const compareAt =
    seeded && handle === 'seed-bad-compare-at'
      ? price // equal to price: a strikethrough that is not a reduction
      : handle === 'spring-welcome-kit'
        ? 4500
        : undefined;

  // 15% off is the healthy rate the fixture config expects. The two defect
  // handles only misprice in the seeded profile — otherwise the clean run
  // reports them too and the control can never distinguish the profiles.
  const healthyAutoship = Math.round(price * 0.85);
  const autoship =
    seeded && handle === 'seed-autoship-flat'
      ? price
      : seeded && handle === 'seed-autoship-offrate'
        ? Math.round(price * 0.95)
        : handle === 'winter-welcome-kit-combos' ||
            handle === 'seed-autoship-flat' ||
            handle === 'seed-autoship-offrate'
          ? healthyAutoship
          : undefined;

  const soldOut = seeded && (handle === 'seed-oos-stranded' || handle === 'seed-oos-misrouted');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${handle}</title></head>
<body>
  <h1 data-testid="pdp-title">${handle}</h1>
  <div data-testid="pdp-price">${money(price)}</div>
  ${compareAt === undefined ? '' : `<s data-testid="pdp-compare-at">${money(compareAt)}</s>`}
  ${
    autoship === undefined
      ? ''
      : `<input data-testid="autoship" type="radio" value="subscription">` +
        `<span data-testid="autoship-price">${money(autoship)}</span>`
  }
  ${
    soldOut
      ? '<span data-testid="sold-out">Sold out</span>'
      : '<button data-testid="add-to-cart" onclick="fetch(\'/cart/add\',{method:\'POST\'})">Add</button>'
  }
</body></html>`;
};

const byobPage = (handle: string): string => {
  const empty = seeded && handle === 'seed-byob-empty';
  const staticPrice = seeded && handle === 'seed-byob-static';
  const options = empty
    ? ''
    : Array.from(
        { length: 6 },
        (_, i) =>
          `<button data-testid="byob-option" onclick="pick()">Option ${String(i + 1)}</button>`,
      ).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${handle}</title></head>
<body>
  <h1 data-testid="pdp-title">${handle}</h1>
  ${options}
  <div data-testid="byob-price" id="total">$0.00</div>
  <script>
    let n = 0;
    function pick() {
      ${staticPrice ? '/* price never updates */' : "n += 1; document.getElementById('total').textContent = '$' + (n * 21).toFixed(2);"}
    }
  </script>
</body></html>`;
};

const cartPage = (): string => {
  const subtotal = cartLines * 4000;
  // A fixed code discounts; a site-wide code should be refused on top of it.
  // Gated on a non-empty cart so the fixture never shows a negative total,
  // which is not a state a real cart can reach and would muddy the maths check.
  const discount = cartLines > 0 && appliedCodes.length > 0 ? 1000 : 0;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cart</title></head>
<body>
  ${Array.from({ length: cartLines }, () => '<div data-testid="cart-line-item">line</div>').join('')}
  <div data-testid="cart-subtotal">${money(subtotal)}</div>
  <div data-testid="cart-discount">${money(discount)}</div>
  <div data-testid="cart-total">${money(subtotal - discount)}</div>
  ${appliedCodes.map((code) => `<span>${code}</span>`).join('')}
  <input data-testid="discount-input" id="code" name="discount">
  <button data-testid="discount-apply" onclick="apply()">Apply</button>
  <script>
    function apply() {
      const value = document.getElementById('code').value;
      window.location = '/cart?code=' + encodeURIComponent(value);
    }
  </script>
</body></html>`;
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
  const path = url.pathname;
  const send = (status: number, body: string, headers: Record<string, string> = {}): void => {
    response
      .writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
      .end(body);
  };

  if (path === '/') {
    send(200, `<h1>ad-landing fixture (${PROFILE})</h1>`);
    return;
  }
  if (path === '/cart/add') {
    cartLines += 1;
    send(200, 'ok');
    return;
  }
  if (path === '/cart/reset') {
    cartLines = 0;
    appliedCodes = [];
    send(200, 'ok');
    return;
  }
  if (path === '/cart') {
    // The cart accepts a code by echoing it. Seeded: it accepts the site-wide
    // code alongside the fixed one, which is the stacking defect.
    const code = url.searchParams.get('code');
    if (code !== null) {
      const isSiteWide = code === 'SEEDWIDE';
      if (!isSiteWide || seeded) appliedCodes.push(code);
    }
    send(200, cartPage());
    return;
  }

  // Discount links. A real storefront 302s to the offer; the fixture does the
  // same so the audit's final-URL reading is exercised rather than mocked.
  const discount = /^\/discount\/([^/]+)$/u.exec(path);
  if (discount !== null) {
    const code = discount[1] ?? '';
    if (seeded && code === 'SEEDDEAD') {
      send(404, '<h1>404</h1>');
      return;
    }
    if (seeded && code === 'SEEDWRONG') {
      send(302, '', { location: '/' });
      return;
    }
    send(302, '', { location: `/products/${code === 'SEEDFIXED' ? 'spring-welcome-kit' : 'winter-welcome-kit-combos'}` });
    return;
  }

  const product = /^\/products\/([^/]+)$/u.exec(path);
  if (product === null) {
    send(404, '<h1>404</h1>');
    return;
  }
  const handle = decodeURIComponent(product[1] ?? '');

  // Out-of-stock substitution, and its two failure modes.
  if (seeded && handle === 'seed-oos-misrouted') {
    send(302, '', { location: '/products/thermal-elsewhere' });
    return;
  }
  if (seeded && handle === 'seed-oos-early') {
    send(302, '', { location: '/products/thermal-substitute' });
    return;
  }

  const known = new Set([
    ...HEALTHY,
    ...BYOB_HEALTHY,
    'thermal-elsewhere',
    ...SEEDED.map((entry) => entry.where),
  ]);
  if (!known.has(handle)) {
    send(404, '<h1>404</h1>');
    return;
  }
  send(200, handle.startsWith('byob') || handle.includes('byob') ? byobPage(handle) : pdp(handle));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `ad-landing fixture (${PROFILE}) on http://127.0.0.1:${String(PORT)}\n` +
      (seeded ? `  ${String(SEEDED.length)} planted defects\n` : ''),
  );
});
