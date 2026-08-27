import { existsSync, rmSync } from 'node:fs';

/**
 * Removes report directories, so the next run reports on the next run.
 *
 *   npm run report:clean                                  # the default pair
 *   npm run report:clean -- allure-results-live           # a named directory
 *   npm run report:clean -- allure-results-live allure-report-live
 *
 * Two kinds of directory, and the difference is the reason this exists rather
 * than being folded into the reporter:
 *
 *   results  — what a suite wrote. Input. Deleting it at report time would
 *              delete the very thing about to be read, and a daily run fills
 *              one directory from six audits plus the specs.
 *   report   — what allure generated from those results. Derived, and
 *              rebuilt every time, so `npm run report` clears it on its own.
 *
 * `npm run daily` clears its own results directory at the start of the run,
 * because it starts every stage that writes there. A directory filled by
 * `KITSCH_ALLURE=... npx playwright test` has no such owner: nothing knows when
 * that run began, so nothing can safely decide the contents are stale. That is
 * this command's job, and the reason it is a command rather than a behaviour.
 *
 * Leaving results behind is not a tidiness problem. Allure reports on whatever
 * is in the directory, so an old run's results are silently folded into the new
 * run's report: a check that was skipped appears to have run, and a defect
 * already fixed is still on the front page. Both read as facts about the store.
 */

const DEFAULTS = ['allure-results', 'allure-report'] as const;

/**
 * Only report directories, and only here.
 *
 * This command exists to be typed quickly while tired, next to a deadline,
 * which is exactly when `report:clean -- .` gets typed. A recursive delete
 * deserves a guard that does not depend on the person being careful.
 */
const isReportDirectory = (name: string): boolean =>
  /^[\w.-]+$/u.test(name) && !name.startsWith('.') && /(^allure|-report$|-results$)/u.test(name);

const targets = process.argv.slice(2);
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const refused = targets.filter((name) => !isReportDirectory(name));
if (refused.length > 0) {
  process.stderr.write(
    `Refusing to delete: ${refused.join(', ')}\n` +
      'This removes directories recursively, so it only accepts a plain name in the\n' +
      'repository root that starts with "allure" or ends in "-report" or "-results".\n' +
      'Delete anything else by hand, where the consequences are visible.\n',
  );
  process.exit(2);
}

write('');
for (const name of targets.length > 0 ? targets : DEFAULTS) {
  if (existsSync(name)) {
    rmSync(name, { recursive: true, force: true });
    write(`  removed  ${name}`);
  } else {
    write(`  absent   ${name}`);
  }
}
write('');
