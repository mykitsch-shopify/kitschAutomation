import { chromium } from '@playwright/test';

import { isSameProduct, loadKitConfig } from '../web/lib/kit-parity.js';
import { loadTopProductsConfig } from '../web/lib/top-products.js';

/**
 * Live-target preflight.
 *
 * Answers, in one run and before anyone spends a full suite on it, the four
 * questions that decide whether a live run is worth starting:
 *
 *   1. Can this machine reach the storefront at all?
 *   2. Do the configured product handles resolve?
 *   3. Does each handle still serve the product it is supposed to?
 *   4. Do the configured selectors actually match the theme's markup?
 *
 * It exists because those failures look alike in a normal test run — a
 * blocked network, a renamed handle and an unmapped selector all surface as a
 * red spec — and telling them apart afterwards costs a triage cycle every
 * time. Here each is named separately.
 *
 * Question 3 was added after `winter-welcome-kit-combos` came back HTTP 200
 * serving a page titled "Shampoo & Conditioner Bundle with Free Welcome Kit".
 * The handle resolved, every selector matched, and the whole parity comparison
 * would have been measuring a product nobody meant.
 *
 * Covers BOTH product configs — the welcome kits and the top-10 sellers. The
 * top-10 audit had no preflight, so the only way to learn which of its fifteen
 * selectors fit this theme was to run the whole audit and read eleven
 * `not_observed` findings out of the report. Those are harness failures
 * dressed as results, and they cost an audit run each time to discover.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run preflight
 *
 * The top-10 half needs the real store: the local storefront fixture does not
 * carry that catalogue, and pointed at it this says so rather than reporting
 * ten unresolvable handles.
 */

const baseURL = process.env.KITSCH_BASE_URL ?? 'http://127.0.0.1:4173';

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * `--kits-config` / `--products-config` — same spelling as the audits' own
 * `--config`, and the only way to point this at a fixture that serves the
 * catalogue a config names. Without them the top-10 half of this tool could be
 * written but never run: the storefront fixture does not carry those handles
 * and the top-products fixture uses a different config, so nothing local
 * exercises the code path.
 */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const config = loadKitConfig(flag('--kits-config') ?? 'config/kits.yaml');
const topProducts = loadTopProductsConfig(flag('--products-config') ?? 'config/top-products.yaml');

/** Pointed at a fixture that does serve them, the top-10 half is worth running. */
const productsConfigOverridden = flag('--products-config') !== undefined;

/**
 * `--only kits` / `--only products`.
 *
 * No target serves both catalogues except the real store: the storefront
 * fixture has the kits, the top-products fixture has the top-10 list, and
 * pointed at either one the other half reports four or ten resolvable handles
 * as broken. Being able to run one half is what makes each fixture usable for
 * checking this tool itself.
 */
const only = flag('--only');
if (only !== undefined && only !== 'kits' && only !== 'products') {
  write(`--only "${only}" is not a section. Use: --only kits | --only products`);
  process.exit(2);
}
const runKits = only !== 'products';
const runProducts = only !== 'kits';

/**
 * Whether we are pointed at a local fixture rather than a storefront.
 *
 * Decides advice in two places, and gets both of them wrong if guessed: a
 * refused connection to 127.0.0.1 is a fixture that is not running, not a
 * corporate proxy, and a 404 on a top-10 handle against the storefront fixture
 * is that fixture not carrying the catalogue, not a stale handle in the config.
 */
const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/u.test(baseURL);

/**
 * Above this, a selector that should identify one element is matching things
 * outside the product.
 *
 * Zero is not the only broken count, which is the whole reason this bar
 * exists. Against the live theme `compare_at` matched 13 on one PDP and 21 on
 * another — it was reaching into recommendation and upsell cards, and
 * preflight called it fine because the count was not zero. A check that cannot
 * find markup reports a defect that is not there; a check that finds
 * twenty-one reports twenty-one of them.
 */
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

  // Which advice is right turns entirely on where we were pointed.
  //
  // This used to print the egress-policy explanation unconditionally, so a
  // refused connection to 127.0.0.1 — the default when KITSCH_BASE_URL is
  // unset, and the fixture is simply not running — was answered with "the
  // storefront is a public site and needs no VPN" and "run this somewhere with
  // normal internet access". Both true of mykitsch.com, neither of anything.
  // A confident diagnosis of the wrong problem costs more than no diagnosis.
  if (loopback) {
    write('  This is the LOCAL FIXTURE, not a storefront. Nothing is listening on');
    write(`  ${baseURL}, which usually means one of two things:`);
    write('');
    write('    1. You meant to check the real store, and KITSCH_BASE_URL is unset.');
    write('         Windows:  set "KITSCH_BASE_URL=https://www.mykitsch.com"');
    write('         POSIX:    export KITSCH_BASE_URL=https://www.mykitsch.com');
    write('');
    write('    2. You meant the fixture, and it is not started:');
    write('         npm run storefront');
    write('');
    write('  Nothing about the network or the store is implicated either way.');
  } else {
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
}

/**
 * One selector to count on a product page, and what a count means for it.
 *
 * `required` is the distinction that keeps this honest. Zero matches for the
 * title is a broken mapping; zero for `compare_at` is a product that is not on
 * sale, and zero for `video` is a product with no video. Reporting the second
 * kind as a problem would put nine false entries in front of somebody every
 * morning, and the first thing they would learn is to skim past all of them.
 */
type Role = {
  readonly name: string;
  readonly required: boolean;
  readonly singular: boolean;
  /** Printed beside a zero count, to say why zero may be fine. */
  readonly whenAbsent?: string;
  /**
   * Another role whose presence makes this one's absence correct.
   *
   * One case, and it is not hypothetical: a sold-out product has no
   * add-to-cart button. Against the seeded fixture preflight reported
   * `→ unmatched: add_to_cart — map these in config/top-products.yaml` for a
   * product that was simply out of stock, which sends somebody to fix a
   * selector that is already right.
   */
  readonly excusedBy?: string;
  /**
   * This role's value IS its rendered text, so a match that renders nothing is
   * a miss however good the count looks.
   *
   * Added after a live run. Preflight printed `price 1 match(es)` and passed;
   * the locale suite then read that same element and got `""`, because
   * `span.text-red-700` is the SALE price and the product was not discounted.
   * Preflight's whole job is to catch that before a run is spent, and it could
   * not, because it only ever read text for roles carrying a `minChars`
   * threshold. A count is not a reading.
   */
  readonly carriesText?: boolean;
  /**
   * A content threshold the audit will apply to this role's text.
   *
   * A selector can fit perfectly and still be the wrong one. `description` was
   * mapped to `.product__excerpt` because it is the only prose block on the
   * page, and it matches 1 on all ten products — which looks settled and is
   * not: the audit calls anything under `min_description_chars` a
   * `description_missing` major. Ten of those every morning would be caused by
   * a selector nobody could measure, and "matches 1" would keep saying it was
   * fine.
   */
  readonly minChars?: number;
};

const KIT_ROLES: readonly Role[] = [
  { name: 'pdp_title', required: true, singular: true },
  { name: 'pdp_price', required: true, singular: true, carriesText: true },
  { name: 'pdp_compare_at', required: true, singular: true, carriesText: true },
  { name: 'add_to_cart', required: true, singular: true },
];

const PRODUCT_ROLES: readonly Role[] = [
  { name: 'title', required: true, singular: true, carriesText: true },
  { name: 'price', required: true, singular: true, carriesText: true },
  {
    name: 'description',
    required: true,
    singular: false,
    minChars: topProducts.thresholds.minDescriptionChars,
  },
  {
    name: 'specifications',
    required: true,
    singular: false,
    minChars: topProducts.thresholds.minSpecificationChars,
  },
  { name: 'image', required: true, singular: false },
  { name: 'add_to_cart', required: true, singular: true, excusedBy: 'sold_out' },
  {
    name: 'compare_at',
    required: false,
    singular: true,
    carriesText: true,
    whenAbsent: 'expected when the product is not on sale',
  },
  { name: 'video', required: false, singular: false, whenAbsent: 'most of these have none' },
  { name: 'sold_out', required: false, singular: false, whenAbsent: 'expected when in stock' },
  {
    name: 'variant_option',
    required: false,
    singular: false,
    whenAbsent: 'expected on a single-variant product',
  },
];

type PageSpec = {
  readonly label: string;
  readonly handle: string;
  readonly canonicalTitle: string | undefined;
  /** Where a fix belongs, quoted into the advice. */
  readonly configPath: string;
  /** How the config names the title role, for the identity read. */
  readonly titleRole: string;
};

/**
 * Handle, identity and selector fit for one product page.
 *
 * Shared by the welcome kits and the top-10 list because the questions are the
 * same and only the config differs. The top-10 audit had no preflight at all:
 * the only way to learn which of its fifteen selectors fit this theme was to
 * run the whole audit and read eleven `not_observed` findings out of the
 * report — which is a harness problem wearing the clothes of a result.
 */
const checkProductPage = async (
  spec: PageSpec,
  selectors: Readonly<Record<string, string>>,
  roles: readonly Role[],
): Promise<number> => {
  let found = 0;
  const url = `${baseURL}/products/${spec.handle}`;
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
  // kit, which reads as "wrong selector" and sends somebody to edit the
  // config — when the selector may be perfect and the button simply not there
  // yet. Waiting for the thing we are about to count removes the ambiguity; if
  // it never appears, the count below is still taken and still reported, so a
  // genuinely wrong selector is not hidden either.
  //
  // Not networkidle: this store beacons continuously and it would only ever
  // time out.
  const buyButton = selectors.add_to_cart;
  if (buyButton !== undefined) {
    await page
      .waitForSelector(buyButton, { state: 'attached', timeout: 10_000 })
      .catch(() => undefined);
  }

  if (status !== 200) {
    write(`  ${spec.label}`);
    write(`    handle       FAILED (HTTP ${String(status)}) /products/${spec.handle}`);
    write(`    → the handle in ${spec.configPath} does not resolve on this store`);
    return 1;
  }

  write(`  ${spec.label}  (HTTP 200)`);

  // ── Identity ────────────────────────────────────────────────────────────
  //
  // Printed whether or not a canonical title is recorded, because the observed
  // title is the thing somebody needs in order to fill one in. "Not recorded"
  // is reported as a problem in its own right: a run that cannot confirm which
  // product it looked at has not verified that product, and saying nothing
  // here would let that pass for a pass.
  const titleSelector = selectors[spec.titleRole] ?? '';
  const observed = await page
    .locator(titleSelector)
    .first()
    .innerText()
    .then((text) => text.trim())
    .catch(() => '');

  if (spec.canonicalTitle === undefined) {
    found += 1;
    write(`    title        "${observed}"`);
    write('    → no canonical_title recorded, so nothing confirms this handle still');
    write('      serves this product. If the title above is right, paste it into');
    write(`      ${spec.configPath} as canonical_title.`);
  } else if (!isSameProduct(spec.canonicalTitle, observed)) {
    found += 1;
    write(`    title        MISMATCH`);
    write(`      recorded:  "${spec.canonicalTitle}"`);
    write(`      on page:   "${observed}"`);
    write('    → either the product was renamed (update canonical_title) or this');
    write('      handle now points at a different product. Every result for this');
    write('      row would be describing that other product.');
  } else {
    write(`    title        "${observed}"`);
  }

  // Counted first, judged second. `add_to_cart` is excused by `sold_out`, and
  // a single pass could only see roles listed before it — making the verdict
  // depend on the order of a list, which nobody would think to preserve.
  const counts = new Map<string, number>();
  for (const role of roles) {
    const selector = selectors[role.name];
    if (selector === undefined) continue;
    counts.set(role.name, await page.locator(selector).count());
  }

  const misses: string[] = [];
  const overreach: string[] = [];
  for (const role of roles) {
    const selector = selectors[role.name];
    if (selector === undefined) continue;
    const count = counts.get(role.name) ?? 0;
    const tooMany = role.singular && count > TOO_MANY;
    const excused =
      role.excusedBy !== undefined && (counts.get(role.excusedBy) ?? 0) > 0;
    const absentNote =
      count === 0 && excused
        ? `  (${role.excusedBy ?? ''} matched — correct for this product)`
        : count === 0 && !role.required
          ? `  (${role.whenAbsent ?? 'optional'})`
          : '';
    write(
      `    ${role.name.padEnd(15)} ${String(count).padStart(3)} match(es)${tooMany ? '  ← expected one' : absentNote}`,
    );

    // Per-alternative counts, whenever the total is wrong in either direction.
    //
    // These selectors are written as comma-separated lists and both config
    // files called them fallbacks where "the first match wins". They are not:
    // a comma list is a union, so every alternative matches at once and one
    // unscoped entry drags in the whole page however carefully the others are
    // scoped. `compare_at` reported 13 on one PDP and 21 on another for
    // exactly that reason, and nothing in the output said which alternative
    // was responsible.
    //
    // Also shown when a singular selector matches more than one without
    // crossing the "too many" bar. Three matches for "the price" is not a
    // failure — the caller takes `.first()` — but it is worth knowing which
    // three, because whether `.first()` is the right one is not visible from a
    // total, and a sticky bar is a different story from a carousel leak.
    //
    // Not shown for an optional role that matched nothing: there is nothing to
    // diagnose about a product that is simply not on sale.
    const worthBreakingDown =
      tooMany || (role.singular && count > 1) || (count === 0 && role.required && !excused);
    if (worthBreakingDown) {
      for (const alternative of selector.split(',').map((part) => part.trim())) {
        if (alternative === '') continue;
        const each = await page.locator(alternative).count();
        write(`        ${String(each).padStart(3)}  ${alternative}`);
      }
    }
    if (count === 0 && role.required && !excused) misses.push(role.name);
    if (tooMany) overreach.push(`${role.name} (${String(count)})`);

    // Measure the text the audit will measure, on the element it will read.
    // A selector that matches but whose content cannot clear the bar produces
    // a defect report about the store for a decision made in this config.
    if (role.carriesText === true && role.minChars === undefined && count > 0) {
      const text = await page
        .locator(selector)
        .first()
        .innerText()
        .then((value) => value.trim())
        .catch(() => '');
      if (text === '') {
        found += 1;
        write(`        first match renders NO TEXT — the audit would read ""`);
        write(
          `    → ${role.name} matched ${String(count)} element(s) and the first is empty, so a run`,
        );
        write(
          `      would report a malformed or missing value on evidence it never collected.`,
        );
        write(
          `      Usual cause: the selector names a slot this page leaves blank — a sale price`,
        );
        write(`      on a product that is not discounted. Scope it to the element that always`);
        write(`      carries the value.`);
      } else {
        write(`        first match reads "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`);
      }
    }

    if (role.minChars !== undefined && count > 0) {
      const text = await page
        .locator(selector)
        .first()
        .innerText()
        .then((value) => value.trim())
        .catch(() => '');
      if (text.length < role.minChars) {
        found += 1;
        write(
          `        ${String(text.length).padStart(3)} chars in the first match — under the ${String(role.minChars)} the audit requires`,
        );
        write(
          `    → ${role.name} would report as missing on this product even though the selector fits.`,
        );
        write(
          `      Either point it at the fuller block, or lower the threshold in config/top-products.yaml.`,
        );
      } else {
        write(`        ${String(text.length).padStart(3)} chars in the first match  (needs ${String(role.minChars)})`);
      }
    }
  }

  if (misses.length > 0) {
    found += 1;
    write(`    → unmatched: ${misses.join(', ')} — map these in ${spec.configPath} "selectors"`);
  }
  if (overreach.length > 0) {
    found += 1;
    write(
      `    → matches too much: ${overreach.join(', ')} — these identify one element, so a` +
        ' selector finding this many is reaching into recommendation or upsell cards.',
    );
    write('      Scope it to the product section, e.g. prefix with ".main-product ".');
  }
  return found;
};

// ── 2, 3 & 4. Handles, identity and selectors ─────────────────────────────
if (reachable) {
  write('');
  if (runKits) {
    write('  Welcome kits — config/kits.yaml');
    write('');
  }
  for (const kit of runKits ? [config.reference, ...config.candidates] : []) {
    problems += await checkProductPage(
      {
        label: kit.name,
        handle: kit.handle,
        canonicalTitle: kit.canonicalTitle,
        configPath: 'config/kits.yaml',
        titleRole: 'pdp_title',
      },
      config.selectors,
      KIT_ROLES,
    );
  }

  if (runProducts) {
    write('');
    write('  Top-10 sellers — config/top-products.yaml');
    write('');
  }

  // Skipped against a fixture, and said out loud rather than done quietly.
  //
  // The storefront fixture serves the kit handles and one launch product. It
  // does not carry the top-10 catalogue — that is a separate fixture on its
  // own port — so every handle here would 404 and be reported as "the handle
  // in config/top-products.yaml does not resolve on this store". Ten confident
  // statements about the config, all of them describing the fixture instead.
  const skipProducts = !runProducts || (loopback && !productsConfigOverridden);
  if (skipProducts && runProducts) {
    write('  Skipped: the local fixture does not serve this catalogue, so every');
    write('  handle would 404 and be reported as a stale config entry. These');
    write('  selectors can only be checked against the real store:');
    write('');
    write('    Windows:  set "KITSCH_BASE_URL=https://www.mykitsch.com"');
    write('    POSIX:    export KITSCH_BASE_URL=https://www.mykitsch.com');
    write('');
    write('  Or point both at a fixture that does serve it:');
    write('');
    write('    npx tsx tools/preflight.ts --products-config fixtures/top-products/config.yaml');
    write('');
  }

  for (const product of skipProducts ? [] : topProducts.products) {
    // A product with no handle was never going to be checked by the audit
    // either, and it says so there. Repeating it here as a preflight problem
    // would double-count one gap; naming it and moving on is enough.
    if (product.handle === undefined) {
      write(`  ${product.title}`);
      write('    handle       not resolved — the audit skips this product entirely.');
      write('    → npm run resolve:handles');
      continue;
    }
    problems += await checkProductPage(
      {
        label: product.title,
        handle: product.handle,
        canonicalTitle: product.canonicalTitle,
        configPath: 'config/top-products.yaml',
        titleRole: 'title',
      },
      topProducts.selectors,
      PRODUCT_ROLES,
    );
  }
}

await browser.close();

write('');
if (problems === 0) {
  write('Preflight OK — handles resolve, titles confirm and selectors match.');
  write('Run: npm run test:kits   and   npm run audit:top-products');
  process.exitCode = 0;
} else {
  write(`Preflight found ${String(problems)} problem(s). Fix these before reading a parity result:`);
  write('a spec that cannot find the markup reports a defect that is not there.');
  process.exitCode = 1;
}
