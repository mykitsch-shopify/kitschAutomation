import { runSync } from './lib/run.js';

/**
 * Points git at the tracked hooks directory.
 *
 * `core.hooksPath` rather than copying files into .git/hooks: a copied hook
 * silently goes stale the moment someone edits the tracked one, and nobody
 * notices because the stale copy still passes.
 */

/**
 * A build with no repository has no hooks to install, and that is fine.
 *
 * `npm install` runs this through `prepare`, and CI builds unpack a tarball
 * rather than cloning — so Heroku's build log carried "Could not set
 * core.hooksPath: fatal: not in a git directory / Run this from inside the
 * repository" on every green run. A healthy build printing an error is how
 * people learn to skim build logs, and the next line they skim is a real one.
 */
const inRepository = runSync('git', ['rev-parse', '--git-dir']).status === 0;
if (!inRepository) {
  process.stdout.write('  no git checkout here, so there are no hooks to install\n');
  process.exit(0);
}

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
