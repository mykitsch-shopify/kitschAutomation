import { createServer } from 'node:http';

/**
 * Storefront fixture for the health-check re-verification.
 *
 * Two profiles, and the pair is the control:
 *
 *   clean   the theme with both 2026-04-28 defects repaired. The audit must
 *           report every issue as not reproduced.
 *   seeded  the theme exactly as that report described it. The audit must
 *           report both issues as still present, and draft two tickets.
 *
 * The seeded profile reproduces the two findings in the places they were
 * actually found, which is the part that matters:
 *
 *   ISSUE 1  aria-label on the quick-view close button. Invisible on screen,
 *            absent from innerText, spoken by a screen reader.
 *   ISSUE 2  an sr-only div. Also invisible on screen, but present in
 *            innerText because sr-only clips rather than hides.
 *
 * A scanner that reads only visible text passes the first and catches the
 * second, so a control that seeds only one of them would be green against a
 * scanner that is half blind. Both are here for that reason.
 */

const PORT = Number(process.env.KITSCH_HEALTH_CHECK_PORT ?? '4210');
const PROFILE = process.env.KITSCH_HEALTH_CHECK_PROFILE ?? 'seeded';
const seeded = PROFILE === 'seeded';

/** ISSUE 1 — the literal Shopify renders when a locale key is absent. */
const CLOSE_LABEL = seeded
  ? 'Translation missing: en.products.product.quick_view.close'
  : 'Close';

/** ISSUE 2 — the Liquid variable the theme never substituted. */
const QUICK_VIEW_SR = seeded ? 'Quick view of {{ product_title }}' : 'Quick view of Rice Water Bar';

const PRODUCTS: Readonly<Record<string, string>> = {
  'coastal-cottage-hair-perfume-duo': 'Coastal Cottage Hair Perfume Duo',
  'rice-water-shampoo-conditioner-bar-combo': 'Rice Water Shampoo & Conditioner Bar Combo',
};

/**
 * The quick-view component, which is where both defects live. Rendered on
 * every page because the report called them theme-level: a control that put
 * them on one page would let a sitewide sample of five pass by checking four.
 */
const quickView = (): string => `
  <div class="quick-view" data-testid="quick-view">
    <button class="quick-view__close" aria-label="${CLOSE_LABEL}">&times;</button>
    <div class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${QUICK_VIEW_SR}</div>
  </div>`;

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <header data-testid="site-header"><a href="/" title="Kitsch home">Kitsch</a></header>
  <h1>${title}</h1>
  ${body}
  ${quickView()}
</body></html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
  const send = (status: number, body: string): void => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  };

  if (url.pathname === '/') {
    send(200, page(`health-check fixture (${PROFILE})`, '<p>Bestsellers</p>'));
    return;
  }
  if (url.pathname === '/collections/best-sellers') {
    send(200, page('Best Sellers', '<ul><li>Coastal Cottage Hair Perfume Duo</li></ul>'));
    return;
  }
  if (url.pathname === '/cart') {
    send(200, page('Your cart', '<p data-testid="cart-subtotal">$0.00</p>'));
    return;
  }
  const handle = /^\/products\/([\w-]+)$/u.exec(url.pathname)?.[1];
  if (handle !== undefined) {
    const title = PRODUCTS[handle];
    if (title === undefined) {
      send(404, page('Not found', '<p>No such product.</p>'));
      return;
    }
    send(200, page(title, '<p class="price">$26.00</p><button name="add">Add to cart</button>'));
    return;
  }
  send(404, page('Not found', '<p>No such page.</p>'));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `health-check fixture (${PROFILE}) listening on http://127.0.0.1:${String(PORT)}\n`,
  );
});
