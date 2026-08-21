import { chromium, firefox, webkit, type Browser, type BrowserContext } from '@playwright/test';

/**
 * Browser launching for the audit CLIs.
 *
 * The three audits (compare-at, top-products, ad-landing) each launched
 * Chromium directly with a copy of the same escape-hatch and error handling.
 * That was three places to change and three ways to drift, and none of them
 * offered a desktop viewport, a browser choice, or a way to watch the run.
 *
 * Headless is the default because these are meant to run unattended — on a
 * schedule, in CI, or from an IDE run button. Headed exists for the one case
 * that needs it: watching a flow to work out why a selector missed.
 */

export type BrowserName = 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';

const ENGINES = {
  chromium,
  firefox,
  webkit,
  // Real Chrome and Edge, not bundled Chromium. Distinct rendering and distinct
  // update cadence, which is why the QA scorecard names Edge separately.
  chrome: chromium,
  edge: chromium,
} as const satisfies Record<BrowserName, typeof chromium | typeof firefox | typeof webkit>;

/** Channel for the browsers that are a real installed application. */
const CHANNEL: Partial<Record<BrowserName, string>> = { chrome: 'chrome', edge: 'msedge' };

export type LaunchOptions = {
  readonly browserName: BrowserName;
  readonly headed: boolean;
  readonly slowMo: number;
  readonly viewport: { readonly width: number; readonly height: number };
};

const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const;

/** Pure, so the accepted set is unit-testable without launching anything. */
export const resolveBrowserName = (value: string): BrowserName | undefined => {
  const name = value.trim().toLowerCase();
  return name === 'chromium' ||
    name === 'firefox' ||
    name === 'webkit' ||
    name === 'chrome' ||
    name === 'edge'
    ? name
    : undefined;
};

export const BROWSER_NAMES: readonly BrowserName[] = [
  'chromium',
  'firefox',
  'webkit',
  'chrome',
  'edge',
];

/**
 * Reads browser options from flags, then environment, then defaults.
 *
 *   --browser chromium|firefox|webkit|chrome|edge   (or KITSCH_BROWSER)
 *   --headed                                        (or KITSCH_HEADED=1)
 *   --slow-mo 250                                   (or KITSCH_SLOW_MO)
 *   --viewport 1280x720                             (or KITSCH_VIEWPORT)
 */
export const readLaunchOptions = (
  flags: ReadonlyMap<string, string>,
  bare: ReadonlySet<string>,
): LaunchOptions => {
  const requested = flags.get('browser') ?? process.env.KITSCH_BROWSER ?? 'chromium';
  const browserName = resolveBrowserName(requested);
  if (browserName === undefined) {
    throw new Error(
      `Unknown browser "${requested.trim()}". Use one of: ${BROWSER_NAMES.join(', ')}.`,
    );
  }

  const viewportText = flags.get('viewport') ?? process.env.KITSCH_VIEWPORT ?? '';
  const parsedViewport = /^(\d{3,5})x(\d{3,5})$/u.exec(viewportText.trim());
  const slowMoText = flags.get('slow-mo') ?? process.env.KITSCH_SLOW_MO ?? '0';
  const slowMo = Number(slowMoText);

  return {
    browserName,
    // Explicitly not defaulting to headed anywhere. A scheduled run that opens
    // a window fails on any machine without a display, and that failure looks
    // like a broken check rather than a wrong flag.
    headed: bare.has('headed') || process.env.KITSCH_HEADED === '1',
    slowMo: Number.isFinite(slowMo) && slowMo > 0 ? slowMo : 0,
    viewport:
      parsedViewport === null
        ? DEFAULT_VIEWPORT
        : { width: Number(parsedViewport[1]), height: Number(parsedViewport[2]) },
  };
};

/** One line naming what the run is actually driving, so a report is never ambiguous. */
export const describeLaunch = (options: LaunchOptions): string =>
  `${options.browserName} ${options.headed ? 'headed' : 'headless'} ` +
  `${String(options.viewport.width)}x${String(options.viewport.height)}` +
  (options.slowMo > 0 ? ` slowMo=${String(options.slowMo)}ms` : '');

const installHint = (name: BrowserName): string => {
  if (name === 'chrome' || name === 'edge') {
    return (
      `  ${name} runs the real installed application, not bundled Chromium.\n` +
      `    1. Install ${name === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}, or\n` +
      `    2. npx playwright install ${name === 'chrome' ? 'chrome' : 'msedge'}\n` +
      '    3. or use --browser chromium, which needs no system install\n'
    );
  }
  return (
    `    1. npx playwright install ${name}\n` +
    (name === 'chromium'
      ? '    2. or point at a build you already have:\n' +
        '       KITSCH_CHROMIUM_PATH=/path/to/chrome\n'
      : '    2. firefox and webkit have no executable-path escape hatch here;\n' +
        '       if downloads are blocked, use --browser chromium\n')
  );
};

/**
 * Launches and returns a context already sized like a desktop.
 *
 * Exits 2 with an actionable message rather than throwing Playwright's default,
 * which advises `npx playwright install` even where downloads are blocked and
 * says nothing about the escape hatch that does work.
 */
export const launchDesktop = async (
  options: LaunchOptions,
): Promise<{ browser: Browser; context: BrowserContext }> => {
  const engine = ENGINES[options.browserName];
  const channel = CHANNEL[options.browserName];
  // The executable-path override applies to bundled Chromium only. Applying it
  // to a channel would silently run a different browser than the one named.
  const executablePath =
    options.browserName === 'chromium' ? process.env.KITSCH_CHROMIUM_PATH : undefined;

  let browser: Browser;
  try {
    browser = await engine.launch({
      headless: !options.headed,
      ...(options.slowMo > 0 ? { slowMo: options.slowMo } : {}),
      ...(channel === undefined ? {} : { channel }),
      ...(executablePath === undefined ? {} : { executablePath }),
    });
  } catch (error) {
    const first = (error as Error).message.split('\n')[0] ?? '';
    process.stderr.write(
      `\n  NO BROWSER     ${first}\n\n` +
        `  ${options.browserName} did not launch, so nothing was checked.\n\n` +
        installHint(options.browserName) +
        (options.headed
          ? '\n  Headed mode also needs a display. On a headless server or in CI,\n' +
            '  drop --headed or run under Xvfb.\n'
          : '') +
        '\n',
    );
    process.exit(2);
  }

  const context = await browser.newContext({
    viewport: options.viewport,
    // Identifies harness traffic in Shopify and Constructor logs so analytics
    // and rate-limit investigations can exclude it. Matches playwright.config.ts.
    extraHTTPHeaders: { 'X-Kitsch-QA': 'audit-cli' },
  });
  return { browser, context };
};

/**
 * The one call the audit CLIs make: read the options, report what is being
 * driven, launch, and turn every failure into an actionable message with
 * exit 2.
 *
 * It exists so the three audits do not each carry their own copy of the error
 * handling — the previous arrangement, where a bad --browser escaped as an
 * uncaught stack trace and exit 1 while a missing binary exited 2 with a clean
 * message, was exactly that drift.
 */
export const launchFromArgs = async (
  flags: ReadonlyMap<string, string>,
  bare: ReadonlySet<string>,
  write: (line: string) => void,
  label = 'browser',
): Promise<{ browser: Browser; context: BrowserContext }> => {
  let options: LaunchOptions;
  try {
    options = readLaunchOptions(flags, bare);
  } catch (error) {
    process.stderr.write(`\n  ${(error as Error).message}\n\n`);
    process.exit(2);
  }
  write(`  ${label} ${describeLaunch(options)}`);
  return launchDesktop(options);
};
