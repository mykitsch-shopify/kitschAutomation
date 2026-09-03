import { runSync } from './lib/run.js';

/**
 * Points git at the tracked hooks directory.
 *
 * `core.hooksPath` rather than copying files into .git/hooks: a copied hook
 * silently goes stale the moment someone edits the tracked one, and nobody
 * notices because the stale copy still passes.
 */
const result = runSync('git', ['config', 'core.hooksPath', '.githooks']);

if (result.notRun !== undefined || result.status !== 0) {
  process.stderr.write(
    `Could not set core.hooksPath: ${(result.notRun ?? result.output).trim()}\n` +
      'Run this from inside the repository.\n',
  );
  process.exit(1);
}

process.stdout.write(
  '\n  hooks installed — .githooks/pre-commit now runs before every commit\n' +
    '  it runs: typecheck, eslint, reviewer + bugbot, unit tests (all offline)\n' +
    '  bypass:  git commit --no-verify\n\n',
);
