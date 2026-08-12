import { spawnSync } from 'node:child_process';

import { createFixtureTranslationCollector } from '../collectors/fixture-translations.js';
import { SEEDED_DEFECTS } from '../fixtures/catalog/defects.js';
import { loadI18nConfig, targetLocales } from './lib/config.js';
import { auditSource, compareCatalog } from './lib/locale-parity.js';
import type { Finding } from './lib/locale-parity.js';

/**
 * Negative control for the whole suite.
 *
 * Everything else here answers "does the store look right?". This answers the
 * question that keeps the rest honest: **would we notice if it didn't?**
 *
 * Two halves:
 *
 *   1. Content layer — run the engine over the seeded catalogue and assert
 *      that every planted defect produced the finding kind it was planted to
 *      produce. A comparator that regresses into silence turns this red.
 *   2. Render layer — run the Playwright locale suite against the seeded
 *      storefront and assert it FAILS. A render suite that passes against a
 *      knowingly broken store is not testing anything.
 *
 *   npm run test:detection
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const SEEDED_CATALOG = 'fixtures/catalog/catalog-seeded.json';
const SEEDED_PORT = '4174';

const verifyContentLayer = async (): Promise<boolean> => {
  const config = loadI18nConfig();
  const collector = createFixtureTranslationCollector(SEEDED_CATALOG);

  const source = await collector.fetchCatalog(config.sourceLocale, config.resources);
  const findings: Finding[] = [...auditSource(source, config)];
  for (const locale of targetLocales(config)) {
    findings.push(
      ...compareCatalog(source, await collector.fetchCatalog(locale.code, config.resources), config),
    );
  }

  write('Content layer — planted defect detection');
  write('');

  let missed = 0;
  for (const defect of SEEDED_DEFECTS) {
    const caught = findings.some(
      (item) =>
        item.locale === defect.locale && item.key === defect.key && item.kind === defect.expect,
    );
    if (!caught) {
      missed += 1;
    }
    write(
      `  ${caught ? 'caught ' : 'MISSED '} ${defect.planRef.padEnd(7)} ${defect.locale}/${defect.key} → ${defect.expect}`,
    );
  }

  write('');
  write(
    `  ${String(SEEDED_DEFECTS.length - missed)}/${String(SEEDED_DEFECTS.length)} planted defects detected`,
  );
  write('');
  return missed === 0;
};

const verifyRenderLayer = (): boolean => {
  write('Render layer — specs must fail against the seeded storefront');
  write('');

  const result = spawnSync(
    'npx',
    ['playwright', 'test', '--project=i18n-mobile', '--reporter=line'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        KITSCH_FIXTURE_PROFILE: 'seeded',
        KITSCH_FIXTURE_PORT: SEEDED_PORT,
        KITSCH_BASE_URL: `http://127.0.0.1:${SEEDED_PORT}`,
        // The specs read the *contracted* translations, not the served ones.
        KITSCH_BASELINE: 'fixtures/catalog/catalog-clean.json',
      },
    },
  );

  const output = `${result.stdout}${result.stderr}`;
  const failedMatch = /(\d+) failed/u.exec(output);
  const failed = failedMatch?.[1] ?? '0';

  if (result.status === 0) {
    write('  FAIL — the locale suite passed against a knowingly broken storefront.');
    write('  The render specs are not asserting what they claim to assert.');
    write('');
    return false;
  }

  write(`  ${failed} spec(s) failed against the seeded storefront, as they must.`);
  write('');
  return true;
};

const contentOk = await verifyContentLayer();
const renderOk = verifyRenderLayer();

if (contentOk && renderOk) {
  write('Detection verified: both layers fail when the store is broken.');
  process.exitCode = 0;
} else {
  console.error('Detection NOT verified — a check has gone silent. Treat as harness-critical.');
  process.exitCode = 1;
}
