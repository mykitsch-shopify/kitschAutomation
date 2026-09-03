import { createServer } from 'node:http';

/**
 * Storefront fixture for the translation-backlog audit.
 *
 * Serves an English PDP and per-locale PDPs whose copy is translated, English,
 * half-translated or missing — one product per verdict the audit can reach, so
 * every verdict is watched to happen before a real Asana task is closed on one.
 */

const PORT = Number(process.env.KITSCH_BACKLOG_PORT ?? '4200');
const PROFILE = process.env.KITSCH_BACKLOG_PROFILE ?? 'mixed';

const EN_TITLE = 'Self-Draining Soap Dish';
const EN_BODY =
  'Keeps bars dry between uses and makes them last measurably longer than a flat surface would.';

const ES_TITLE = 'Jabonera autodrenante';
const ES_BODY =
  'Mantiene secas las pastillas entre usos y hace que duren mucho mas que en una superficie plana.';

/** handle -> what each locale serves. 'en' means untranslated fallback. */
const CATALOGUE: Record<string, Record<string, 'translated' | 'en' | 'title-only'>> = {
  'fully-translated': { es: 'translated', fr: 'translated' },
  'not-translated': { es: 'en', fr: 'en' },
  'half-translated': { es: 'translated', fr: 'en' },
  'title-only-translated': { es: 'title-only', fr: 'title-only' },
};

const page = (title: string, body: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <h1 data-testid="pdp-title">${title}</h1>
  <div data-testid="pdp-description">${body}</div>
</body></html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
  const send = (status: number, body: string): void => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  };

  if (url.pathname === '/') {
    send(200, `<h1>translation-backlog fixture (${PROFILE})</h1>`);
    return;
  }

  const match = /^(?:\/([a-z]{2}))?\/products\/([^/]+)$/u.exec(url.pathname);
  if (match === null) {
    send(404, '<h1>404</h1>');
    return;
  }
  const locale = match[1];
  const handle = match[2] ?? '';

  // A handle nobody serves: exercises the stale-product verdict.
  if (handle === 'gone-product') {
    send(404, '<h1>404</h1>');
    return;
  }
  const entry = CATALOGUE[handle];
  if (entry === undefined) {
    send(404, '<h1>404</h1>');
    return;
  }
  // English source.
  if (locale === undefined) {
    send(200, page(EN_TITLE, EN_BODY));
    return;
  }

  const state = entry[locale] ?? 'en';
  if (state === 'translated') send(200, page(ES_TITLE, ES_BODY));
  // The half-done state the field-level comparison exists for: translated
  // title, description still falling back to English.
  else if (state === 'title-only') send(200, page(ES_TITLE, EN_BODY));
  else send(200, page(EN_TITLE, EN_BODY));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`translation-backlog fixture (${PROFILE}) on http://127.0.0.1:${String(PORT)}\n`);
});
