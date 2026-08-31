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

/**
 * Selectors that identify one thing on the page.
 *
 * A product has one title, one price, one buy button. `kit_item` and its
 * siblings legitimately match many, which is why they are not here.
 *
 * This exists because zero is not the only broken count. Against the live
 * theme `pdp_compare_at` matched 13 on one PDP and 25 on another — it was
 * reaching into recommendation and upsell cards, and preflight called it fine
 * because the count was not zero. A spec that cannot find markup reports a
 * defect that is not there; a spec that finds twenty-five reports twenty-five
 * of them, and preflight exists to catch exactly that class of thing.
 */
const SINGULAR = new Set(['pdp_title', 'pdp_price', 'pdp_compare_at', 'add_to_cart']);

/** Above this, a singular selector is matching things outside the product. */
const TOO_MANY = 3;

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
      .goto(url, { timeout: 25_000, waitUntil: 'load' })
      .then((response) => response?.status() ?? 0)
      .catch(() => 0);

    // Give the buy button a chance to exist before counting anything.
    //
    // This theme renders it after load, behind A/B and anti-flicker scripts.
    // Counting at domcontentloaded reported `add_to_cart 0 match(es)` on every
    // kit, which reads as "wrong selector" and sends somebody to edit
    // kits.yaml — when the selector may be perfect and the button simply not
    // there yet. Waiting for the thing we are about to count removes the
    // ambiguity; if it never appears, the count below is still taken and still
    // reported, so a genuinely wrong selector is not hidden either.
    //
    // Not networkidle: this store beacons continuously and it would only ever
    // time out.
    await page
      .waitForSelector(config.selectors.add_to_cart, { state: 'attached', timeout: 10_000 })
      .catch(() => undefined);

    if (status !== 200) {
      problems += 1;
      write(`  ${kit.name}`);
      write(`    handle       FAILED (HTTP ${String(status)}) /products/${kit.handle}`);
      write(`    → the handle in config/kits.yaml does not resolve on this store`);
      continue;
    }

    write(`  ${kit.name}  (HTTP 200)`);
    const misses: string[] = [];
    const overreach: string[] = [];
    for (const name of PAGE_SELECTORS) {
      const selector = config.selectors[name];
      const count = await page.locator(selector).count();
      const tooMany = SINGULAR.has(name) && count > TOO_MANY;
      write(
        `    ${name.padEnd(15)} ${String(count).padStart(3)} match(es)${tooMany ? '  ← expected one' : ''}`,
      );

      // Per-alternative counts, whenever the total is wrong in either
      // direction.
      //
      // These selectors are written as comma-separated lists and the file
      // called them fallbacks where "the first match wins". They are not:
      // a comma list is a union, so every alternative matches at once and one
      // unscoped entry drags in the whole page however carefully the others
      // are scoped. `pdp_compare_at` scoped to `.main-product` still reported
      // 13 for exactly that reason, and nothing in the output said which of
      // the four alternatives was responsible.
      if (count === 0 || tooMany) {
        for (const alternative of selector.split(',').map((part) => part.trim())) {
          if (alternative === '') continue;
          const each = await page.locator(alternative).count();
          write(`        ${String(each).padStart(3)}  ${alternative}`);
        }
      }
      if (count === 0) misses.push(name);
      if (tooMany) overreach.push(`${name} (${String(count)})`);
    }
    if (misses.length > 0) {
      problems += 1;
      write(`    → unmatched: ${misses.join(', ')} — map these in config/kits.yaml "selectors"`);
    }
    if (overreach.length > 0) {
      problems += 1;
      write(
        `    → matches too much: ${overreach.join(', ')} — these identify one element, so a` +
          ' selector finding this many is reaching into recommendation or upsell cards.',
      );
      write('      Scope it to the product section, e.g. prefix with ".main-product ".');
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
