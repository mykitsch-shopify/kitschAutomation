import type { FindingKind } from '../../i18n/lib/config.js';
import type { Locale } from './content.js';

/**
 * The seeded-defect profile — the negative control for the whole suite.
 *
 * A gate nobody has watched fail is not a gate. Each entry below is a defect
 * of a class the Translations test plan names, planted deliberately, tagged
 * with the section it exercises and with the finding kind it must produce.
 * `i18n/verify-detection.ts` asserts that every one of them is caught: if a
 * comparator regresses into silence, that run goes red.
 *
 * `value` semantics match the collector:
 *   string        — the (damaged) translation the store would return
 *   null          — no translation registered
 *   FETCH_FAILED  — collector could not reach the resource
 *
 * FETCH_FAILED is a symbol rather than the string 'FETCH_FAILED' because a
 * string literal in a `string | null | 'FETCH_FAILED'` union is swallowed by
 * `string`, so the compiler would happily accept a typo'd sentinel as an
 * ordinary translation value.
 */

export const FETCH_FAILED = Symbol('fetch-failed');

export type SeededDefect = {
  readonly locale: Locale;
  readonly key: string;
  readonly value: string | null | typeof FETCH_FAILED;
  readonly expect: FindingKind;
  readonly planRef: string;
  readonly note: string;
};

export const SEEDED_DEFECTS: readonly SeededDefect[] = [
  // ── Untranslated English fallbacks (test plan §11 — High) ──────────────
  {
    locale: 'de',
    key: 'nav.accessories',
    value: 'Accessories',
    expect: 'untranslated_candidate',
    planRef: '§6.3',
    note: 'Nav item left in English in German mode.',
  },
  {
    locale: 'ko',
    key: 'nav.sleep',
    value: 'Sleep',
    expect: 'untranslated_candidate',
    planRef: '§7.3',
    note: 'Nav item left in English in Korean mode.',
  },
  {
    locale: 'ja',
    key: 'footer.heading_help',
    value: 'Help',
    expect: 'untranslated_candidate',
    planRef: '§8.3',
    note: 'Footer heading left in English in Japanese mode.',
  },
  {
    locale: 'it',
    key: 'nav.sale',
    value: 'Sale',
    expect: 'untranslated_candidate',
    planRef: '§10.2',
    note: 'Nav item left in English in Italian mode.',
  },
  {
    locale: 'fr',
    key: 'cart.subtotal',
    value: 'Subtotal',
    expect: 'untranslated_candidate',
    planRef: '§5.5',
    note: 'Cart label left in English in French mode.',
  },

  // ── Character encoding damage (§6.2, §7.2, §8.2, §9.2, §12 — High) ─────
  {
    locale: 'de',
    key: 'pdp.description',
    value:
      'Eine sanftere OberflÃ¤che fÃ¼r Haare und Haut. Maschinenwaschbar, in fÃ¼nf Farben erhÃ¤ltlich.',
    expect: 'encoding_error',
    planRef: '§6.2',
    note: 'German umlauts served as UTF-8-read-as-Latin-1 (Ã¤ for ä).',
  },
  {
    locale: 'ja',
    key: 'pdp.title',
    value: 'ã‚µãƒ†ãƒ³æž•ã‚«ãƒãƒ¼ã‚»ãƒƒãƒˆ',
    expect: 'encoding_error',
    planRef: '§8.2',
    note: 'Japanese product title mojibake — the classic ã‚ shape.',
  },
  {
    locale: 'ko',
    key: 'cart.subtotal',
    value: '소�',
    expect: 'encoding_error',
    planRef: '§7.2',
    note: 'Korean cart label with a U+FFFD replacement character.',
  },
  {
    locale: 'es',
    key: 'home.hero_heading',
    value: 'Un cabello m?s bonito empieza aqu?',
    expect: 'encoding_error',
    planRef: '§9.2',
    note: 'Spanish accents transcoded to literal question marks.',
  },

  // ── Missing and empty translations (§5.2, §15 — High) ─────────────────
  {
    locale: 'de',
    key: 'checkout.error_required',
    value: null,
    expect: 'missing_translation',
    planRef: '§15.2',
    note: 'German checkout validation message never registered — falls back to English.',
  },
  {
    locale: 'fr',
    key: 'footer.newsletter_body',
    value: null,
    expect: 'missing_translation',
    planRef: '§5.2',
    note: 'French newsletter body missing from the translation table.',
  },
  {
    locale: 'it',
    key: 'pdp.add_to_cart',
    value: null,
    expect: 'missing_translation',
    planRef: '§10.1',
    note: 'Italian Add to Cart button missing — the primary PDP conversion control.',
  },
  {
    locale: 'es',
    key: 'checkout.city',
    value: '   ',
    expect: 'empty_translation',
    planRef: '§15.1',
    note: 'Spanish checkout field label registered but blank — renders as an unlabelled input.',
  },

  // ── Interpolation drift (High) ────────────────────────────────────────
  {
    locale: 'de',
    key: 'home.banner_promo',
    value: 'Kostenloser Versand ab',
    expect: 'placeholder_drift',
    planRef: '§13.2',
    note: 'Promo banner drops {{ amount }} — the customer sees a sentence with no threshold.',
  },

  // ── Meta content (§14 — Medium) ───────────────────────────────────────
  {
    locale: 'fr',
    key: 'meta.home_description',
    value:
      'Shop satin pillowcases, scrunchies and hair tools designed for healthier hair. Free shipping on qualifying orders.',
    expect: 'untranslated_candidate',
    planRef: '§14.2',
    note: 'French meta description still in English — invisible on the page, visible in search.',
  },
  {
    locale: 'ko',
    key: 'meta.home_title',
    value: 'Kitsch | Hair accessories and satin beauty essentials',
    expect: 'untranslated_candidate',
    planRef: '§14.3',
    note: 'Korean meta title still in English.',
  },

  // ── Wrong writing system (§7.1, §8.1 — High) ──────────────────────────
  {
    locale: 'ko',
    key: 'pdp.in_stock',
    value: 'Jaego isseum',
    expect: 'script_missing',
    planRef: '§7.2',
    note: 'Romanised Korean — differs from English, so only a script check catches it.',
  },

  // ── Terminology consistency (§13.1) ───────────────────────────────────
  {
    locale: 'de',
    key: 'home.section_bestsellers',
    value: 'Meistverkaufte Produkte',
    expect: 'inconsistent_translation',
    planRef: '§13.1',
    note: '"Best sellers" is "Bestseller" in the nav and "Meistverkaufte Produkte" on the homepage — the same concept, two terms, both visible while moving between pages.',
  },

  // ── Harness debt, not a client defect ─────────────────────────────────
  {
    locale: 'fr',
    key: 'footer.link_faq',
    value: FETCH_FAILED,
    expect: 'collector_error',
    planRef: '§3',
    note: 'Collector outage. Must be reported as harness debt, never as a clean or failing locale.',
  },
];
