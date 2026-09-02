import { execFileSync } from 'node:child_process';

/**
 * Which commit produced this output.
 *
 * Three separate sessions have been spent diagnosing failures that were
 * already fixed on a branch nobody had checked out, and each time the only way
 * to tell was to notice that a quoted source line no longer existed. That is
 * archaeology, and it is avoidable: a tool that reports on a live system should
 * say which version of itself did the reporting.
 *
 * Printed at the top of every audit, so a pasted transcript answers "is this
 * current?" without anybody having to ask.
 */
export const describeBuild = (): string => {
  const git = (args: readonly string[]): string | undefined => {
    try {
      return execFileSync('git', [...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return undefined;
    }
  };

  const commit = git(['rev-parse', '--short', 'HEAD']);
  if (commit === undefined) return 'unknown (not a git checkout)';

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?';
  // Uncommitted changes mean the code that ran is not the code at that commit,
  // which matters when somebody is comparing a transcript against the tree.
  const dirty = (git(['status', '--porcelain']) ?? '') !== '';

  return `${commit} on ${branch}${dirty ? ' + uncommitted changes' : ''}`;
};
