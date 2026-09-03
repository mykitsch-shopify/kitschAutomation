import { createServer } from 'node:http';

/**
 * Accessibility fixture.
 *
 *   clean   — every market accessible and correctly localized.
 *   seeded  — one planted defect per rule the audit can produce, including the
 *             two locale-specific ones axe cannot express.
 *
 * The seeded profile is the point: an accessibility gate that has never been
 * watched to fail is indistinguishable from one whose scan silently stopped
 * running.
 */

const PORT = Number(process.env.KITSCH_A11Y_PORT ?? '4205');
const PROFILE = process.env.KITSCH_A11Y_PROFILE ?? 'clean';
const seeded = PROFILE === 'seeded';

const EN_ALT = 'Self-draining soap dish in terracotta';
const DE_ALT = 'Seifenschale mit Ablauf in Terrakotta';
const EN_LABEL = 'Add to shopping cart';
const DE_LABEL = 'In den Einkaufswagen';

/** Locale-specific defects, planted only in the seeded profile. */
const wrongLang = (locale: string): boolean => seeded && locale === 'de';
const englishAlt = (locale: string): boolean => seeded && locale === 'ja';
const englishLabel = (locale: string): boolean => seeded && locale === 'ko';
/** A WCAG violation present in one market only — the cross-locale finding. */
const localeOnlyViolation = (locale: string): boolean => seeded && locale === 'fr';

const page = (locale: string, route: string): string => {
  const isSource = locale === 'en';
  const lang = wrongLang(locale) ? 'en' : locale;
  const alt = isSource || englishAlt(locale) ? EN_ALT : DE_ALT;
  const label = isSource || englishLabel(locale) ? EN_LABEL : DE_LABEL;

  // A second image, localized like the first. Leaving its alt identical across
  // locales made the clean profile report four untranslated_alt findings — and
  // correctly so: "Kitsch brand mark shown on the packaging" is prose a German
  // page should translate, not a brand name it should keep. The fixture was
  // wrong, not the rule.
  const brandAlt = isSource
    ? 'Kitsch brand mark shown on the packaging'
    : `Kitsch Markenzeichen auf der Verpackung (${locale})`;
  // An image with no alt at all: a genuine axe violation, in one market only.
  const extraImage = localeOnlyViolation(locale)
    ? '<img src="/img/ok.svg">'
    : `<img src="/img/ok.svg" alt="${brandAlt}">`;

  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${route} ${locale}</title></head>
<body>
  <main>
    <h1>Kitsch</h1>
    <img src="/img/ok.svg" alt="${alt}">
    ${extraImage}
    <button aria-label="${label}">+</button>
  </main>
</body></html>`;
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
  const send = (status: number, body: string, type = 'text/html; charset=utf-8'): void => {
    response.writeHead(status, { 'content-type': type }).end(body);
  };

  if (url.pathname === '/img/ok.svg') {
    send(200, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>', 'image/svg+xml');
    return;
  }
  if (url.pathname === '/__profile') {
    send(200, `a11y fixture (${PROFILE})`, 'text/plain');
    return;
  }

  // /{locale}/path, or /path for the source locale.
  const match = /^(?:\/(fr|de|it|es|ja|ko))?(\/.*)$/u.exec(url.pathname);
  if (match === null) {
    send(404, '<h1>404</h1>');
    return;
  }
  send(200, page(match[1] ?? 'en', match[2] ?? '/'));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`a11y fixture (${PROFILE}) on http://127.0.0.1:${String(PORT)}\n`);
});
