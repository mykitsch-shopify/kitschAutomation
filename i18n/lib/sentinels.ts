/**
 * Pure helpers behind the render layer's two content checks.
 *
 * They live in `lib/` rather than next to the specs because they are the part
 * that can be wrong silently. `buildSentinels` returning an empty list does
 * not fail a test — it makes every "no English is showing" assertion pass
 * without looking at anything, which is the same hazard the content-layer
 * comparators carry and the same reason this file has a test beside it.
 *
 * Nothing here reads a file or touches a browser, so all of it is testable
 * against known-bad input.
 */

export type LocaleStrings = Readonly<Record<string, string | null>>;

export type Sentinel = {
  readonly key: string;
  readonly english: string;
  readonly expected: string;
};

/**
 * Strings shorter than this are skipped in both directions: they collide with
 * unrelated copy ("New" inside "Newsletter", "Sale" inside "Saldi") and the
 * content layer checks them exhaustively anyway.
 */
export const MIN_MATCH_LENGTH = 4;

/**
 * English strings that must NOT appear on a page rendered in the target
 * locale.
 *
 * Deliberately excludes keys whose contracted translation *is* the English
 * string — "Collections" is "Collections" in French, and reporting that as an
 * untranslated fallback would train the team to ignore the check.
 */
export const buildSentinels = (
  english: LocaleStrings,
  target: LocaleStrings,
): readonly Sentinel[] => {
  const sentinels: Sentinel[] = [];
  for (const [key, source] of Object.entries(english)) {
    const expected = target[key];
    if (source === null || expected === null || expected === undefined) {
      continue;
    }
    if (source.trim() === expected.trim()) {
      continue;
    }
    if (source.trim().length < MIN_MATCH_LENGTH) {
      continue;
    }
    sentinels.push({ key, english: source.trim(), expected: expected.trim() });
  }
  return sentinels;
};

/**
 * The literal fragments of a contracted string that must appear on the page.
 *
 * Interpolated strings cannot be matched whole — "{{ count }} avis" never
 * appears verbatim once the count is bound — so placeholders are removed and
 * the surrounding literals matched instead.
 */
export const fragmentsOf = (value: string | null | undefined): readonly string[] => {
  if (value === null || value === undefined || value.trim() === '') {
    return [];
  }
  return value
    .split(/\{\{[^}]*\}\}|\{[^}]*\}|%\{[^}]*\}|%[sd]/u)
    .map((fragment) => fragment.trim())
    .filter(hasSubstance);
};

/**
 * A fragment earns its place only if it contains a word long enough to be
 * distinctive. Length alone is not enough: "de la" clears a five-character
 * bar and appears all over a French page, so asserting it proves nothing
 * while looking like coverage.
 *
 * Scripts without spaces have a single token, which is the whole fragment —
 * so "カートに追加" is judged on its own length, as it should be.
 */
const hasSubstance = (fragment: string): boolean =>
  fragment.length >= MIN_MATCH_LENGTH &&
  fragment.split(/\s+/u).some((word) => word.length >= MIN_MATCH_LENGTH);

const ASCII_ONLY = /^[\p{ASCII}]+$/u;

/**
 * Whether `haystack` shows `sentinel` as a standalone string.
 *
 * ASCII sentinels are matched on word boundaries so "New" does not match
 * inside "Newsletter". CJK has no word boundaries to speak of — and `\b`
 * against Hangul or kana behaves nothing like it does against Latin — so
 * those fall back to substring containment.
 */
export const showsEnglish = (haystack: string, sentinel: string): boolean => {
  if (!ASCII_ONLY.test(sentinel)) {
    return haystack.includes(sentinel);
  }
  // Escaped: nav labels and marketing copy contain (), ?, +, $ often enough
  // that an unescaped sentinel would either throw or match the wrong thing.
  const escaped = sentinel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'u').test(haystack);
};
