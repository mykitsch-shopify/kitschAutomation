import assert from 'node:assert/strict';
import { test } from 'node:test';

import { quoteForWindows, runSync } from './run.js';

/**
 * These tests exist because the distinction they check was silently lost once
 * already: every pre-commit gate on a Windows laptop failed to *start*, and all
 * four were reported as having run and failed. "Could not check" collapsed into
 * "your code is broken", in the tool that guards every commit.
 *
 * So the two halves are pinned here. `notRun` must be set when nothing ran, and
 * — the case that is easy to break later — must stay unset when a command
 * really did run and really did fail. And the Windows quoting, which cannot be
 * exercised on this platform, is tested as the pure function it is.
 */

void test('runSync: a command that runs and succeeds reports status 0 and no notRun', () => {
  const result = runSync(process.execPath, ['-e', 'process.stdout.write("hello")']);
  assert.equal(result.status, 0);
  assert.equal(result.notRun, undefined);
  assert.match(result.output, /hello/u);
});

void test('runSync: a command that runs and fails is a failure, not an environment problem', () => {
  // The regression that matters. If a real exit 3 ever starts carrying notRun,
  // every genuine gate failure becomes excusable as "could not check" and the
  // gate stops meaning anything.
  const result = runSync(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(result.status, 3);
  assert.equal(result.notRun, undefined);
});

void test('runSync: a command that cannot start says so, and says what to do', () => {
  const result = runSync('kitsch-no-such-command-exists', ['--version']);
  assert.notEqual(result.notRun, undefined);
  assert.match(result.notRun ?? '', /could not be found/u);
  assert.match(result.notRun ?? '', /npm ci/u);
});

void test('runSync: stderr is captured rather than lost', () => {
  // A gate that fails usually explains itself on stderr. Dropping it leaves a
  // FAIL with no reason attached, which is barely better than no gate.
  const result = runSync(process.execPath, [
    '-e',
    'process.stderr.write("boom"); process.exit(1)',
  ]);
  assert.equal(result.status, 1);
  assert.equal(result.notRun, undefined);
  assert.match(result.output, /boom/u);
});

void test('quoteForWindows: a sentence is quoted so cmd.exe keeps it as one argument', () => {
  assert.equal(quoteForWindows('Kitsch daily run'), '"Kitsch daily run"');
});

void test('quoteForWindows: ordinary flags and URLs are left alone', () => {
  assert.equal(quoteForWindows('--base-url'), '--base-url');
  assert.equal(quoteForWindows('https://www.mykitsch.com/products/x'), 'https://www.mykitsch.com/products/x');
});

void test('quoteForWindows: an empty argument stays an argument', () => {
  // Unquoted it would vanish from the argument list, shifting every flag after
  // it onto the wrong value.
  assert.equal(quoteForWindows(''), '""');
});

void test('quoteForWindows: refuses % rather than passing something different', () => {
  assert.throws(() => quoteForWindows('50%OFF'), /cannot be escaped/u);
});

void test('quoteForWindows: a trailing backslash is doubled so it cannot escape the quote', () => {
  // "C:\Kitsch Automation\" — the trailing backslash would otherwise escape the
  // closing quote and swallow the next argument.
  const quoted = quoteForWindows('C:\\Kitsch Automation\\');
  assert.ok(quoted.endsWith('\\\\"'), `expected a doubled backslash before the quote, got ${quoted}`);
});
