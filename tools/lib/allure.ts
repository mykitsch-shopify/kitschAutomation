import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { FileSystemWriter, ReporterRuntime } from 'allure-js-commons/sdk/reporter';
import { type Category } from 'allure-js-commons/sdk';
import { LabelName, Stage, Status } from 'allure-js-commons';

/**
 * Allure results for the parts of this suite that are not Playwright tests.
 *
 * Six of the eight things this repo runs are audit CLIs, not specs. Left to
 * `allure-playwright` alone the report would show the 357 render specs and
 * silently omit every daily check — compare-at, top-10, ad-landing,
 * translations, accessibility — which is precisely the half a reader outside
 * the team cares about. So the audits emit their own results into the same
 * directory and the report is assembled from all of them.
 *
 * Two decisions here are not cosmetic:
 *
 *   1. A case is emitted for every check that ran, not only for the ones that
 *      failed. A report listing four failures out of four cases reads as a
 *      store on fire; the same four out of six hundred reads as a store with
 *      four problems. Coverage is the denominator and it has to be visible.
 *
 *   2. `harness` maps to BROKEN, never to PASSED or FAILED. It means we could
 *      not perform the check. Allure renders broken separately from failed,
 *      which is the only honest place for it: it is not a store defect, and it
 *      is emphatically not a pass.
 */

/** Our four-level model. Mirrors Severity in the web/lib modules. */
export type KitschSeverity = 'critical' | 'major' | 'minor' | 'harness';

export type CaseStatus = 'passed' | 'failed' | 'broken' | 'skipped';

export type AllureCase = {
  /** The check performed, e.g. "add to cart". Becomes the test name. */
  readonly name: string;
  /** The thing checked, e.g. a product handle or a locale. Groups the report. */
  readonly item: string;
  readonly status: CaseStatus;
  /** Absent on a pass. */
  readonly severity?: KitschSeverity;
  /** Why it failed, or why it could not be checked. */
  readonly detail?: string;
  readonly parameters?: readonly { readonly name: string; readonly value: string }[];
  /**
   * The business area this check belongs to — "Pricing", "Promotions",
   * "Accessibility". Drives Allure's Features view, which is where a reader
   * who does not work here starts.
   *
   * Falls back to the suite's own feature, then to the suite name, so an audit
   * that has not been given one still lands somewhere sensible.
   */
  readonly feature?: string;
  /**
   * What passing this check would prove, in a sentence, for someone who has
   * never seen this repo. Shown on the test's page in the report.
   *
   * A check named "compare_at_still_rendered" is meaningless to the person the
   * report is for, and they are the reason the report exists.
   */
  readonly why?: string;
};

export type SuiteMeta = {
  /** Top-level grouping in the report, e.g. "Daily — top 10 products". */
  readonly suite: string;
  /** What the suite is for, in one sentence a non-tester can read. */
  readonly description: string;
  /** The storefront these results are about. */
  readonly target: string;
  readonly resultsDir: string;
  /**
   * The programme every suite belongs to. One value across the whole report,
   * so Allure's Behaviors view opens on a single tree rather than eight
   * unrelated roots.
   */
  readonly epic?: string;
  /** Default business area for cases that do not name their own. */
  readonly feature?: string;
};

/** The programme name, unless a suite says otherwise. */
const DEFAULT_EPIC = 'Kitsch storefront QA';

/**
 * Our severity to Allure's. Allure's scale is fixed and its top level is
 * "blocker", so ours shifts up one: a critical finding here is a blocker
 * there, and Allure's "critical" carries our "major".
 */
const ALLURE_SEVERITY: Readonly<Record<KitschSeverity, string>> = {
  critical: 'blocker',
  major: 'critical',
  minor: 'minor',
  harness: 'normal',
};

const STATUS: Readonly<Record<CaseStatus, Status>> = {
  passed: Status.PASSED,
  failed: Status.FAILED,
  broken: Status.BROKEN,
  skipped: Status.SKIPPED,
};

/**
 * Prefixes the failure message so Allure's category rules can sort findings by
 * our severity. Categories match on the message, which is the only field they
 * can see — the severity label is not available to them.
 */
const message = (item: AllureCase): string => {
  const prefix = item.severity === undefined ? '' : `[${item.severity}] `;
  return `${prefix}${item.detail ?? 'no detail recorded'}`;
};

/**
 * The buckets a reader sees on the report's front page.
 *
 * Ordered by what someone would act on first, and worded for someone who does
 * not work on this repo. "Could not check" is last but is deliberately not
 * called a pass anywhere in the wording.
 */
export const CATEGORIES: readonly Category[] = [
  {
    name: 'Critical — customer cannot buy',
    description:
      'A defect that blocks a purchase or shows a wrong price. Fix before the next ad spend.',
    matchedStatuses: [Status.FAILED],
    messageRegex: '\\[critical\\].*',
  },
  {
    name: 'Major — customer sees something wrong',
    description: 'Visible to a shopper and damaging, but the purchase still completes.',
    matchedStatuses: [Status.FAILED],
    messageRegex: '\\[major\\].*',
  },
  {
    name: 'Minor — cosmetic or low impact',
    description: 'Worth fixing, does not need to block a release.',
    matchedStatuses: [Status.FAILED],
    messageRegex: '\\[minor\\].*',
  },
  {
    name: 'Could not check — NOT a pass',
    description:
      'The harness could not observe this. It is not evidence the store is fine, and it is not a store defect. Someone needs to fix the check.',
    matchedStatuses: [Status.BROKEN],
  },
];

/**
 * Writes one Allure result per case into `resultsDir`.
 *
 * Safe to call from several audits against the same directory: Allure keys
 * results by uuid, so each run appends rather than overwriting, and the report
 * is the union of everything present.
 */
export const writeAllureCases = (meta: SuiteMeta, cases: readonly AllureCase[]): void => {
  mkdirSync(meta.resultsDir, { recursive: true });

  const runtime = new ReporterRuntime({
    writer: new FileSystemWriter({ resultsDir: meta.resultsDir }),
    categories: [...CATEGORIES],
  });

  const now = Date.now();

  for (const item of cases) {
    const uuid = runtime.startTest({
      name: `${item.item} — ${item.name}`,
      fullName: `${meta.suite} > ${item.item} > ${item.name}`,
      // Stable across runs, so Allure can show this check's history rather
      // than treating every night as a brand new test.
      historyId: `${meta.suite}|${item.item}|${item.name}`,
      // Suite purpose first, then what this specific check proves. A reader
      // landing on one failed case should not have to find the suite to learn
      // what was being asked.
      description:
        item.why === undefined ? meta.description : `${item.why}\n\n${meta.description}`,
      start: now,
      labels: [
        { name: LabelName.PARENT_SUITE, value: meta.suite },
        { name: LabelName.SUITE, value: item.item },
        // Behaviors view: Epic → Feature → Story reads as
        // programme → business area → scenario. Feature used to repeat the
        // suite name, which made that whole view a second copy of the suite
        // tree and told a reader nothing they did not already have.
        { name: LabelName.EPIC, value: meta.epic ?? DEFAULT_EPIC },
        { name: LabelName.FEATURE, value: item.feature ?? meta.feature ?? meta.suite },
        { name: LabelName.STORY, value: item.name },
        { name: LabelName.LAYER, value: 'audit' },
        { name: LabelName.FRAMEWORK, value: 'kitsch-audit' },
        ...(item.severity === undefined
          ? []
          : [{ name: LabelName.SEVERITY, value: ALLURE_SEVERITY[item.severity] }]),
      ],
    });

    runtime.updateTest(uuid, (result) => {
      result.status = STATUS[item.status];
      result.stage = Stage.FINISHED;
      result.parameters = [
        { name: 'target', value: meta.target },
        ...(item.parameters ?? []).map((param) => ({ name: param.name, value: param.value })),
      ];
      if (item.status !== 'passed' && item.status !== 'skipped') {
        result.statusDetails = { message: message(item) };
      }
    });

    runtime.stopTest(uuid, { stop: now });
    runtime.writeTest(uuid);
  }

  runtime.writeCategoriesDefinitions();
};

/**
 * Builds the full case matrix for an audit: every item crossed with every
 * check, resolved against the findings that were actually raised.
 *
 * This is what stops the report from being a list of failures. The audit knows
 * which items it visited and which checks it ran; without both, a reader
 * cannot tell "we checked 60 things and 3 broke" from "we checked 3 things".
 */
export const buildMatrix = <TFinding>(options: {
  readonly items: readonly string[];
  readonly checks: readonly string[];
  readonly findings: readonly TFinding[];
  /** Which item a finding belongs to. Must match a value in `items`. */
  readonly itemOf: (finding: TFinding) => string;
  /** Which check raised it. A finding outside `checks` is reported separately. */
  readonly checkOf: (finding: TFinding) => string;
  readonly severityOf: (finding: TFinding) => KitschSeverity;
  readonly detailOf: (finding: TFinding) => string;
  /** Checks disabled by config: reported as skipped, never as passed. */
  readonly skipped?: readonly string[];
  /** Business area for a check, for the report's Features view. */
  readonly featureOf?: (check: string) => string | undefined;
  /** What passing this check proves, for a reader who has never seen it. */
  readonly whyOf?: (check: string) => string | undefined;
}): readonly AllureCase[] => {
  const skipped = new Set(options.skipped ?? []);
  const cases: AllureCase[] = [];

  /** Attached to every case for a check, whatever its status. */
  const labelling = (check: string): Pick<AllureCase, 'feature' | 'why'> => {
    const feature = options.featureOf?.(check);
    const why = options.whyOf?.(check);
    return {
      ...(feature === undefined ? {} : { feature }),
      ...(why === undefined ? {} : { why }),
    };
  };

  // Findings whose item or check is outside the matrix — config problems,
  // unresolved handles, run-level failures. Dropping them would lose real
  // findings, so they become their own cases rather than disappearing.
  const known = new Set(options.items);
  const knownChecks = new Set(options.checks);
  const orphans = options.findings.filter(
    (finding) => !known.has(options.itemOf(finding)) || !knownChecks.has(options.checkOf(finding)),
  );

  for (const item of options.items) {
    for (const check of options.checks) {
      if (skipped.has(check)) {
        cases.push({ name: check, item, status: 'skipped', ...labelling(check) });
        continue;
      }
      const hits = options.findings.filter(
        (finding) => options.itemOf(finding) === item && options.checkOf(finding) === check,
      );
      if (hits.length === 0) {
        cases.push({ name: check, item, status: 'passed', ...labelling(check) });
        continue;
      }
      // Worst severity wins the case; every detail is kept in the message so
      // a second problem on the same check is not silently dropped.
      const worst = hits.reduce((left, right) =>
        RANK[options.severityOf(left)] <= RANK[options.severityOf(right)] ? left : right,
      );
      const severity = options.severityOf(worst);
      cases.push({
        name: check,
        item,
        status: severity === 'harness' ? 'broken' : 'failed',
        severity,
        detail: hits.map((finding) => options.detailOf(finding)).join(' | '),
        ...labelling(check),
      });
    }
  }

  for (const finding of orphans) {
    const severity = options.severityOf(finding);
    cases.push({
      name: options.checkOf(finding),
      item: options.itemOf(finding),
      status: severity === 'harness' ? 'broken' : 'failed',
      severity,
      detail: options.detailOf(finding),
      ...labelling(options.checkOf(finding)),
    });
  }

  return cases;
};

const RANK: Readonly<Record<KitschSeverity, number>> = {
  critical: 0,
  major: 1,
  harness: 2,
  minor: 3,
};

/**
 * Resolves `--allure` / `--allure <dir>` into a results directory.
 *
 * Off unless asked for. Emitting Allure results on every audit run would leave
 * a directory that silently accumulates results from unrelated runs — and a
 * report assembled from a fixture run and a live run mixed together is worse
 * than no report.
 */
export const allureDir = (
  flags: ReadonlyMap<string, string>,
  bare: ReadonlySet<string>,
): string | undefined => flags.get('allure') ?? (bare.has('allure') ? 'allure-results' : undefined);

/**
 * Environment block shown at the top of the report.
 *
 * The target is first and unabbreviated. A report read a week later, out of
 * the terminal that produced it, must state on its face whether it is about
 * mykitsch.com or about a fixture on localhost — that distinction is the
 * difference between evidence and a self-test.
 */
export const ENV_SIDECAR = 'kitsch-environment.json';

export const writeEnvironment = (
  resultsDir: string,
  entries: Readonly<Record<string, string>>,
): void => {
  mkdirSync(resultsDir, { recursive: true });
  const path = `${resultsDir}/${ENV_SIDECAR}`;

  // Written to a sidecar rather than straight to environment.properties.
  //
  // `allure-playwright` *overwrites* environment.properties when it finishes,
  // and in a full daily run the specs finish last — so writing there directly
  // meant the report's environment block listed one line, Target, and had
  // silently dropped every audit's record of what it had run. Caught by
  // reading the rendered report; the file each audit wrote looked correct.
  //
  // tools/allure-report.ts folds this back in just before generating.
  const existing = existsSync(path)
    ? new Map<string, string>(
        Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>),
      )
    : new Map<string, string>();

  for (const [key, value] of Object.entries(entries)) {
    const prior = existing.get(key);
    // Two audits reporting different targets means the report mixes a fixture
    // run with a live one. Show both rather than letting the second quietly
    // relabel the first — the whole report's meaning turns on this field.
    existing.set(
      key,
      prior === undefined || prior === value ? value : `${prior} + ${value} (MIXED)`,
    );
  }

  writeFileSync(path, `${JSON.stringify(Object.fromEntries(existing), null, 2)}\n`, 'utf8');
};

/** Reads the sidecar back. Empty when no audit contributed to this run. */
export const readEnvironmentSidecar = (resultsDir: string): Map<string, string> => {
  const path = `${resultsDir}/${ENV_SIDECAR}`;
  if (!existsSync(path)) return new Map<string, string>();
  return new Map<string, string>(
    Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>),
  );
};

/**
 * Java `.properties` escaping for the key side.
 *
 * A key is terminated by the first unescaped space, `=` or `:`. Without this,
 * `Ran — top 10 products=…` is read as the key `Ran` with the rest as its
 * value, and the report's environment block shows four entries all called
 * something different from what was written. Found by reading the rendered
 * report rather than the file we wrote — the file looked perfect.
 */
const escapeKey = (key: string): string => key.replace(/([\s=:#!\\])/gu, '\\$1');

export const serialiseProperties = (entries: ReadonlyMap<string, string>): string => {
  const lines = [...entries].map(([key, value]) => `${escapeKey(key)}=${value}`);
  return `${lines.join('\n')}\n`;
};

/** The inverse of `serialiseProperties`, for the merge on the next write. */
export const parseProperties = (raw: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    // The separator is the first `=` that is not itself escaped.
    let at = -1;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== '=') continue;
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j -= 1) backslashes += 1;
      if (backslashes % 2 === 0) {
        at = i;
        break;
      }
    }
    if (at <= 0) continue;
    out.set(line.slice(0, at).replace(/\\(.)/gu, '$1'), line.slice(at + 1));
  }
  return out;
};
