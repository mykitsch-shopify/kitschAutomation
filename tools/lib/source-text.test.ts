import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

/**
 * Every tracked source file is text.
 *
 * Not a theoretical concern. `web/lib/uniform-failure.ts` was committed with two
 * NUL bytes in it, where a space was intended in a Map key. TypeScript compiled
 * it, ESLint passed it, all eight of its own unit tests passed, and the reviewer
 * gate said nothing — a NUL inside a template literal is legal JavaScript.
 *
 * What it broke was git. A file containing NUL is binary as far as git is
 * concerned, so `git diff` rendered it as "Bin 0 -> 4907 bytes" and `git apply`
 * refused the patch with "cannot apply binary patch without full index line".
 * The failure surfaced two machines and one working day away from the edit that
 * caused it, as a patch that would not apply for no visible reason.
 *
 * Cheap to check, and the only gate positioned to see it.
 */

const tracked = (): readonly string[] => {
  const result = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) return [];
  return result.stdout.split('\0').filter((path) => path !== '');
};

const TEXT = /\.(?:[cm]?[jt]sx?|json|ya?ml|md|txt|html|css)$/u;

void test('no tracked source file contains a NUL byte', (t) => {
  const paths = tracked().filter((path) => TEXT.test(path));
  if (paths.length === 0) {
    t.skip('no git checkout here, so there is no file list to check');
    return;
  }

  const binary = paths.filter((path) => {
    try {
      return readFileSync(path).includes(0);
    } catch {
      return false;
    }
  });

  assert.deepEqual(
    binary,
    [],
    'these are text files holding a NUL byte. git treats them as binary, which ' +
      'makes `git diff` unreadable and `git apply` refuse the patch — while the ' +
      'compiler, the linter and the tests all pass.',
  );
});
