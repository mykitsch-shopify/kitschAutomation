/**
 * Translation backlog verification.
 *
 * The Asana board carries ~90 open "Translate Product: X" tasks, auto-created
 * from a translation audit on 2026-05-27. Each names a product handle and the
 * locales its copy was missing in.
 *
 * What this does NOT do, deliberately: write translations. That is content
 * work — a brand's product copy in six languages is a professional
 * translation job and a business decision, not something a QA harness should
 * generate. Nothing here proposes or applies copy.
 *
 * What it does: answer whether each task is still true. The audit that created
 * them is months old, so the board's real problem is not that the work is
 * unknown — it is that nobody knows which of the ninety are already done. Every
 * task is a falsifiable claim ("this product is missing Spanish"), and a claim
 * that can be checked in a browser should not be checked by a person opening
 * ninety tabs.
 *
 * Three verdicts per locale, and the middle one is the point:
 *
 *   still_missing  the localized page serves the English copy. Task stands.
 *   translated     localized copy differs from English. Task can be closed.
 *   product_gone   the handle 404s. The task is about a product that no longer
 *                  exists, so it is stale rather than done.
 */

import { showsEnglish } from '../../i18n/lib/sentinels.js';

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type LocaleVerdict =
  | 'still_missing'
  | 'translated'
  | 'product_gone'
  /** Our own gap: the page loaded but no copy could be read. */
  | 'not_observed';

export type TaskVerdict =
  /** Every locale the task names is now translated. */
  | 'closeable'
  /** Some locales done, some not. */
  | 'partial'
  /** Nothing has changed since the audit. */
  | 'still_open'
  /** The product 404s — the task outlived its subject. */
  | 'stale_product'
  /** Could not be checked at all. */
  | 'unverified';

/** A task as the board holds it, after parsing. */
export type BacklogTask = {
  readonly gid: string;
  readonly name: string;
  /** Undefined when neither a handle line nor a product URL was present. */
  readonly handle: string | undefined;
  readonly locales: readonly string[];
  readonly dueOn: string | undefined;
  /**
   * Who the task belongs to, as Asana names them.
   *
   * Carried all the way to the closer rather than dropped here, because
   * closing a task is a statement about somebody's work and the closer cannot
   * make it safely without knowing whose. It was dropped here once: the export
   * held the assignee, this type did not, `report.json` therefore could not,
   * and `asana-close.ts` closed 116 tasks belonging to a colleague who had not
   * asked for any of it. The information existed at every step but the one
   * that needed it.
   *
   * Undefined means Asana reported no assignee, which is a real state and not
   * a licence to close.
   */
  readonly assignee: string | undefined;
};

/** One translatable field, as seen in both languages. */
export type FieldPair = {
  readonly localized: string | undefined;
  readonly english: string | undefined;
};

/**
 * Fields are kept separate rather than concatenated, because partial
 * translation is field-shaped: a translated title above an English description
 * is the common half-done state, and it is still an open task. Comparing one
 * merged blob would call that translated, since the blob as a whole differs
 * from English.
 */
export type LocaleObservation = {
  readonly locale: string;
  readonly status: number;
  readonly fields: Readonly<Record<string, FieldPair>>;
};

export type TaskResult = {
  readonly task: BacklogTask;
  readonly verdict: TaskVerdict;
  readonly byLocale: Readonly<Record<string, LocaleVerdict>>;
  readonly note: string;
};

// ── parsing Asana task notes ─────────────────────────────────────────────

/**
 * Locale codes a task may NAME. Not the same as the ones we can check.
 *
 * The board's auto-created tasks list "es fr de it ja ko", because that is what
 * the May translation audit asked for. This set is the reading vocabulary: a
 * task that says `ja` must still parse as naming `ja`, or it falls through to
 * the default and we lose what the task actually asked for.
 */
const PARSEABLE_LOCALES: readonly string[] = ['es', 'fr', 'de', 'it', 'ja', 'ko'];

/**
 * Locale codes we can actually verify — the store's live markets, matching
 * config/i18n.yaml. Pinned to it by a unit test.
 *
 * The distinction is not pedantic. Before it existed, every task reported
 * `unverified — could not read copy in es, fr, de, it, ja`, which reads as five
 * failures of the same kind. Four of those were a real failure to read; the
 * fifth was a market this store does not serve and never will report anything.
 * Mixing them means the day `es` starts working, the task still says
 * "unverified" and nobody knows why.
 */
export const CHECKED_LOCALES: readonly string[] = ['es', 'fr', 'de', 'it'];

/**
 * What a task asks for, narrowed to what we can answer.
 *
 * A task naming only `ja` and `ko` narrows to nothing, and the audit reports it
 * as out of contract rather than as unverified work.
 */
export const checkableLocales = (asked: readonly string[]): readonly string[] =>
  asked.filter((code) => CHECKED_LOCALES.includes(code));

/** Locales a task named that are outside the contract, for the report. */
export const uncheckableLocales = (asked: readonly string[]): readonly string[] =>
  asked.filter((code) => !CHECKED_LOCALES.includes(code));

/** Backwards-compatible alias — the default when a task names no locale. */
export const DEFAULT_LOCALES: readonly string[] = PARSEABLE_LOCALES;

const KNOWN = new Set(PARSEABLE_LOCALES);

/**
 * Pulls the handle out of a task's notes.
 *
 * Two shapes appear on the board and both are load-bearing: the auto-created
 * tasks carry an explicit "Product handle:" line, while the hand-written ones
 * carry only a product URL. Reading only one shape would silently drop a third
 * of the backlog as unparseable.
 *
 * The explicit line wins where both exist, because at least one task's URL
 * points at a different product than its handle line names — trusting the URL
 * there would check the wrong page.
 */
export const parseHandle = (notes: string): string | undefined => {
  // Three shapes, all present on the board. The third — "(handle: x)" inline —
  // was found by running this against the real export: a re-work task written
  // in a different format than the rest, silently dropped by a pattern that
  // required "Product handle:" on its own line.
  const explicit = /\bhandle:\s*\n?\s*([a-z0-9][a-z0-9-]*)/iu.exec(notes);
  if (explicit?.[1] !== undefined) return explicit[1];

  // Collection-scoped product URLs are common on newer tasks and carry the same
  // handle. Requiring /products/ directly after the domain dropped three of them.
  const fromUrl = /mykitsch\.com\/(?:collections\/[a-z0-9-]+\/)?products\/([a-z0-9][a-z0-9-]*)/iu.exec(
    notes,
  );
  return fromUrl?.[1];
};

/**
 * Pulls the locale list out of a task's notes.
 *
 * Auto-created tasks list them under "Locales needing translation:" in
 * lowercase, one per line. Hand-written ones list bare uppercase codes with no
 * heading. Anything else falls back to all six, which is what the audit means
 * by an untranslated product.
 */
export const parseLocales = (notes: string): readonly string[] => {
  const section = /Locales needing translation:\s*([\s\S]*?)(?:\n\s*\n|$)/iu.exec(notes);
  const source = section?.[1] ?? notes;

  const found: string[] = [];
  for (const line of source.split('\n')) {
    const code = line.trim().toLowerCase();
    // Whole-line matches only. Scanning for two-letter codes anywhere would
    // pick "it" out of ordinary prose and claim Italian on every task.
    if (KNOWN.has(code) && !found.includes(code)) found.push(code);
  }
  return found.length > 0 ? found : DEFAULT_LOCALES;
};

export const parseTask = (
  gid: string,
  name: string,
  notes: string,
  dueOn?: string,
  assignee?: string,
): BacklogTask => ({
  gid,
  name,
  handle: parseHandle(notes),
  locales: parseLocales(notes),
  ...(dueOn === undefined ? { dueOn: undefined } : { dueOn }),
  ...(assignee === undefined ? { assignee: undefined } : { assignee }),
});

/**
 * Whether this task belongs to the person running the closer.
 *
 * Name comparison, matching how `asana-pull.ts` filters, because a name is what
 * the export carries and what an operator can type. Case- and space-insensitive
 * so "Dinesh" and "dinesh" are the same person; an unassigned task belongs to
 * nobody and is never a match.
 */
export const belongsTo = (task: BacklogTask, assignee: string): boolean =>
  task.assignee !== undefined &&
  task.assignee.trim().toLowerCase() === assignee.trim().toLowerCase();

/**
 * Not every task on the board is a per-product translation job. Banner and page
 * tasks name no product, and the search also surfaces unrelated bugs. Treating
 * those as products would produce a wall of "no handle" findings that says more
 * about the filter than the backlog.
 */
export const isProductTask = (task: BacklogTask): boolean =>
  task.handle !== undefined && /translate/iu.test(task.name);

/**
 * A translation task the parser could not pin to a product.
 *
 * Reported rather than dropped. A task named "Translate…" with no handle
 * anywhere in its notes is a real gap someone has to close by adding the URL,
 * and silently excluding it makes the backlog look smaller than it is.
 *
 * Tasks whose name is already marked done with a tick are excluded: they are
 * closed in practice and carry no notes to parse.
 */
export const needsHandle = (task: BacklogTask): boolean =>
  task.handle === undefined && /translate/iu.test(task.name) && !task.name.includes('\u2705');

// ── judging ──────────────────────────────────────────────────────────────

/**
 * Distinctive English phrases: long enough that surviving verbatim in another
 * language means the copy was not translated, rather than that a brand name
 * was kept.
 *
 * Four words and twenty characters. "Kitsch", "Bridgerton" and "Star Wars"
 * legitimately stay English in every locale and fall well under that; a clause
 * like "keeps bars dry between uses" does not.
 */
const MIN_PHRASE_WORDS = 4;
const MIN_PHRASE_CHARS = 20;

export const distinctivePhrases = (english: string): readonly string[] =>
  english
    // Sentence and clause boundaries. Splitting on words alone would produce
    // fragments short enough to match by coincidence.
    .split(/[.!?;:\n]|\s[—–-]\s/u)
    .map((phrase) => phrase.trim())
    .filter(
      (phrase) =>
        phrase.length >= MIN_PHRASE_CHARS &&
        phrase.split(/\s+/u).filter((word) => word.length > 0).length >= MIN_PHRASE_WORDS,
    );

/**
 * True when a distinctive English phrase survives in the localized copy.
 *
 * Comparing the whole strings only catches a page that is entirely
 * untranslated. Half-translated pages are common and are still unfinished
 * work — a translated title above an English description is not a closeable
 * task — so each phrase is checked separately.
 */
export const retainsEnglish = (localized: string, english: string): boolean => {
  const phrases = distinctivePhrases(english);
  // No phrase long enough to judge by. Fall back to the whole string, which
  // handles short copy like a bare product title.
  if (phrases.length === 0) return showsEnglish(localized, english.trim());
  return phrases.some((phrase) => showsEnglish(localized, phrase));
};

/**
 * One locale, one verdict.
 *
 * Translated is decided by difference from English, not by "there is text".
 * A Shopify storefront with no translation for a field falls back to the source
 * language, so a localized page is never empty — it is English. Checking for
 * presence would mark every untranslated product as done.
 */
export const judgeLocale = (observation: LocaleObservation): LocaleVerdict => {
  if (observation.status === 404) return 'product_gone';
  if (observation.status !== 200) return 'not_observed';

  const comparable = Object.values(observation.fields).filter(
    (pair) =>
      (pair.localized ?? '').trim() !== '' && (pair.english ?? '').trim() !== '',
  );
  if (comparable.length === 0) return 'not_observed';

  // Any field still carrying English means the task is unfinished. Requiring
  // every field to be English would pass a product whose description was never
  // touched, on the strength of a translated title.
  return comparable.some((pair) => retainsEnglish(pair.localized ?? '', pair.english ?? ''))
    ? 'still_missing'
    : 'translated';
};

export const judgeTask = (
  task: BacklogTask,
  observations: readonly LocaleObservation[],
): TaskResult => {
  const byLocale: Record<string, LocaleVerdict> = {};
  for (const observation of observations) {
    byLocale[observation.locale] = judgeLocale(observation);
  }
  const verdicts = Object.values(byLocale);

  // Locales the task asked for that this store does not serve.
  //
  // ── Declared policy: a task is judged on the contract, not on its ask ───
  //
  // The board's auto-created tasks name es/fr/de/it/ja/ko, because the May
  // translation audit asked for six. The store sells in four. A task whose four
  // supported locales are all translated is DONE — Japanese and Korean copy for
  // markets that do not exist is not outstanding work, and holding a task open
  // for it would keep ninety-odd tasks permanently un-closeable for a reason
  // nobody can act on.
  //
  // So ja/ko are excluded from the verdict. What they are NOT is invisible:
  // every note below names them, because closing a task that asked for six
  // locales on the strength of four is a judgement the reader is entitled to
  // see. If either market launches, they re-enter config/i18n.yaml and these
  // tasks legitimately reopen.
  const ignored = uncheckableLocales(task.locales);
  const aside =
    ignored.length === 0
      ? ''
      : ` ${ignored.join(' and ')} ${ignored.length === 1 ? 'was' : 'were'} not checked — ` +
        'this store does not serve those markets (config/i18n.yaml).';

  if (verdicts.length === 0) {
    return {
      task,
      verdict: 'unverified',
      byLocale,
      note:
        ignored.length > 0
          ? `this task asks only for ${ignored.join(' and ')}, which this store does not ` +
            'serve, so there is nothing here to verify. Closing it is a person\'s call: the ' +
            'work is not outstanding today and would be if those markets launch.'
          : 'no locale was checked, so the task was not verified either way',
    };
  }
  if (verdicts.every((verdict) => verdict === 'product_gone')) {
    return {
      task,
      verdict: 'stale_product',
      byLocale,
      note:
        `/products/${task.handle ?? ''} returns 404 in every locale checked. The task ` +
        'outlived the product it is about; closing it needs a person, not a translation.',
    };
  }
  // Anything unobserved makes the whole verdict provisional. Reporting
  // "closeable" off a partial read is how a task gets closed on work that was
  // never done.
  if (verdicts.some((verdict) => verdict === 'not_observed')) {
    const blind = Object.entries(byLocale)
      .filter(([, verdict]) => verdict === 'not_observed')
      .map(([locale]) => locale);
    return {
      task,
      verdict: 'unverified',
      byLocale,
      note: `could not read copy in ${blind.join(', ')}, so this task's status is unknown`,
    };
  }

  const missing = Object.entries(byLocale)
    .filter(([, verdict]) => verdict === 'still_missing')
    .map(([locale]) => locale);

  if (missing.length === 0) {
    return {
      task,
      verdict: 'closeable',
      byLocale,
      note:
        `all ${String(verdicts.length)} supported locale(s) now show localized copy — the ` +
        `work in this task appears done and it can be closed.${aside}`,
    };
  }
  if (missing.length === verdicts.length) {
    return {
      task,
      verdict: 'still_open',
      byLocale,
      note:
        `still English in ${missing.join(', ')} — nothing has changed since the audit.${aside}`,
    };
  }
  return {
    task,
    verdict: 'partial',
    byLocale,
    note:
      `done in ${String(verdicts.length - missing.length)} of ${String(verdicts.length)} ` +
      `supported locale(s); still English in ${missing.join(', ')}.${aside}`,
  };
};

// ── reporting ────────────────────────────────────────────────────────────

export type Summary = Readonly<Record<TaskVerdict, number>>;

export const summarize = (results: readonly TaskResult[]): Summary => {
  const counts: Record<TaskVerdict, number> = {
    closeable: 0,
    partial: 0,
    still_open: 0,
    stale_product: 0,
    unverified: 0,
  };
  for (const result of results) counts[result.verdict] += 1;
  return counts;
};
