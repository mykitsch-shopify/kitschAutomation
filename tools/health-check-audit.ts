import { mkdirSync, writeFileSync } from 'node:fs';

import type { BrowserContext } from '@playwright/test';

import {
  draftTicket,
  evidenceFrom,
  isClean,
  loadHealthCheckConfig,
  pathsFor,
  resolveIssue,
  summarize,
  type EnvironmentSpec,
  type HealthCheckConfig,
  type IssueOutcome,
  type Observation,
  type ReportedIssue,
} from '../web/lib/health-check.js';
import {
  findMarkers,
  SPOKEN_ATTRIBUTES,
  type ObservedAttribute,
} from '../web/lib/page-markers.js';
import { allureDir, buildMatrix, writeAllureCases, writeEnvironment } from './lib/allure.js';
import { launchFromArgs } from './lib/browser.js';

/**
 * Daily re-verification of the issues in a QA health-check report.
 *
 *   npm run audit:health-check
 *   npm run audit:health-check -- --allure allure-results
 *
 * Every issue in config/health-check.yaml is a claim someone made. This asks
 * each one the only question worth asking daily — is it still true? — on every
 * configured environment, and drafts a ticket for the ones that are.
 *
 * What it refuses to do is call an issue "invalid". A defect absent from the
 * DOM today is either fixed or was never real, and nothing visible from here
 * separates those. Both are reported as "not reproduced", with the date of the
 * original report attached so a person holding the deploy log can finish the
 * job. The alternative is writing "invalid" next to a colleague's name on a
 * defect that was real when they filed it.
 */

const flags = new Map<string, string>();
const bare = new Set<string>();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      bare.add(name);
    } else {
      flags.set(name, next);
      i += 1;
    }
  }
}

const outDir = flags.get('out') ?? 'health-check-report';
const configPath = flags.get('config') ?? 'config/health-check.yaml';
const date = flags.get('date') ?? new Date().toISOString().slice(0, 10);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

let config: HealthCheckConfig;
try {
  config = loadHealthCheckConfig(configPath);
} catch (error) {
  process.stderr.write(`\n  ${(error as Error).message}\n\n`);
  process.exit(2);
}

write('');
write('Health-check re-verification');
write('');
write(`  issues   ${String(config.issues.length)} from previous QA report(s)`);

/** Environments with somewhere to point a browser. */
const configured = config.environments.filter((environment) => environment.baseURL !== '');
const unconfigured = config.environments.filter((environment) => environment.baseURL === '');

for (const environment of configured) {
  write(`  ${environment.name.padEnd(8)} ${environment.baseURL}`);
}
for (const environment of unconfigured) {
  // Named, not silently dropped. An environment nobody checked is a hole in
  // the day's coverage, and a hole nobody mentions reads as coverage.
  write(
    `  ${environment.name.padEnd(8)} not configured — ${
      environment.optional ? 'skipped' : 'REQUIRED and missing'
    }`,
  );
}
write('');

if (configured.length === 0) {
  process.stderr.write(
    '  No environment has a URL. Nothing was checked.\n' +
      '  Set KITSCH_BASE_URL (and KITSCH_FUEGO_URL for the staging comparison).\n\n',
  );
  process.exit(2);
}

/**
 * Reads a page the way both audiences receive it: the visible text a shopper
 * reads, and the attribute values a screen reader speaks.
 *
 * The second half is the reason this exists. The 2026-04-28 report's two
 * findings split exactly across it, and a scan of visible text alone confirms
 * one and passes the other.
 */
const snapshot = async (
  context: BrowserContext,
  baseURL: string,
  path: string,
): Promise<{ readonly text: string; readonly attributes: readonly ObservedAttribute[] }> => {
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}${path}`, { waitUntil: 'load', timeout: 60_000 });
    const text = await page.locator('body').innerText();
    // Deliberately flat: no helper functions inside this callback.
    //
    // tsx compiles with esbuild's keepNames, which wraps every named function
    // in a `__name(...)` call. The wrapper exists in Node and not in the page,
    // so a nested helper here serialises into the browser as a reference to
    // something undefined and every evaluate throws `__name is not defined` —
    // which the audit then reports as "could not check" on every page. Caught
    // by the detection control; against a real storefront it would have looked
    // like the whole site was unreachable.
    const attributes = await page.evaluate((names: readonly string[]) => {
      const found: { selector: string; attribute: string; value: string }[] = [];
      for (const name of names) {
        for (const element of Array.from(document.querySelectorAll(`[${name}]`))) {
          const value = element.getAttribute(name);
          if (value === null || value.trim() === '') continue;
          const tag = element.tagName.toLowerCase();
          const cls = element.classList.length > 0 ? `.${element.classList[0] ?? ''}` : '';
          found.push({ selector: `${tag}${cls}`, attribute: name, value });
        }
      }
      return found;
    }, SPOKEN_ATTRIBUTES);
    return { text, attributes };
  } finally {
    await page.close();
  }
};

const { browser, context } = await launchFromArgs(flags, bare, write, 'browser ');
write('');

/** Re-checks one issue against one environment. */
const observe = async (
  issue: ReportedIssue,
  environment: EnvironmentSpec,
): Promise<Observation> => {
  const paths = pathsFor(issue, config);
  const checked: string[] = [];
  const evidence: string[] = [];
  const blocked: string[] = [];

  for (const path of paths) {
    try {
      const page = await snapshot(context, environment.baseURL, path);
      checked.push(path);
      evidence.push(
        ...evidenceFrom(
          path,
          findMarkers({ url: `${environment.baseURL}${path}`, ...page }),
          issue.needle,
        ),
      );
    } catch (error) {
      blocked.push(`${path}: ${(error as Error).message.split('\n')[0] ?? 'unknown'}`);
    }
  }

  if (evidence.length > 0) {
    return { environment: environment.name, verdict: 'confirmed', checked, evidence };
  }
  // Nothing found — but only meaningful if anything was actually looked at.
  // A page that would not load says nothing about whether the defect is gone.
  if (checked.length === 0) {
    return {
      environment: environment.name,
      verdict: 'unverified',
      checked,
      evidence,
      blocked: blocked.join('; '),
    };
  }
  return { environment: environment.name, verdict: 'not_reproduced', checked, evidence };
};

const outcomes: IssueOutcome[] = [];

for (const issue of config.issues) {
  process.stdout.write(`  ${issue.id.padEnd(20)} ${issue.title.slice(0, 44).padEnd(46)}`);
  const observations: Observation[] = [];
  for (const environment of configured) {
    observations.push(await observe(issue, environment));
  }
  for (const environment of unconfigured) {
    observations.push({
      environment: environment.name,
      verdict: 'unverified',
      checked: [],
      evidence: [],
      blocked: 'no URL configured for this environment',
    });
  }
  const outcome = resolveIssue(issue, observations);
  outcomes.push(outcome);
  write(
    outcome.verdict === 'confirmed'
      ? 'STILL PRESENT'
      : outcome.verdict === 'not_reproduced'
        ? 'not reproduced'
        : 'COULD NOT CHECK',
  );
}

await context.close();
await browser.close();

const summary = summarize(outcomes);
const tickets = outcomes.flatMap((outcome) => draftTicket(outcome) ?? []);

// ── written record ───────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true });

writeFileSync(
  `${outDir}/report.md`,
  [
    `# Health-check re-verification — ${date}`,
    '',
    `- environments checked: ${configured.map((entry) => `${entry.name} (${entry.baseURL})`).join(', ')}`,
    ...(unconfigured.length > 0
      ? [`- **not checked**: ${unconfigured.map((entry) => entry.name).join(', ')}`]
      : []),
    '',
    `confirmed ${String(summary.confirmed)} · not reproduced ${String(summary.notReproduced)} · could not check ${String(summary.unverified)}`,
    '',
    '"Not reproduced" means the defect is absent today. It does not distinguish',
    '"fixed" from "never valid" — that needs the deploy log, not the DOM.',
    '',
    '| issue | from | verdict | environments |',
    '|---|---|---|---|',
    ...outcomes.map(
      (outcome) =>
        `| ${outcome.issue.id} — ${outcome.issue.title} | ${outcome.issue.reportedAt} | ${outcome.verdict} | ` +
        `${outcome.observations.map((entry) => `${entry.environment}: ${entry.verdict}`).join('; ')} |`,
    ),
    '',
    ...outcomes
      .filter((outcome) => outcome.divergence !== undefined)
      .flatMap((outcome) => [
        `### ${outcome.issue.id} — environments disagree`,
        '',
        outcome.divergence ?? '',
        '',
      ]),
    // Why a check could not run, verbatim. Without this the report says
    // "could not check" and leaves the reader to reproduce it themselves,
    // which is the moment they stop reading the report.
    ...outcomes
      .flatMap((outcome) =>
        outcome.observations
          .filter((entry) => entry.verdict === 'unverified')
          .map((entry) => ({ outcome, entry })),
      )
      .flatMap(({ outcome, entry }) => [
        `### ${outcome.issue.id} — could not check on ${entry.environment}`,
        '',
        '```',
        entry.blocked ?? 'reason not recorded',
        '```',
        '',
      ]),
    ...(tickets.length === 0
      ? ['No tickets drafted.', '']
      : [
          `## ${String(tickets.length)} ticket(s) drafted`,
          '',
          ...tickets.flatMap((ticket) => [
            `### ${ticket.title}`,
            '',
            '```',
            ticket.body,
            '```',
            '',
          ]),
        ]),
  ].join('\n'),
  'utf8',
);

writeFileSync(`${outDir}/tickets.json`, `${JSON.stringify(tickets, null, 2)}\n`, 'utf8');

// ── allure ───────────────────────────────────────────────────────────────
const resultsDir = allureDir(flags, bare);
if (resultsDir !== undefined) {
  const target = configured.map((entry) => entry.baseURL).join(' + ');
  writeEnvironment(resultsDir, {
    Target: target,
    'Ran — health-check re-verification': `${String(config.issues.length)} issue(s) from previous reports`,
  });

  // One case per issue per environment: a reader can see at a glance that an
  // issue was confirmed on Live and clear on Fuego, which is the single most
  // actionable shape in this whole report.
  writeAllureCases(
    {
      suite: 'Daily — report validation',
      description:
        'Issues from previous QA reports, re-checked against each environment today. ' +
        'A pass means the issue could not be reproduced; a failure means it is still present.',
      target,
      resultsDir,
      feature: 'Report validation',
    },
    buildMatrix({
      items: outcomes.map((outcome) => `${outcome.issue.id} — ${outcome.issue.title}`),
      checks: [...configured, ...unconfigured].map((entry) => entry.name),
      findings: outcomes.flatMap((outcome) =>
        outcome.observations
          .filter((entry) => entry.verdict !== 'not_reproduced')
          .map((entry) => ({ outcome, entry })),
      ),
      itemOf: ({ outcome }) => `${outcome.issue.id} — ${outcome.issue.title}`,
      checkOf: ({ entry }) => entry.environment,
      severityOf: ({ outcome, entry }) =>
        entry.verdict === 'unverified' ? 'harness' : outcome.severity,
      detailOf: ({ outcome, entry }) =>
        entry.verdict === 'unverified'
          ? `could not check: ${entry.blocked ?? 'reason not recorded'}`
          : `still present (reported ${outcome.issue.reportedAt} in ${outcome.issue.source}) — ${entry.evidence.join(' | ')}`,
      featureOf: () => config.features.issue_recheck ?? 'Report validation',
      whyOf: () => config.explanations.issue_recheck,
    }),
  );
  write(`  allure    ${resultsDir}`);
}

write('');
write(
  `  confirmed ${String(summary.confirmed)} | not reproduced ${String(summary.notReproduced)} | could not check ${String(summary.unverified)}`,
);
write(`  report:   ${outDir}/report.md`);
if (tickets.length > 0) write(`  tickets:  ${String(tickets.length)} drafted in ${outDir}/tickets.json`);
write('');

// Exit 2 for "could not check" so nothing downstream reads an unfinished run
// as a clean one; 1 when a reported issue is still live.
if (summary.confirmed > 0) {
  write('  Issues from previous reports are still present. Tickets drafted above.');
  write('');
  process.exit(1);
}
if (!isClean(summary)) {
  write('  Some issues could not be checked. This is not a clean bill of health.');
  write('');
  process.exit(2);
}
write('  Every reported issue re-checked and none reproduced.');
write('');
