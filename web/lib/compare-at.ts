/**
 * Compare-at price removal — validation logic.
 *
 * The change under test: a Shopify product import that clears
 * `Variant Compare At Price` on a list of products, so the storefront stops
 * showing a struck-through "was" price next to the real one. A second sheet
 * records the pre-change values so the edit can be reverted.
 *
 * Two things are being validated, and they are not the same job:
 *
 *   1. Are the sheets internally sound? Every handle that is being changed
 *      needs a recorded old value, or it cannot be put back. No network
 *      needed, so this runs first and always.
 *
 *   2. Does the live storefront agree? For each product, the struck-through
 *      price must be gone and the real price must be untouched. A removal
 *      that also moved a price is a worse defect than the one it fixed.
 *
 * The asymmetry worth knowing before reading a report: Shopify only renders a
 * compare-at price when it is strictly greater than the price. A row whose
 * compare-at equals its price shows no strikethrough either way, so clearing
 * it changes nothing a customer can see. Those rows are still checked — a
 * theme that renders an equal compare-at is a real defect — but they cannot
 * confirm the removal worked. Only rows that had a visible strikethrough can
 * do that, and `visiblyChanged` marks them.
 */

export type Severity = 'critical' | 'major' | 'minor' | 'harness';

export type CompareAtKind =
  /** The struck-through price is still on the page. The removal did not take. */
  | 'compare_at_still_rendered'
  /** The live price is not the price the sheet says it should be. */
  | 'price_mismatch'
  /** A handle is being changed with no recorded old value — not revertible. */
  | 'rollback_record_missing'
  /** A published product did not load. */
  | 'product_unreachable'
  /** The two sheets disagree about the same product. */
  | 'sheet_disagreement'
  /** A "removal" import that still carries a compare-at value removes nothing. */
  | 'import_carries_compare_at'
  /** Same handle twice in one sheet; which row wins is undefined. */
  | 'duplicate_handle'
  /** Import row with no SKU — matching falls back to handle plus options. */
  | 'missing_sku'
  /** Our own failure: the page loaded but the price could not be read. */
  | 'price_not_observed';

export const SEVERITY_OF: Readonly<Record<CompareAtKind, Severity>> = {
  // A fake discount is a pricing claim shown to customers. It outranks
  // everything else here.
  compare_at_still_rendered: 'critical',
  // Worse than the bug being fixed: the import was supposed to leave price alone.
  price_mismatch: 'critical',
  rollback_record_missing: 'major',
  product_unreachable: 'major',
  sheet_disagreement: 'major',
  import_carries_compare_at: 'major',
  duplicate_handle: 'major',
  missing_sku: 'minor',
  // Never a pass and never the store's fault. See judge().
  price_not_observed: 'harness',
};

export type Finding = {
  readonly severity: Severity;
  readonly kind: CompareAtKind;
  readonly handle: string;
  readonly detail: string;
};

export type ImportRow = {
  readonly handle: string;
  readonly sku: string;
  readonly price: string;
  readonly compareAt: string;
};

export type RollbackRow = {
  readonly handle: string;
  readonly status: string;
  readonly sku: string;
  readonly livePrice: string;
  readonly liveCompareAt: string;
};

/** What the storefront should show for one product after the import. */
export type Expectation = {
  readonly handle: string;
  /** Cents. The price must still be exactly this. */
  readonly priceCents: number;
  /** No compare-at at all — the point of the change. */
  readonly expectNoCompareAt: true;
  /** DRAFT products are not publicly visible; a 404 is correct, not a defect. */
  readonly published: boolean;
  /**
   * True when this product showed a strikethrough before the change, so its
   * disappearance is observable. False when compare-at was <= price and
   * nothing visible changes either way.
   */
  readonly visiblyChanged: boolean;
};

/** What a browser actually saw. Absent fields mean "not observed". */
export type Observation = {
  readonly handle: string;
  readonly status: number;
  /** Rendered price text, or undefined when the selector matched nothing. */
  readonly priceText: string | undefined;
  /** Rendered compare-at text, or undefined when nothing matched. */
  readonly compareAtText: string | undefined;
};

// ── money ────────────────────────────────────────────────────────────────

/**
 * Cents, so 19.99 never becomes 19.989999999999998. Returns undefined for
 * anything that is not a single plain money value, which the callers treat as
 * "unknown" rather than zero — a blank read as 0.00 would make every price
 * look wrong.
 *
 * Words are rejected, with one exception. A trailing ISO currency code is
 * dropped because Shopify themes routinely print "$12.00 USD", and refusing
 * that would make every product unreadable on those themes. Anything else
 * containing letters is refused: "from $12" is a price *range* across
 * variants, and quietly reading it as $12.00 would let a range pass as a
 * verified single price. Unreadable is the honest answer there, and it
 * surfaces as a harness finding rather than a false pass.
 */
export const toCents = (value: string): number | undefined => {
  const withoutCurrencyCode = value.trim().replace(/\s+[A-Z]{3}$/u, '');
  if (/\p{L}/u.test(withoutCurrencyCode)) return undefined;
  const cleaned = withoutCurrencyCode.replace(/[^\d.,-]/gu, '').replace(/,/gu, '');
  if (cleaned === '' || !/^-?\d+(\.\d{1,2})?$/u.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
};

export const formatCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

// ── CSV ──────────────────────────────────────────────────────────────────

/**
 * Minimal RFC4180 reader: quoted fields, doubled quotes, CRLF. Enough for
 * Shopify exports and small enough to read in one sitting, which is why it is
 * here rather than a dependency.
 */
export const parseCsv = (text: string): readonly (readonly string[])[] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Strip a UTF-8 BOM: Excel writes one, and it would become part of the
  // first header name, so every lookup of that column would miss.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
};

const indexOfColumn = (header: readonly string[], name: string, path: string): number => {
  const index = header.findIndex((cell) => cell.trim() === name);
  if (index === -1) {
    throw new Error(
      `${path}: no "${name}" column. Found: ${header.map((cell) => cell.trim()).join(', ')}`,
    );
  }
  return index;
};

const cell = (row: readonly string[], index: number): string => (row[index] ?? '').trim();

export const readImportCsv = (text: string, path = 'import csv'): readonly ImportRow[] => {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) throw new Error(`${path}: file is empty`);
  const handle = indexOfColumn(header, 'Handle', path);
  const sku = indexOfColumn(header, 'Variant SKU', path);
  const price = indexOfColumn(header, 'Variant Price', path);
  const compareAt = indexOfColumn(header, 'Variant Compare At Price', path);
  return rows.slice(1).map((row) => ({
    handle: cell(row, handle),
    sku: cell(row, sku),
    price: cell(row, price),
    compareAt: cell(row, compareAt),
  }));
};

export const readRollbackCsv = (text: string, path = 'rollback csv'): readonly RollbackRow[] => {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) throw new Error(`${path}: file is empty`);
  const handle = indexOfColumn(header, 'handle', path);
  const status = indexOfColumn(header, 'status', path);
  const sku = indexOfColumn(header, 'sku', path);
  const livePrice = indexOfColumn(header, 'live_price', path);
  const liveCompareAt = indexOfColumn(header, 'live_compare_at', path);
  return rows.slice(1).map((row) => ({
    handle: cell(row, handle),
    status: cell(row, status).toUpperCase(),
    sku: cell(row, sku),
    livePrice: cell(row, livePrice),
    liveCompareAt: cell(row, liveCompareAt),
  }));
};

// ── sheet audit, no network ──────────────────────────────────────────────

const duplicates = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) twice.add(value);
    seen.add(value);
  }
  return [...twice];
};

/**
 * Everything that can be known before opening a browser. Runs first because
 * a missing rollback record is worth knowing whether or not the storefront
 * agrees, and because it is free.
 */
export const auditSheets = (
  imports: readonly ImportRow[],
  rollbacks: readonly RollbackRow[],
): readonly Finding[] => {
  const findings: Finding[] = [];
  const add = (kind: CompareAtKind, handle: string, detail: string): void => {
    findings.push({ severity: SEVERITY_OF[kind], kind, handle, detail });
  };

  for (const handle of duplicates(imports.map((row) => row.handle))) {
    add('duplicate_handle', handle, 'appears more than once in the import sheet');
  }
  for (const handle of duplicates(rollbacks.map((row) => row.handle))) {
    add('duplicate_handle', handle, 'appears more than once in the rollback sheet');
  }

  const byHandle = new Map(rollbacks.map((row) => [row.handle, row]));

  for (const row of imports) {
    if (row.compareAt !== '') {
      add(
        'import_carries_compare_at',
        row.handle,
        `import sets compare-at to "${row.compareAt}" instead of clearing it, ` +
          'so this row removes nothing',
      );
    }
    if (row.sku === '') {
      add(
        'missing_sku',
        row.handle,
        'import row has no SKU, so Shopify matches on handle plus option values alone',
      );
    }

    const rollback = byHandle.get(row.handle);
    if (rollback === undefined) {
      add(
        'rollback_record_missing',
        row.handle,
        'being changed by the import but absent from the rollback sheet, ' +
          'so its previous compare-at is not recorded anywhere and this row cannot be reverted',
      );
      continue;
    }

    const importCents = toCents(row.price);
    const liveCents = toCents(rollback.livePrice);
    if (importCents !== undefined && liveCents !== undefined && importCents !== liveCents) {
      add(
        'sheet_disagreement',
        row.handle,
        `import price ${formatCents(importCents)} but rollback records ` +
          `${formatCents(liveCents)}; one of the two sheets is stale`,
      );
    }
    if (row.sku !== '' && rollback.sku !== '' && row.sku !== rollback.sku) {
      add(
        'sheet_disagreement',
        row.handle,
        `import SKU "${row.sku}" but rollback SKU "${rollback.sku}"; ` +
          'the sheets may not describe the same variant',
      );
    }
  }
  return findings;
};

// ── expectations ─────────────────────────────────────────────────────────

/**
 * One expectation per import row. Rows whose price cannot be parsed are
 * skipped rather than defaulted: an expectation of $0.00 would report every
 * such product as mispriced and bury the real findings.
 */
export const buildExpectations = (
  imports: readonly ImportRow[],
  rollbacks: readonly RollbackRow[],
): readonly Expectation[] => {
  const byHandle = new Map(rollbacks.map((row) => [row.handle, row]));
  const out: Expectation[] = [];
  for (const row of imports) {
    const priceCents = toCents(row.price);
    if (priceCents === undefined) continue;
    const rollback = byHandle.get(row.handle);
    const oldCompareAt = rollback === undefined ? undefined : toCents(rollback.liveCompareAt);
    out.push({
      handle: row.handle,
      priceCents,
      expectNoCompareAt: true,
      // Unknown status is treated as published: checking a page that turns out
      // to be a draft costs one 404, while skipping a live one hides a defect.
      published: rollback === undefined || rollback.status !== 'DRAFT',
      visiblyChanged: oldCompareAt !== undefined && oldCompareAt > priceCents,
    });
  }
  return out;
};

// ── judging one observation ──────────────────────────────────────────────

/**
 * True when rendered text carries a money amount. Used to tell "the theme
 * printed a struck-through price" from "the element exists but is empty",
 * which many themes leave in the DOM as a placeholder. Treating an empty
 * element as a strikethrough would make every clean product a critical.
 */
export const hasMoney = (text: string | undefined): boolean =>
  text !== undefined && /\d/u.test(text) && toCents(text) !== undefined;

export const judge = (
  expectation: Expectation,
  observation: Observation,
): readonly Finding[] => {
  const findings: Finding[] = [];
  const add = (kind: CompareAtKind, detail: string): void => {
    findings.push({ severity: SEVERITY_OF[kind], kind, handle: expectation.handle, detail });
  };

  if (observation.status !== 200) {
    // A draft product is not on the storefront. Reporting that as a defect
    // would put 58 false criticals in front of whoever reads this.
    if (expectation.published) {
      add(
        'product_unreachable',
        `published product returned HTTP ${String(observation.status)}, so its ` +
          'compare-at price could not be checked',
      );
    }
    return findings;
  }

  // Vacuity guard. If the price selector matched nothing we know nothing, and
  // "no strikethrough found" is exactly what a blind run also reports. This
  // has to be a finding, or an unmapped theme reads as a clean pass.
  if (!hasMoney(observation.priceText)) {
    add(
      'price_not_observed',
      'page loaded but no price could be read. The selector does not match this ' +
        'theme — map it in config/kits.yaml under "selectors". Nothing about this ' +
        'product was verified.',
    );
    return findings;
  }

  if (hasMoney(observation.compareAtText)) {
    const shown = observation.compareAtText ?? '';
    add(
      'compare_at_still_rendered',
      `struck-through price "${shown.trim()}" is still shown next to ` +
        `${observation.priceText?.trim() ?? ''}. The compare-at removal did not take ` +
        'for this product, so customers still see a discount claim.',
    );
  }

  const observedCents = toCents(observation.priceText ?? '');
  if (observedCents !== undefined && observedCents !== expectation.priceCents) {
    add(
      'price_mismatch',
      `live price ${formatCents(observedCents)} but the import sheet says ` +
        `${formatCents(expectation.priceCents)}. The import was meant to clear ` +
        'compare-at and leave price untouched.',
    );
  }
  return findings;
};

// ── reporting ────────────────────────────────────────────────────────────

export type Tally = Readonly<Record<Severity, number>>;

export const tally = (findings: readonly Finding[]): Tally => {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, harness: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
};

/**
 * Harness findings are excluded deliberately: they are our own failures, not
 * the store's, so they must not be reported as store defects. They still show
 * in the tally, and still fail the run — see the runner's exit code.
 */
export const clientFindings = (findings: readonly Finding[]): readonly Finding[] =>
  findings.filter((finding) => finding.severity !== 'harness');
