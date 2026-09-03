import { mkdirSync, writeFileSync } from 'node:fs';

import { runSync } from '../lib/run.js';
import { passed, severityFor, summarize, triage } from './bugbot.js';
import type { ReviewFinding, ReviewSource } from './bugbot.js';

/**
 * Offline reviewer.
 *
 * Runs the static gates — TypeScript, ESLint, the Playwright spec standards
 * and the four Kitsch rules — collects everything into one canonical finding
 * shape, triages it through bugbot, and writes one report.
 *
 * Offline in the literal sense: no network, no model, no service. It is the
 * review that always runs, on every machine, in the same way — which is what
 * makes it worth gating on.
 *
 *   npm run review          # report, exit 0
 *   npm run review -- --gate  # exit 1 if the gate fails
 */

const OUT_DIR = 'review-report';

type EslintMessage = {
  readonly ruleId: string | null;
  readonly line?: number;
  readonly message: string;
  readonly severity: number;
};
type EslintResult = { readonly filePath: string; readonly messages: readonly EslintMessage[] };

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const relative = (path: string): string => path.replace(`${process.cwd()}/`, '');

/** ESLint carries the Playwright and Kitsch rules; the rule id says which. */
const sourceOf = (ruleId: string): ReviewSource => {
  if (ruleId.startsWith('playwright/')) return 'playwright';
  if (ruleId.startsWith('kitsch/')) return 'kitsch';
  return 'eslint';
};

const runTypeScript = (): readonly ReviewFinding[] => {
  const result = runSync('npx', ['tsc', '--noEmit', '--pretty', 'false']);
  const output = result.output;

  if (result.notRun !== undefined) {
    // tsc never started. Zero parsed errors here would read as "types are
    // clean", which is a false all-clear about code nothing has looked at.
    return [
      {
        source: 'typescript',
        rule: 'typescript/did-not-run',
        file: 'tsconfig.json',
        line: 0,
        message: result.notRun,
        severity: 'harness',
      },
    ];
  }

  // tsc reports "file(line,col): error TSxxxx: message".
  return output
    .split('\n')
    .map((line) => /^(.+?)\((\d+),\d+\):\s+error\s+(TS\d+):\s+(.*)$/u.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      source: 'typescript' as const,
      rule: match[3] ?? 'TS',
      file: relative(match[1] ?? ''),
      line: Number(match[2] ?? '0'),
      message: match[4] ?? '',
      severity: severityFor('typescript', match[3] ?? 'TS'),
    }));
};

const runEslint = (): readonly ReviewFinding[] => {
  const result = runSync('npx', ['eslint', '.', '--format', 'json']);

  // `output` is stdout and stderr combined, so the JSON does not necessarily
  // start at character zero: a deprecation warning on stderr would corrupt the
  // parse and turn a working reviewer into a crash. Start at the first `[`.
  const start = result.output.indexOf('[');
  const json = start === -1 ? '' : result.output.slice(start).trim();
  if (json === '') {
    // ESLint could not run at all. That is harness debt, and reporting it as
    // "no findings" would be a false all-clear.
    return [
      {
        source: 'eslint',
        rule: 'eslint/did-not-run',
        file: 'eslint.config.js',
        line: 0,
        message:
          result.notRun ??
          `ESLint produced no output: ${result.output.split('\n')[0] ?? 'unknown error'}`,
        severity: 'harness',
      },
    ];
  }

  const results = JSON.parse(json) as readonly EslintResult[];
  return results.flatMap((file) =>
    file.messages.map((message) => {
      const rule = message.ruleId ?? 'eslint/parse-error';
      const source = sourceOf(rule);
      return {
        source,
        rule,
        file: relative(file.filePath),
        line: message.line ?? 0,
        message: message.message,
        severity: message.ruleId === null ? ('harness' as const) : severityFor(source, rule),
      };
    }),
  );
};

const report = (findings: readonly ReviewFinding[]): string => {
  const summary = summarize(findings);
  const lines = [
    '# Offline review',
    '',
    `critical ${String(summary.critical)} · major ${String(summary.major)} · minor ${String(summary.minor)} · harness ${String(summary.harness)}`,
    '',
    `Gate: **${passed(summary) ? 'PASS' : 'FAIL'}**`,
    '',
  ];

  const bySource = new Map<string, ReviewFinding[]>();
  for (const finding of findings) {
    bySource.set(finding.source, [...(bySource.get(finding.source) ?? []), finding]);
  }

  for (const [source, group] of bySource) {
    lines.push(`## ${source} — ${String(group.length)}`, '');
    lines.push('| severity | route | rule | location | message |');
    lines.push('|---|---|---|---|---|');
    for (const finding of group) {
      const routed = triage(finding);
      lines.push(
        `| ${finding.severity} | ${routed.route} | \`${finding.rule}\` | ${finding.file}:${String(finding.line)} | ${finding.message.replace(/\|/gu, '\\|')} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
};

const gate = process.argv.includes('--gate');

write('Offline review — typescript, eslint, playwright standards, kitsch rules');
write('');

const findings = [...runTypeScript(), ...runEslint()];
const summary = summarize(findings);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/review.json`,
  JSON.stringify(
    { summary, passed: passed(summary), findings: findings.map((f) => ({ ...f, triage: triage(f) })) },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(`${OUT_DIR}/review.md`, report(findings), 'utf8');

for (const finding of findings.slice(0, 20)) {
  write(
    `  ${finding.severity.padEnd(8)} ${finding.rule.padEnd(38)} ${finding.file}:${String(finding.line)}`,
  );
}
if (findings.length > 20) {
  write(`  … and ${String(findings.length - 20)} more (see ${OUT_DIR}/review.md)`);
}

write('');
write(
  `critical ${String(summary.critical)} | major ${String(summary.major)} | minor ${String(summary.minor)} | harness ${String(summary.harness)}`,
);
write(`report: ${OUT_DIR}/review.json, ${OUT_DIR}/review.md`);

if (passed(summary)) {
  write('review: PASS');
  process.exitCode = 0;
} else {
  console.error('Offline review gate failed — see the report for routing.');
  process.exitCode = gate ? 1 : 0;
}
