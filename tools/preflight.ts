import { chromium } from '@playwright/test';

import { loadKitConfig } from '../web/lib/kit-parity.js';

/**
 * Live-target preflight.
 *
 * Answers, in one run and before anyone spends a full suite on it, the three
 * questions that decide whether a live run is worth starting:
 *
 *   1. Can this machine reach the storefront at all?
 *   2. Do the configured product handles resolve?
 *   3. Do the configured selectors actually match the theme's markup?
 *
 * It exists because those three failures look alike in a normal test run — a
 * blocked network, a renamed handle and an unmapped selector all surface as a
 * red spec — and telling them apart afterwards costs a triage cycle every
 * time. Here each is named separately.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight
 */

const baseURL = process.env.KITSCH_BASE_URL ?? 'http://127.0.0.1:4173';
const config = loadKitConfig();

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const PAGE_SELECTORS = ['pdp_title', 'pdp_price', 'pdp_compare_at', 'kit_item', 'add_to_cart'] as const;

// A launch failure is not one of the three questions above, and Playwright's
// own message for it advises `npx playwright install` — which is the wrong
// move anywhere browser downloads are blocked, and buries the fix that works.
// Catching it keeps the first thing this tool ever prints an actionable line
// rather than an uncaught exception with a banner in it.
const browser = await chromium
  .launch({
    ...(process.env.KITSCH_CHROMIUM_PATH === undefined
      ? {}
      : { executablePath: process.env.KITSCH_CHROMIUM_PATH }),
  })
  .catch((error: Error) => {
    write(`Preflight against ${baseURL}`);
    write('');
    write(`  NO BROWSER     ${error.message.split('\n')[0] ?? ''}`);
    write('');
    write('  Chromium did not launch, so nothing was tested. Usually one of:');
    write('');
    write('    1. It is not installed yet   ->  npx playwright install chromium');
    write('    2. An installed build does not match the version Playwright');
    write('       expects, and downloading a new one is blocked. Point at the');
    write('       build you have:');
    write('');
    write('         KITSCH_CHROMIUM_PATH=/path/to/chrome npm run preflight');
    write('');
    process.exit(2);
  });
const page = await browser.newPage();

write(`Preflight against ${baseURL}`);
write('');

let reachable = true;
let problems = 0;

// ── 1. Reachability ───────────────────────────────────────────────────────
try {
  const response = await page.goto(baseURL, { timeout: 25_000, waitUntil: 'domcontentloaded' });
  write(`  reachable      HTTP ${String(response?.status() ?? '?')}`);
} catch (error) {
  reachable = false;
  problems += 1;
  const message = (error as Error).message.split('\n')[0] ?? '';
  write(`  UNREACHABLE    ${message}`);
  write('');
  write('  A tunnel or connection error here is the network, not the store.');
  write('  Nothing reached the site, so no amount of browser configuration —');
  write('  stealth plugins, user agents, headful mode — changes the result.');
  write('');
  write('  On an ordinary machine this should not happen: the storefront is a');
  write('  public site and needs no VPN, allowlist or credential. Seeing it');
  write('  means something is intercepting outbound traffic — a sandbox or CI');
  write('  runner with a restricted egress policy is the usual cause. Run the');
  write('  same command somewhere with normal internet access.');
  write('');
  write('  Note this is NOT the store refusing automated traffic. That looks');
  write('  different: the page loads and returns an HTTP 403 or a challenge.');
}

// ── 2 & 3. Handles and selectors ──────────────────────────────────────────
if (reachable) {
  write('');
  for (const kit of [config.reference, ...config.candidates]) {
    const url = `${baseURL}/products/${kit.handle}`;
    // 0 means "did not respond at all", which reads the same as a 404 here:
    // either way the handle is not usable.
    const status = await page
      .goto(url, { timeout: 25_000, waitUntil: 'domcontentloaded' })
      .then((response) => response?.status() ?? 0)
      .catch(() => 0);

    if (status !== 200) {
      problems += 1;
      write(`  ${kit.name}`);
      write(`    handle       FAILED (HTTP ${String(status)}) /products/${kit.handle}`);
      write(`    → the handle in config/kits.yaml does not resolve on this store`);
      continue;
    }

    write(`  ${kit.name}  (HTTP 200)`);
    const misses: string[] = [];
    for (const name of PAGE_SELECTORS) {
      const selector = config.selectors[name];
      const count = await page.locator(selector).count();
      write(`    ${name.padEnd(15)} ${String(count).padStart(3)} match(es)`);
      if (count === 0) {
        misses.push(name);
      }
    }
    if (misses.length > 0) {
      problems += 1;
      write(`    → unmatched: ${misses.join(', ')} — map these in config/kits.yaml "selectors"`);
    }
  }
}

await browser.close();

write('');
if (problems === 0) {
  write('Preflight OK — handles resolve and selectors match. Run: npm run test:kits');
  process.exitCode = 0;
} else {
  write(`Preflight found ${String(problems)} problem(s). Fix these before reading a parity result:`);
  write('a spec that cannot find the markup reports a defect that is not there.');
  process.exitCode = 1;
}
