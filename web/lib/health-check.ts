/**
 * Re-verifying the issues in a QA health-check report.
 *
 * The daily job is not "find defects" — a report already lists them. It is to
 * answer, for each claim, whether it is still true, and to raise a ticket only
 * for the ones that are. Done by hand that is an hour of opening tabs, and the
 * cost of doing it badly is asymmetric: a stale ticket wastes a developer's
 * afternoon, while a real defect marked "already fixed" ships.
 *
 * Three verdicts, and the reason there are three rather than the four the brief
 * asks for is worth stating plainly.
 *
 *   confirmed        reproduced on this environment, now. Raise a ticket.
 *   not_reproduced   not present now.
 *   unverified       the check could not run. Not a pass.
 *
 * The brief asks us to separate "already fixed" from "invalid". We cannot, and
 * saying so is more useful than guessing: both look identical in the current
 * DOM. Distinguishing them needs evidence this harness does not have — a deploy
 * that landed between the report and now, or the original reporter's session.
 * `not_reproduced` is the honest name for the pair, and the report carries the
 * issue's timestamp so a person with the deploy log can finish the job in
 * seconds. Inventing the distinction would put "invalid" next to a colleague's
 * name on a defect that was real when they filed it.
 *
 * Two environments, because the brief asks for Live and Fuego and because the
 * comparison earns its keep: an issue present on one and absent on the other is
 * a different problem from one present on both, and it is the shape that tells
 * you whether a fix has shipped or is still in staging.
 */

import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import type { Marker } from './page-markers.js';

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

/** P-levels as the health-check reports write them, mapped to our scale. */
export const SEVERITY_OF_PRIORITY: Readonly<Record<string, Severity>> = {
  P0: 'critical',
  P1: 'critical',
  P2: 'major',
  P3: 'minor',
};

export type IssueVerdict = 'confirmed' | 'not_reproduced' | 'unverified';

/** One claim from a report, in a form something can re-check. */
export type ReportedIssue = {
  readonly id: string;
  readonly title: string;
  readonly priority: string;
  /** Where it was claimed to occur. Empty means sitewide. */
  readonly paths: readonly string[];
  /**
   * The literal that identifies this defect — the locale key, the variable
   * name. Matching on it is what keeps "the reported issue is still there"
   * separate from "the page has some other marker now".
   */
  readonly needle: string;
  /**
   * A selector proving the component the issue is about was actually on the
   * page. Absent means the issue is about the page itself.
   *
   * This is the difference between "the defect is gone" and "we were not
   * looking at the thing". The 2026-04-28 issues are both in a quick-view
   * modal; if that component is not rendered on the pages sampled, no marker
   * is found and the run reports "not reproduced" — which reads as fixed and
   * is not evidence of anything. With an anchor, a page that never showed the
   * component counts as unchecked instead, which is the honest answer and the
   * one this whole repo exists to preserve.
   */
  readonly requires?: string;
  /** Which report said so, and when. Carried into the ticket. */
  readonly source: string;
  readonly reportedAt: string;
};

/** What one environment had to say about one issue. */
export type Observation = {
  readonly environment: string;
  readonly verdict: IssueVerdict;
  /** Paths actually visited. A short list here is why a verdict is weak. */
  readonly checked: readonly string[];
  /** Where it was found, when it was. */
  readonly evidence: readonly string[];
  /** Why it could not be checked. Only set when unverified. */
  readonly blocked?: string;
};

export type IssueOutcome = {
  readonly issue: ReportedIssue;
  readonly observations: readonly Observation[];
  readonly verdict: IssueVerdict;
  readonly severity: Severity;
  /** Set when environments disagree — itself worth knowing. */
  readonly divergence?: string;
};

/**
 * Rolls per-environment observations into one verdict.
 *
 * Confirmed anywhere is confirmed: a defect on Live is a defect whatever
 * staging says. The interesting case is disagreement, which is recorded rather
 * than resolved — "present on Live, absent on Fuego" usually means a fix is
 * built and not shipped, and that is a different conversation from either half
 * of it alone.
 *
 * An issue nobody could check is unverified, never "not reproduced". The
 * difference is the whole point of the exercise: one says the defect is gone,
 * the other says we did not look.
 */
export const resolveIssue = (
  issue: ReportedIssue,
  observations: readonly Observation[],
): IssueOutcome => {
  const severity = SEVERITY_OF_PRIORITY[issue.priority.toUpperCase()] ?? 'major';
  const confirmed = observations.filter((entry) => entry.verdict === 'confirmed');
  const clear = observations.filter((entry) => entry.verdict === 'not_reproduced');

  const verdict: IssueVerdict =
    confirmed.length > 0 ? 'confirmed' : clear.length > 0 ? 'not_reproduced' : 'unverified';

  const divergence =
    confirmed.length > 0 && clear.length > 0
      ? `present on ${confirmed.map((entry) => entry.environment).join(', ')}; ` +
        `absent on ${clear.map((entry) => entry.environment).join(', ')} — ` +
        'a fix that has not reached every environment, or a difference in theme version'
      : undefined;

  return {
    issue,
    observations,
    verdict,
    severity,
    ...(divergence === undefined ? {} : { divergence }),
  };
};

/** An issue whose verdict earns a ticket, and the ticket text. */
export type TicketDraft = {
  readonly issueId: string;
  readonly title: string;
  readonly severity: Severity;
  readonly body: string;
};

/**
 * Drafts a ticket. Only for confirmed issues — that is the point of checking.
 *
 * Writes what a developer needs and nothing else: where it is now, what proves
 * it, and where the claim came from. No proposed fix: the report's author
 * suggested one and it belongs to them, and a QA harness inventing a code
 * change is how a one-line locale addition turns into an argument.
 */
export const draftTicket = (outcome: IssueOutcome): TicketDraft | undefined => {
  if (outcome.verdict !== 'confirmed') return undefined;

  const found = outcome.observations.filter((entry) => entry.verdict === 'confirmed');
  const lines = [
    `Re-confirmed from ${outcome.issue.source} (reported ${outcome.issue.reportedAt}).`,
    '',
    'Still present on:',
    ...found.map(
      (entry) => `  - ${entry.environment} — ${entry.checked.length} page(s) checked`,
    ),
    '',
    'Evidence:',
    ...found.flatMap((entry) =>
      entry.evidence.map((line) => `  - ${entry.environment}: ${line}`),
    ),
    ...(outcome.divergence === undefined ? [] : ['', `Note: ${outcome.divergence}`]),
    '',
    ...(outcome.observations.some((entry) => entry.verdict === 'unverified')
      ? [
          'Not checked everywhere:',
          ...outcome.observations
            .filter((entry) => entry.verdict === 'unverified')
            .map((entry) => `  - ${entry.environment}: ${entry.blocked ?? 'reason not recorded'}`),
          '',
        ]
      : []),
    'Raised automatically by the daily health-check re-verification. The check',
    'reproduced this issue; it does not propose a fix.',
  ];

  return {
    issueId: outcome.issue.id,
    title: `[${outcome.issue.priority}] ${outcome.issue.title}`,
    severity: outcome.severity,
    body: lines.join('\n'),
  };
};

export type Summary = {
  readonly confirmed: number;
  readonly notReproduced: number;
  readonly unverified: number;
  readonly diverging: number;
  readonly tickets: number;
};

export const summarize = (outcomes: readonly IssueOutcome[]): Summary => ({
  confirmed: outcomes.filter((entry) => entry.verdict === 'confirmed').length,
  notReproduced: outcomes.filter((entry) => entry.verdict === 'not_reproduced').length,
  unverified: outcomes.filter((entry) => entry.verdict === 'unverified').length,
  diverging: outcomes.filter((entry) => entry.divergence !== undefined).length,
  tickets: outcomes.filter((entry) => draftTicket(entry) !== undefined).length,
});

/**
 * Whether the run may be called clean.
 *
 * An unverified issue blocks it. A report that says "nothing confirmed" while
 * a third of its checks could not run is the false all-clear this whole repo
 * exists to prevent, and it is most tempting exactly here — where the output
 * goes to someone who wanted good news.
 */
export const isClean = (summary: Summary): boolean =>
  summary.confirmed === 0 && summary.unverified === 0;

/** Turns markers found on a page into the evidence lines a ticket carries. */
export const evidenceFrom = (
  path: string,
  markers: readonly Marker[],
  needle: string,
): readonly string[] =>
  markers
    .filter((marker) => marker.quote.toLowerCase().includes(needle.toLowerCase()))
    .map(
      (marker) =>
        `${path} — ${marker.site.kind === 'text' ? 'visible copy' : `${marker.site.attribute} on ${marker.site.selector}`}: ${marker.quote}`,
    );

// ── config ───────────────────────────────────────────────────────────────

export type EnvironmentSpec = {
  readonly name: string;
  /** Empty when the variable it names is unset. */
  readonly baseURL: string;
  readonly optional: boolean;
};

export type HealthCheckConfig = {
  readonly environments: readonly EnvironmentSpec[];
  readonly sitewideSample: readonly string[];
  readonly issues: readonly ReportedIssue[];
  /** Business area per check name, for the report's Features view. */
  readonly features: Readonly<Record<string, string>>;
  /** What each check proves, in a sentence, for a reader outside the team. */
  readonly explanations: Readonly<Record<string, string>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`health-check.yaml: ${path} must be a non-empty string`);
  }
  return value.trim();
};

const asStrings = (value: unknown, path: string): readonly string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`health-check.yaml: ${path} must be a list`);
  return value.map((entry, index) => asString(entry, `${path}[${String(index)}]`));
};

/**
 * Expands `${VAR}` against the environment.
 *
 * A staging host and its password belong in a variable, not in a file that is
 * committed and shared. An unset variable resolves to empty rather than to the
 * literal `${VAR}`, so the caller can tell "not configured" from "configured
 * wrongly" instead of firing a browser at a URL named after a variable.
 */
const expand = (value: string): string =>
  value.replace(/\$\{(\w+)\}/gu, (_, name: string) => process.env[name] ?? '');

const asStringMap = (value: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry.trim();
  }
  return out;
};

export const loadHealthCheckConfig = (path = 'config/health-check.yaml'): HealthCheckConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.environments) || !Array.isArray(raw.issues)) {
    throw new Error(`${path}: expected "environments" and "issues"`);
  }
  if (raw.environments.length === 0) {
    // Nowhere to check is not a clean run; it is no run at all, and it would
    // report every issue as unverified while looking like it did something.
    throw new Error(`${path}: at least one environment is required`);
  }

  const environments = raw.environments.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}: environments[${String(index)}]`);
    return {
      name: asString(entry.name, `environments[${String(index)}].name`),
      baseURL: expand(asString(entry.base_url, `environments[${String(index)}].base_url`)).replace(
        /\/$/u,
        '',
      ),
      optional: entry.optional === true,
    };
  });

  const issues = raw.issues.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}: issues[${String(index)}]`);
    const at = `issues[${String(index)}]`;
    return {
      id: asString(entry.id, `${at}.id`),
      title: asString(entry.title, `${at}.title`),
      priority: asString(entry.priority, `${at}.priority`),
      paths: asStrings(entry.paths, `${at}.paths`),
      // The needle is what separates "this issue" from "some issue". Without
      // one, every marker on the page would confirm every claim.
      needle: asString(entry.needle, `${at}.needle`),
      ...(entry.requires === undefined
        ? {}
        : { requires: asString(entry.requires, `${at}.requires`) }),
      source: asString(entry.source, `${at}.source`),
      reportedAt: asString(entry.reported, `${at}.reported`),
    };
  });

  const sitewideSample = asStrings(raw.sitewide_sample, 'sitewide_sample');
  if (sitewideSample.length === 0 && issues.some((entry) => entry.paths.length === 0)) {
    throw new Error(
      `${path}: an issue has no paths, so it is sitewide, but sitewide_sample is empty. ` +
        'There would be nowhere to look and the issue would report as unverified.',
    );
  }

  return {
    environments,
    sitewideSample,
    issues,
    features: asStringMap(raw.features),
    explanations: asStringMap(raw.explanations),
  };
};

/** Paths to check for one issue: its own, or the sitewide sample. */
export const pathsFor = (
  issue: ReportedIssue,
  config: HealthCheckConfig,
): readonly string[] => (issue.paths.length > 0 ? issue.paths : config.sitewideSample);
