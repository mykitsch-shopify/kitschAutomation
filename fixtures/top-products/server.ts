import { createServer } from 'node:http';

import { SEEDED, SEEDED_CART, type SeededDefect } from './seeded.js';

/**
 * Storefront fixture for the daily top-10 check.
 *
 * Serves a product page and a cart from a small in-memory catalogue. Two
 * profiles:
 *
 *   clean   — every product healthy. The audit must report nothing.
 *   seeded  — one planted defect per requirement in the daily brief, plus a
 *             cart that does not add up. verify-top-products.ts asserts each
 *             is caught by name.
 *
 * The seeded profile is the point of the file. A daily check that has never
 * been watched to fail is not evidence, and "no findings" is exactly what a
 * check looking at nothing also reports.
 */

const PORT = Number(process.env.KITSCH_TOP_PRODUCTS_PORT ?? '4190');
const PROFILE = process.env.KITSCH_TOP_PRODUCTS_PROFILE ?? 'clean';
const seeded = PROFILE === 'seeded';

type Product = {
  readonly handle: string;
  readonly title: string;
  readonly priceCents: number;
  readonly variants: readonly string[];
};

/** Two real products plus one page per planted defect. */
const CATALOGUE: readonly Product[] = [
  { handle: 'self-draining-soap-dish', title: 'Self-Draining Soap Dish', priceCents: 1200, variants: ['Default Title'] },
  {
    handle: 'kojic-acid-face-and-body-bar',
    title: 'Kojic Acid Hyperpigmentation Face and Body Bar',
    priceCents: 1800,
    variants: ['Default Title'],
  },
  ...SEEDED.map((defect) => ({
    handle: defect.handle,
    title: `Seeded ${defect.kind}`,
    priceCents: 1500,
    variants: defect.kind === 'variant_broken' ? ['Small', 'Large'] : ['Default Title'],
  })),
];

const defectFor = (handle: string): SeededDefect | undefined =>
  seeded ? SEEDED.find((entry) => entry.handle === handle) : undefined;

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

// The fixture cart holds however many lines have been added, so add-to-cart can
// be verified by a line appearing rather than by trusting the click.
let cartLines: string[] = [];

const productPage = (product: Product): string => {
  const defect = defectFor(product.handle);

  const title =
    defect?.kind === 'title_mismatch' ? 'Harry Potter Satin Pillowcase King Gryffindor' : product.title;
  const price = defect?.kind === 'price_zero' ? 0 : product.priceCents;
  const description =
    defect?.kind === 'description_missing'
      ? 'Coming soon'
      : 'A generously sized dish that drains on its own, keeping bars dry between uses ' +
        'and making them last measurably longer than a flat surface would.';
  const specs =
    defect?.kind === 'specifications_missing'
      ? 'Details'
      : 'Material: recycled plastic. Dimensions: 12 x 9 x 2 cm. Weight: 90 g. Care: rinse.';

  const images =
    defect?.kind === 'images_missing'
      ? ''
      : defect?.kind === 'image_broken'
        ? // A src that will 404: complete with naturalWidth 0, which is what a
          // customer sees as a gap and what an element count would miss.
          '<img data-testid="pdp-image" src="/missing/nope.png" alt="">' +
          '<img data-testid="pdp-image" src="/img/ok.svg" alt="">'
        : '<img data-testid="pdp-image" src="/img/ok.svg" alt="">' +
          '<img data-testid="pdp-image" src="/img/ok.svg" alt="">';

  const soldOut = defect?.kind === 'sold_out';

  // The broken variant renders its second option with no price, which is the
  // failure a picker check exists to catch.
  const variantInputs = product.variants
    .map(
      (label, index) =>
        `<input data-testid="variant-option" type="radio" name="opt" value="${label}"` +
        `${index === 0 ? ' checked' : ''}>`,
    )
    .join('');

  const priceMarkup =
    defect?.kind === 'variant_broken'
      ? // Second option selected clears the price via inline script below.
        `<div data-testid="pdp-price" id="price">${money(price)}</div>`
      : `<div data-testid="pdp-price">${money(price)}</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <h1 data-testid="pdp-title">${title}</h1>
  ${priceMarkup}
  <div data-testid="pdp-description">${description}</div>
  <div data-testid="pdp-specs">${specs}</div>
  ${images}
  ${variantInputs}
  ${
    soldOut
      ? '<span data-testid="sold-out">Sold out</span>'
      : `<button data-testid="add-to-cart" onclick="add()">Add to cart</button>`
  }
  <script>
    function add() {
      ${
        defect?.kind === 'add_to_cart_failed'
          ? '/* deliberately does nothing */'
          : `fetch('/cart/add?handle=${product.handle}', { method: 'POST' });`
      }
    }
    ${
      defect?.kind === 'variant_broken'
        ? `document.querySelectorAll('[data-testid="variant-option"]').forEach((el, i) => {
             el.addEventListener('click', () => {
               if (i > 0) document.getElementById('price').textContent = '';
             });
           });`
        : ''
    }
  </script>
</body></html>`;
};

const cartPage = (): string => {
  const subtotal = cartLines.length * 1500;
  // Seeded: the cart shows a discount it does not deduct.
  const discount = seeded && cartLines.length > 0 ? 200 : 0;
  const total = seeded && cartLines.length > 0 ? subtotal : subtotal - discount;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cart</title></head>
<body>
  ${cartLines.map((handle) => `<div data-testid="cart-line-item">${handle}</div>`).join('')}
  <div data-testid="cart-subtotal">${money(subtotal)}</div>
  <div data-testid="cart-discount">${money(discount)}</div>
  <div data-testid="cart-total">${money(total)}</div>
  <input data-testid="discount-input" name="discount">
  <button data-testid="discount-apply">Apply</button>
</body></html>`;
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
  const send = (status: number, body: string, type = 'text/html; charset=utf-8'): void => {
    response.writeHead(status, { 'content-type': type }).end(body);
  };

  if (url.pathname === '/') {
    send(200, `<h1>top-products fixture (${PROFILE})</h1>`);
    return;
  }
  // A tiny real image, so a working <img> reports naturalWidth > 0.
  if (url.pathname === '/img/ok.svg') {
    send(200, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>', 'image/svg+xml');
    return;
  }
  if (url.pathname === '/cart/add') {
    cartLines.push(url.searchParams.get('handle') ?? 'unknown');
    send(200, 'ok', 'text/plain');
    return;
  }
  if (url.pathname === '/cart/reset') {
    cartLines = [];
    send(200, 'ok', 'text/plain');
    return;
  }
  if (url.pathname === '/cart') {
    send(200, cartPage());
    return;
  }

  const match = /^\/products\/([^/]+)$/u.exec(url.pathname);
  if (match === null) {
    send(404, '<h1>404</h1>');
    return;
  }
  const product = CATALOGUE.find((entry) => entry.handle === decodeURIComponent(match[1] ?? ''));
  if (product === undefined) {
    send(404, '<h1>404</h1>');
    return;
  }
  send(200, productPage(product));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `top-products fixture (${PROFILE}) on http://127.0.0.1:${String(PORT)}\n` +
      (seeded ? `  ${String(SEEDED.length)} planted defects + ${SEEDED_CART.kind}\n` : ''),
  );
});
