import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { type Page } from '@playwright/test';

import { allureDir, writeAllureCases, writeEnvironment } from './lib/allure.js';
import { launchFromArgs } from './lib/browser.js';
import {
  isProductTask,
  judgeTask,
  needsHandle,
  parseTask,
  summarize,
  type BacklogTask,
  type LocaleObservation,
  type LocaleVerdict,
  type TaskResult,
} from '../web/lib/translation-backlog.js';

/**
 * Translation backlog verification.
 *
 *   KITSCH_BASE_URL=https://www.mykitsch.com npm run audit:translation-backlog
 *
 * Takes the open "Translate Product" tasks and asks the live storefront whether
 * each is still true. It writes no translations and changes nothing in Asana —
 * it reports which tasks are done, which are half done, and which are about
 * products that no longer exist.
 *
 * Options:
 *   --tasks <path>     Asana export, default data/asana/translation-tasks.json (npm run asana:pull)
 *   --limit <n>        check at most n tasks (a smoke run)
 *   --locale-prefix    URL shape for a locale, default "/{locale}"
 *   --out <dir>        report directory, default translation-backlog-report
 *   plus the shared browser flags: --browser / --headed / --slow-mo / --viewport
 *
 * Exit codes: 0 everything verified, 1 tasks need attention, 2 could not run.
 */

const flags = new Map<string, string>();
const bare = new Set<string>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) bare.add(name);
    else {
      flags.set(name, next);
      i += 1;
    }
  }
}

const baseURL = (flags.get('base-url') ?? process.env.KITSCH_BASE_URL ?? '').replace(/\/$/u, '');
if (baseURL === '') {
  process.stderr.write(
    'No storefront to check. Pass --base-url or set KITSCH_BASE_URL.\n' +
      'Refusing to default to a fixture: closing real Asana tasks on the strength\n' +
      'of a mock would be worse than not checking at all.\n',
  );
  process.exit(2);
}

const tasksPath = flags.get('tasks') ?? 'data/asana/translation-tasks.json';
const outDir = flags.get('out') ?? 'translation-backlog-report';
const localePrefix = flags.get('locale-prefix') ?? '/{locale}';
const limitText = flags.get('limit');
const limit = limitText === undefined ? undefined : Number(limitText);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// Title and description: the two fields the audit's "missing locales" refers to.
const TITLE = '[data-testid="pdp-title"], h1.product__title, .product-single__title';
const DESCRIPTION =
  '[data-testid="pdp-description"], .product__description, .product-single__description';

type Export = {
  readonly tasks: readonly {
    readonly gid: string;
    readonly name: string;
    readonly notes: string;
    readonly due_on?: string | null;
  }[];
  readonly captured?: string;
};

const parsed: Export = JSON.parse(readFileSync(tasksPath, 'utf8')) as Export;
const allTasks: readonly BacklogTask[] = parsed.tasks.map((entry) =>
  parseTask(entry.gid, entry.name, entry.notes, entry.due_on ?? undefined),
);
const products = allTasks.filter(isProductTask);
const unresolved = allTasks.filter(needsHandle);

if (products.length === 0) {
  process.stderr.write(
    `${tasksPath}: no task resolved to a product handle. Refusing to report a vacuous pass.\n`,
  );
  process.exit(2);
}

const selected = limit === undefined ? products : products.slice(0, limit);

write('');
write(`Translation backlog — ${String(allTasks.length)} open task(s)`);
write('');
write(`  target        ${baseURL}`);
write(`  export        ${tasksPath}${parsed.captured === undefined ? '' : ` (captured ${parsed.captured})`}`);
write(`  product tasks ${String(products.length)}`);
write(`  no handle     ${String(unresolved.length)} — named a translation but no product URL`);
write(`  checking      ${String(selected.length)} task(s), ` +
  `${String(selected.reduce((n, task) => n + task.locales.length, 0))} handle x locale`);

const { browser, context } = await launchFromArgs(flags, bare, write, 'browser      ');
const page = await context.newPage();

const textOf = async (target: Page, css: string): Promise<string | undefined> => {
  const locator = target.locator(css).first();
  if ((await locator.count()) === 0) return undefined;
  return (await locator.textContent()) ?? undefined;
};

type Fields = { readonly status: number; readonly title?: string; readonly description?: string };

const read = async (url: string): Promise<Fields> => {
  const status = await page
    .goto(url, { timeout: 30_000, waitUntil: 'domcontentloaded' })
    .then((response) => response?.status() ?? 0)
    .catch(() => 0);
  if (status !== 200) return { status };
  return {
    status,
    ...(await textOf(page, TITLE).then((value) => (value === undefined ? {} : { title: value }))),
    ...(await textOf(page, DESCRIPTION).then((value) =>
      value === undefined ? {} : { description: value },
    )),
  };
};

write('');
const results: TaskResult[] = [];
let reachedAny = false;

for (const [index, task] of selected.entries()) {
  const handle = task.handle ?? '';
  // English is read once per product and compared against every locale. Reading
  // it per locale would triple the requests for the same answer.
  const english = await read(`${baseURL}/products/${handle}`);
  if (english.status === 200) reachedAny = true;

  const observations: LocaleObservation[] = [];
  for (const locale of task.locales) {
    const prefix = localePrefix.replace('{locale}', locale);
    const localized = await read(`${baseURL}${prefix}/products/${handle}`);
    if (localized.status === 200) reachedAny = true;
    observations.push({
      locale,
      // A localized 404 on a product whose English page loads is a routing
      // problem, not a stale product, so the English status decides.
      status: english.status === 404 ? 404 : localized.status,
      fields: {
        title: { localized: localized.title, english: english.title },
        description: { localized: localized.description, english: english.description },
      },
    });
  }

  const result = judgeTask(task, observations);
  results.push(result);
  const mark =
    result.verdict === 'closeable'
      ? 'DONE  '
      : result.verdict === 'partial'
        ? 'PART  '
        : result.verdict === 'stale_product'
          ? 'GONE  '
          : result.verdict === 'unverified'
            ? '?     '
            : 'OPEN  ';
  write(`  ${mark} ${handle}`);
  if ((index + 1) % 25 === 0) write(`    …${String(index + 1)}/${String(selected.length)}`);
}

await browser.close();

// Run-level vacuity guard. If nothing loaded, every task is "unverified"
// anyway, but say so once and plainly rather than 93 times.
const blind = selected.length > 0 && !reachedAny;

const counts = summarize(results);
mkdirSync(outDir, { recursive: true });

const section = (verdict: string, title: string, why: string): readonly string[] => {
  const list = results.filter((result) => result.verdict === verdict);
  if (list.length === 0) return [];
  return [
    `## ${title} — ${String(list.length)}`,
    '',
    why,
    '',
    ...list.map(
      (result) =>
        `- [${result.task.name}](https://app.asana.com/0/0/${result.task.gid}/f) ` +
        `\`${result.task.handle ?? ''}\` — ${result.note}`,
    ),
    '',
  ];
};

writeFileSync(
  `${outDir}/report.md`,
  [
    '# Translation backlog — verification',
    '',
    `- target: ${baseURL}`,
    `- export: \`${tasksPath}\`${parsed.captured === undefined ? '' : ` (captured ${parsed.captured})`}`,
    `- checked: ${String(selected.length)} of ${String(products.length)} product task(s)`,
    '',
    '| verdict | count |',
    '|---|---|',
    `| closeable — work appears done | ${String(counts.closeable)} |`,
    `| partial — some locales done | ${String(counts.partial)} |`,
    `| still open — nothing changed | ${String(counts.still_open)} |`,
    `| stale product — handle 404s | ${String(counts.stale_product)} |`,
    `| unverified — could not check | ${String(counts.unverified)} |`,
    '',
    ...(blind
      ? [
          '> **Nothing loaded from the storefront, so no task was verified.**',
          '> Every verdict below is "unverified" for that reason alone.',
          '',
        ]
      : []),
    ...section(
      'closeable',
      'Can be closed',
      'Every locale these tasks name now shows localized copy. Closing them is a ' +
        'person\'s decision, not this tool\'s — it changes nothing in Asana.',
    ),
    ...section(
      'partial',
      'Partly done',
      'Some locales are translated and some are not. The remaining locales are named ' +
        'per task, so the task can be narrowed rather than re-done.',
    ),
    ...section(
      'stale_product',
      'Product no longer exists',
      'These handles 404. The task outlived its product; it needs closing or ' +
        're-pointing, not translating.',
    ),
    ...section('still_open', 'Still open', 'Unchanged since the audit that created them.'),
    ...section(
      'unverified',
      'Could not verify',
      'Our own gap, not a statement about the store. Usually an unmapped selector.',
    ),
    ...(unresolved.length === 0
      ? []
      : [
          `## Tasks with no product URL — ${String(unresolved.length)}`,
          '',
          'Named a translation but gave no handle or product link, so they were not ' +
            'checked. Adding the URL to the task is the whole fix.',
          '',
          ...unresolved.map(
            (task) => `- [${task.name}](https://app.asana.com/0/0/${task.gid}/f)`,
          ),
          '',
        ]),
  ].join('\n'),
  'utf8',
);

writeFileSync(
  `${outDir}/report.json`,
  `${JSON.stringify({ target: baseURL, counts, blind, results, unresolved }, null, 2)}\n`,
  'utf8',
);

// ── allure ───────────────────────────────────────────────────────────────
// One case per task per language, because that is the unit of work: a task
// covering six locales with five done is not five-sixths of a pass, it is five
// passes and one failure, and the report should say which one.
const allure = allureDir(flags, bare);
if (allure !== undefined) {
  const STATUS_OF: Readonly<Record<LocaleVerdict, 'passed' | 'failed' | 'broken'>> = {
    translated: 'passed',
    still_missing: 'failed',
    // The task outlived its product. Not the store's defect and not a pass —
    // somebody has to close the task.
    product_gone: 'broken',
    not_observed: 'broken',
  };
  const SEVERITY_OF: Readonly<Record<LocaleVerdict, 'major' | 'harness' | undefined>> = {
    translated: undefined,
    still_missing: 'major',
    product_gone: 'harness',
    not_observed: 'harness',
  };

  const cases = [
    ...results.flatMap((result) =>
      Object.entries(result.byLocale).map(([locale, verdict]) => {
        const severity = SEVERITY_OF[verdict];
        return {
          name: `translated into ${locale}`,
          item: result.task.name,
          status: STATUS_OF[verdict],
          ...(severity === undefined ? {} : { severity }),
          ...(verdict === 'translated' ? {} : { detail: `${verdict}: ${result.note}` }),
          parameters: [
            { name: 'Asana task', value: result.task.gid },
            { name: 'product', value: result.task.handle ?? '(none)' },
            { name: 'verdict', value: result.verdict },
          ],
        };
      }),
    ),
    // A task with no product link is not checkable at all. Reported rather
    // than dropped: an untested task that never appears reads as a passing one.
    ...unresolved.map((task) => ({
      name: 'has a product link to check',
      item: task.name,
      status: 'broken' as const,
      severity: 'harness' as const,
      detail:
        'the Asana task names no product URL or handle, so no page could be checked. ' +
        'Adding the URL to the task is the whole fix.',
      parameters: [{ name: 'Asana task', value: task.gid }],
    })),
  ];

  writeAllureCases(
    {
      suite: 'Translations — Asana backlog',
      description:
        'For every open translation task, checks whether the product page is actually ' +
        'translated in each language the task names — title and description separately, ' +
        'because a translated title above English copy is not a finished task.',
      target: baseURL,
      resultsDir: allure,
    },
    cases,
  );
  writeEnvironment(allure, {
    Target: baseURL,
    'Ran — translation backlog': `${String(results.length)} tasks, ${String(
      unresolved.length,
    )} with no product link`,
  });
  write(`  allure: ${allure}`);
}

write('');
write(
  `  closeable ${String(counts.closeable)} | partial ${String(counts.partial)} | ` +
    `still open ${String(counts.still_open)} | stale ${String(counts.stale_product)} | ` +
    `unverified ${String(counts.unverified)}`,
);
write(`  report: ${outDir}/report.md`);

if (blind) {
  write('');
  write(`  backlog: INCOMPLETE — nothing loaded from ${baseURL}, no task was verified`);
  process.exit(2);
}
if (counts.unverified > 0) {
  write('');
  write(`  backlog: INCOMPLETE — ${String(counts.unverified)} task(s) could not be checked`);
  process.exit(2);
}
if (counts.closeable + counts.partial + counts.stale_product > 0) {
  write('');
  write(
    `  backlog: ${String(counts.closeable)} closeable, ${String(counts.partial)} partial, ` +
      `${String(counts.stale_product)} stale — the board is out of date`,
  );
  process.exit(1);
}
write('');
write('  backlog: accurate — every open task is still true');
