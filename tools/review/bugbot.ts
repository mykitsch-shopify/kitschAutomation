import type { Severity } from '../../i18n/lib/config.js';

/**
 * Triage — the routing half of the review loop.
 *
 * Deliberately a lookup table, not a classifier. The framework already fixed
 * four severities and four routes; the only decision left is which bucket a
 * finding lands in, and that is decided by where it came from, not by
 * judgement at report time.
 *
 * The distinction that matters most in this stack: a harness fault is *our*
 * debt. It is tracked and it never escalates to the client, because reporting
 * our own outage as a defect is how engineering trust gets spent.
 */

export type ReviewSource = 'typescript' | 'eslint' | 'playwright' | 'kitsch' | 'parity';

export type ReviewFinding = {
  readonly source: ReviewSource;
  readonly rule: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly severity: Severity;
};

export type Route = 'slack-immediate' | 'asana-same-day' | 'asana-backlog' | 'our-backlog';

export type Triage = {
  readonly severity: Severity;
  readonly route: Route;
  readonly sla: string;
  readonly reportToClient: boolean;
};

const TRIAGE: Readonly<Record<Severity, Omit<Triage, 'severity'>>> = {
  critical: { route: 'slack-immediate', sla: '1 hour, named owner', reportToClient: true },
  major: { route: 'asana-same-day', sla: 'same business day', reportToClient: true },
  minor: { route: 'asana-backlog', sla: 'next launch cycle', reportToClient: true },
  // Never routed to the client. See the module comment.
  harness: { route: 'our-backlog', sla: 'no client SLA', reportToClient: false },
};

export const triage = (finding: ReviewFinding): Triage => ({
  severity: finding.severity,
  ...TRIAGE[finding.severity],
});

/**
 * Severity for a static-analysis finding.
 *
 * Rules that describe a defect the customer can meet are `major`; rules about
 * how the suite is written are `minor`; anything that means the *review* could
 * not run is `harness`, because a review that failed to execute is not a clean
 * review.
 */
const MAJOR_RULES: readonly string[] = [
  'kitsch/no-prod-target',
  'kitsch/no-write-operation',
  'kitsch/no-hardcoded-price',
  'playwright/no-conditional-expect',
  'playwright/no-conditional-in-test',
  'playwright/expect-expect',
  'playwright/no-wait-for-timeout',
  'playwright/no-force-option',
];

export const severityFor = (source: ReviewSource, rule: string): Severity => {
  if (source === 'typescript') {
    // It does not compile. Nothing downstream of this is trustworthy.
    return 'major';
  }
  if (MAJOR_RULES.includes(rule)) {
    return 'major';
  }
  return 'minor';
};

export type Summary = {
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly harness: number;
};

export const summarize = (findings: readonly ReviewFinding[]): Summary => ({
  critical: findings.filter((finding) => finding.severity === 'critical').length,
  major: findings.filter((finding) => finding.severity === 'major').length,
  minor: findings.filter((finding) => finding.severity === 'minor').length,
  harness: findings.filter((finding) => finding.severity === 'harness').length,
});

/**
 * The gate. Harness findings are excluded on purpose: our own tooling failing
 * must not block the client's merge, and hiding it inside a pass/fail number
 * is how it stops getting fixed.
 */
export const passed = (summary: Summary): boolean =>
  summary.critical === 0 && summary.major === 0;
