/**
 * Character-integrity checks.
 *
 * The Translations test plan grades a garbled umlaut or a mojibake'd kana as
 * High priority, on the same footing as a missing string: both reach the
 * customer, and a page of "Ã¼" reads as a broken site rather than a German
 * one. Nothing in the Aug-11 scaffold looked at bytes, so this module is net
 * new — and it is deliberately pure and unit-tested, because a detector that
 * never fires is indistinguishable from a clean catalogue.
 *
 * Everything here is a heuristic over already-decoded text. We never see the
 * wire bytes, so the job is to recognise the *shapes* that byte-level damage
 * leaves behind.
 */

export type EncodingDefectKind =
  | 'replacement_character'
  | 'mojibake'
  | 'question_mark_substitution'
  | 'unrendered_entity';

export type EncodingDefect = {
  readonly kind: EncodingDefectKind;
  readonly evidence: string;
  readonly explanation: string;
};

/** U+FFFD — a decoder already gave up on this string. Never ambiguous. */
const REPLACEMENT = /�/u;

/**
 * CP1252 renderings of UTF-8 continuation bytes (0x80–0xBF). When UTF-8 is
 * decoded as Latin-1/CP1252 these are what the trailing bytes turn into.
 */
const TRAIL = '\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178';

/**
 * Two-byte damage: "Ã¼" for ü, "ÃŸ" for ß, "Ã©" for é.
 *
 * Only Ã and Â lead this rule. They are the UTF-8 lead bytes for the Latin-1
 * supplement (0xC3, 0xC2) and they essentially never occur in legitimate
 * French, German, Spanish or Italian copy, so a single trailing character is
 * enough evidence.
 */
const MOJIBAKE_LATIN = new RegExp(`[\\u00C2\\u00C3][${TRAIL}]`, 'u');

/**
 * Three-byte damage: "ã‚µ" for サ, "í•œ" for 한, "â€™" for '.
 *
 * These leads (à–ï) include characters that are perfectly ordinary in French
 * and Italian, so this rule demands *two* trailing characters. That is what
 * keeps "café !" — an é followed by the non-breaking space French typography
 * requires — from being reported as damage.
 */
const MOJIBAKE_MULTIBYTE = new RegExp(`[\\u00E0-\\u00EF][${TRAIL}][${TRAIL}]`, 'u');

/**
 * The same two-byte damage after something has normalised the trailing
 * character away. A stray "Ã" followed by a plain space is what the same
 * damage becomes once a CMS collapses the non-breaking space that followed it.
 *
 * Restricted to Ã/Â sitting at a word boundary. That is not a shape any of
 * the seven declared locales produces: it excludes Portuguese "SÃO", where
 * the Ã is followed by a letter.
 */
const MOJIBAKE_ORPHAN_LEAD = /[ÂÃ](?=[\s\p{P}]|$)/u;

/**
 * Transcoding through a charset that cannot represent the character replaces
 * it with a literal "?": "M?nchen", "Gr??e", "?????" for Hangul.
 *
 * Requires the "?" to sit between letters, or to repeat. A normal sentence
 * asks questions; it does not put a question mark inside a word.
 */
const QUESTION_SUBSTITUTION = /(\p{L}\?\p{L})|(\p{L}\?{2,})|(\?{3,})/u;

/** An entity that reached the customer as text instead of being decoded. */
const UNRENDERED_ENTITY = /&(#\d{2,5}|#x[0-9a-fA-F]{2,4}|[a-z]{2,8}(acute|grave|uml|cedil|tilde|ring|slash|lig));/u;

const URL_LIKE = /^https?:\/\//u;

const excerpt = (value: string, match: RegExpExecArray): string => {
  const start = Math.max(0, match.index - 12);
  const end = Math.min(value.length, match.index + match[0].length + 12);
  return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
};

/**
 * Every encoding defect visible in `value`. Empty means clean — which is a
 * claim this module has to be able to make wrongly to be worth anything, so
 * see text-integrity.test.ts for the known-bad corpus.
 */
export const findEncodingDefects = (value: string): readonly EncodingDefect[] => {
  const defects: EncodingDefect[] = [];

  const report = (pattern: RegExp, kind: EncodingDefectKind, explanation: string): void => {
    const match = new RegExp(pattern.source, pattern.flags).exec(value);
    if (match !== null) {
      defects.push({ kind, evidence: excerpt(value, match), explanation });
    }
  };

  report(
    REPLACEMENT,
    'replacement_character',
    'Contains U+FFFD. A decoder failed upstream; the original character is already lost.',
  );
  report(
    MOJIBAKE_LATIN,
    'mojibake',
    'UTF-8 bytes rendered as Latin-1 — the "Ã¼ for ü" shape. The page is being served or stored with the wrong charset.',
  );
  report(
    MOJIBAKE_MULTIBYTE,
    'mojibake',
    'Multi-byte UTF-8 (CJK, smart punctuation) rendered as Latin-1 — the "ã‚µ for サ" shape.',
  );
  report(
    MOJIBAKE_ORPHAN_LEAD,
    'mojibake',
    'A stray Ã/Â at a word boundary — two-byte mojibake whose trailing character has since been normalised away.',
  );
  if (!URL_LIKE.test(value.trim())) {
    report(
      QUESTION_SUBSTITUTION,
      'question_mark_substitution',
      'Literal "?" inside a word — a transcode through a charset that cannot represent the character.',
    );
  }
  report(
    UNRENDERED_ENTITY,
    'unrendered_entity',
    'An HTML entity reached the customer as literal text instead of being decoded.',
  );

  return defects;
};

const HAS_LETTER = /\p{L}/u;

/** Whether the string carries any linguistic content at all. */
export const containsLetters = (value: string): boolean => HAS_LETTER.test(value);

/**
 * Whether `value` contains at least one character of the expected script.
 * A Korean surface with no Hangul in it has not been translated, whatever the
 * translation table says.
 */
export const matchesScript = (value: string, script: RegExp): boolean => script.test(value);

/** How many of the locale's declared diacritics appear in the text. */
export const countDiacritics = (value: string, diacritics: readonly string[]): number =>
  diacritics.filter((character) => value.includes(character)).length;

export const describeDefects = (defects: readonly EncodingDefect[]): string =>
  defects.map((defect) => `${defect.kind}: "${defect.evidence}" — ${defect.explanation}`).join(' | ');
