import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildLaunch, explainNotStart, findOnWindowsPath, quoteForWindows, runSync } from './run.js';

/**
 * These tests exist because the distinction they check was silently lost once
 * already: every pre-commit gate on a Windows laptop failed to *start*, and all
 * four were reported as having run and failed. "Could not check" collapsed into
 * "your code is broken", in the tool that guards every commit.
 *
 * So the two halves are pinned here. `notRun` must be set when nothing ran, and
 * — the case that is easy to break later — must stay unset when a command
 * really did run and really did fail.
 *
 * And then it was lost a second time, in the fix. The first version of this
 * module checked `result.error` and stopped there, which is correct on POSIX
 * and useless on Windows: under `shell: true` the process that starts is
 * cmd.exe, cmd.exe starts fine, and a missing `npm` comes back as an ordinary
 * exit code. It went unnoticed because the Windows path was reasoned about
 * rather than run. Hence the platform argument on `buildLaunch` and
 * `explainNotStart`, and hence the Windows cases below, which run here.
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

// ── the Windows path, exercised from wherever this happens to run ──────────

void test('explainNotStart: on Windows, a non-zero exit from a command not on PATH never ran', () => {
  // The regression that shipped twice. Under `shell: true` cmd.exe is what
  // starts, so it starts successfully and `error` is never set — and cmd.exe's
  // exit code for "not recognized" is not something this repo gets to assume.
  // Whether the command exists is the evidence that does not require guessing.
  const reason = explainNotStart('npm', { status: 1 }, 'win32', false);
  assert.notEqual(reason, undefined);
  assert.match(reason ?? '', /could not be found/u);
  assert.match(reason ?? '', /npm ci/u);
});

void test('explainNotStart: on Windows, a command that is on PATH really did fail', () => {
  // The other half. If every Windows non-zero exit became "could not check",
  // the gate would stop being able to fail at all.
  assert.equal(explainNotStart('npm', { status: 1 }, 'win32', true), undefined);
  assert.equal(explainNotStart('npm', { status: 0 }, 'win32', true), undefined);
});

void test('explainNotStart: a success is a success, whatever the PATH search concluded', () => {
  // If it ran and exited 0 it plainly existed, and no lookup should be able to
  // talk us out of a result we watched happen.
  assert.equal(explainNotStart('npm', { status: 0 }, 'win32', false), undefined);
});

void test('explainNotStart: off Windows, PATH is not second-guessed — ENOENT already says it', () => {
  assert.equal(explainNotStart('npm', { status: 1 }, 'linux', false), undefined);
});

void test('explainNotStart: a spawn error still explains itself on either platform', () => {
  const enoent = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
  for (const platform of ['win32', 'linux'] as const) {
    assert.match(explainNotStart('npm', { error: enoent, status: null }, platform) ?? '', /npm ci/u);
  }
});

void test('explainNotStart: a signal kill is reported as not-run, and names the signal', () => {
  const reason = explainNotStart('npm', { status: null, signal: 'SIGKILL' }, 'linux');
  assert.match(reason ?? '', /SIGKILL/u);
});

void test('buildLaunch: on Windows everything is quoted into one line, with no args array', () => {
  // Passing an args array alongside `shell: true` makes Node concatenate them
  // unescaped — DEP0190 — and that warning printed on every Windows run.
  const spec = buildLaunch('npx', ['allure', 'generate', '--name', 'Kitsch daily run'], 'win32');
  assert.equal(spec.shell, true);
  assert.deepEqual(spec.args, []);
  assert.equal(spec.command, 'npx allure generate --name "Kitsch daily run"');
});

void test('buildLaunch: off Windows the command and arguments are passed through untouched', () => {
  // No shell, so nothing re-parses the arguments and nothing needs quoting.
  const args = ['run', '--silent', 'test:unit'];
  const spec = buildLaunch('npm', args, 'linux');
  assert.equal(spec.shell, false);
  assert.equal(spec.command, 'npm');
  assert.deepEqual(spec.args, args);
});

void test('findOnWindowsPath: finds npm.cmd by its PATHEXT extension, as cmd.exe would', () => {
  // The real lookup, against a real directory, runnable on any platform —
  // which is the only reason this is checkable at all before shipping.
  const dir = mkdtempSync(join(tmpdir(), 'kitsch-run-'));
  writeFileSync(join(dir, 'npm.cmd'), '');
  const env = { PATH: `${dir};${join(dir, 'nowhere')}`, PATHEXT: '.EXE;.CMD' };
  assert.equal(findOnWindowsPath('npm', env), join(dir, 'npm.cmd'));
  rmSync(dir, { recursive: true, force: true });
});

void test('findOnWindowsPath: reports a command that is simply not there', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kitsch-run-'));
  const env = { PATH: dir, PATHEXT: '.EXE;.CMD' };
  assert.equal(findOnWindowsPath('npm', env), undefined);
  rmSync(dir, { recursive: true, force: true });
});

void test('findOnWindowsPath: a directory is not something to run', () => {
  // Without this, a folder called "npm" on PATH would read as an installed npm
  // and send us back to reporting a missing launcher as a failed gate.
  const dir = mkdtempSync(join(tmpdir(), 'kitsch-run-'));
  mkdirSync(join(dir, 'npm'));
  assert.equal(findOnWindowsPath('npm', { PATH: dir, PATHEXT: '.EXE;.CMD' }), undefined);
  rmSync(dir, { recursive: true, force: true });
});

void test('findOnWindowsPath: an empty PATH finds nothing rather than throwing', () => {
  assert.equal(findOnWindowsPath('npm', {}), undefined);
});

void test('findOnWindowsPath: reads Path and PathExt whatever their capitalisation', () => {
  // Windows environment variables are case-insensitive, but `{ ...process.env }`
  // is an ordinary object holding the casing Windows actually used — normally
  // `Path`. Miss that and every command looks missing, so a real failure gets
  // reported as one that never ran. Exactly backwards, and only on Windows.
  const dir = mkdtempSync(join(tmpdir(), 'kitsch-run-'));
  writeFileSync(join(dir, 'npm.cmd'), '');
  assert.equal(findOnWindowsPath('npm', { Path: dir, PathExt: '.CMD' }), join(dir, 'npm.cmd'));
  rmSync(dir, { recursive: true, force: true });
});
