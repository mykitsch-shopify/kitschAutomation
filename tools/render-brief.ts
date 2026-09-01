import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

/**
 * Renders docs/QA-AUTOMATION-BRIEF.md to a Kitsch-branded PDF.
 *
 *   npm run brief
 *
 * The markdown is the maintained source; the PDF is a build artifact of it.
 * Editing the PDF directly would fork the two, and the version somebody
 * forwards would stop being the version anybody reviews.
 *
 * The markdown subset understood here is deliberately small — headings,
 * tables, lists, bold, code, rules — because that is all this document uses.
 * Anything unrecognised is emitted verbatim rather than dropped, so a new
 * construct shows up in the PDF as raw text instead of disappearing quietly.
 */

const SOURCE = 'docs/QA-AUTOMATION-BRIEF.md';
const OUTPUT = 'docs/QA-Automation-Brief.pdf';

const escapeHtml = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const inline = (text: string): string =>
  escapeHtml(text)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>');

const cells = (row: string): readonly string[] =>
  row
    .trim()
    .replace(/^\||\|$/gu, '')
    .split('|')
    .map((cell) => cell.trim());

const isBlockStart = (line: string): boolean =>
  /^(#{1,6}\s|-{3,}$)/u.test(line.trim()) ||
  line.trim().startsWith('|') ||
  /^\s*([-*]|\d+\.)\s+/u.test(line);

/** Collects a run of list items, folding soft-wrapped continuations back in. */
const collectItems = (
  lines: readonly string[],
  from: number,
  marker: RegExp,
): { readonly items: readonly string[]; readonly next: number } => {
  const items: string[] = [];
  let index = from;
  while (index < lines.length && (lines[index] ?? '').trim() !== '') {
    const started = marker.exec(lines[index] ?? '');
    if (started?.[1] !== undefined) items.push(started[1]);
    else if (items.length > 0) items[items.length - 1] += ` ${(lines[index] ?? '').trim()}`;
    else break;
    index += 1;
  }
  return { items, next: index };
};

const toHtml = (markdown: string): string => {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (/^-{3,}$/u.test(line.trim())) {
      html.push('<hr />');
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      const level = heading[1].length;
      html.push(`<h${String(level)}>${inline(heading[2])}</h${String(level)}>`);
      index += 1;
      continue;
    }

    // A table is a header row followed by a row of dashes.
    if (line.trim().startsWith('|') && (lines[index + 1] ?? '').includes('---')) {
      const header = cells(line);
      index += 2;
      const body: (readonly string[])[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        body.push(cells(lines[index] ?? ''));
        index += 1;
      }
      html.push(
        `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body
            .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
      );
      continue;
    }

    if (/^\s*[-*]\s+/u.test(line)) {
      const { items, next } = collectItems(lines, index, /^\s*[-*]\s+(.*)$/u);
      html.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      index = next;
      continue;
    }

    if (/^\s*\d+\.\s+/u.test(line)) {
      const { items, next } = collectItems(lines, index, /^\s*\d+\.\s+(.*)$/u);
      html.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`);
      index = next;
      continue;
    }

    // Paragraph — rejoins soft-wrapped lines.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !isBlockStart(lines[index] ?? '')
    ) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return html.join('\n');
};

/**
 * Kitsch palette and type, per the brand guidelines.
 *
 * Tiempos Headline and Neue Haas Grotesk are licensed and not installed on a
 * CI runner, so each stack names the real face first and falls back to the
 * closest available serif and grotesque. Naming them keeps the document
 * correct on a machine that does have them.
 */
const documentFor = (body: string): string => `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 20mm 16mm 18mm; }
  :root {
    --pink: #EAD3C6;
    --rose: #CA9A8E;
    --cream: #F0E5D7;
    --charcoal: #53565A;
    --gray: #D9D9D6;
    --black: #231F20;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Neue Haas Grotesk Display Pro", "Helvetica Neue", Arial, sans-serif;
    font-size: 9.4pt;
    line-height: 1.5;
    color: var(--black);
    letter-spacing: 0;
  }
  h1, h2, h3 {
    font-family: "Tiempos Headline", "Iowan Old Style", Georgia, "Times New Roman", serif;
    font-weight: 400;
    letter-spacing: 0;
  }
  h1 { font-size: 23pt; line-height: 1.15; margin: 0 0 4mm; }
  h2 {
    font-size: 14pt;
    margin: 9mm 0 3mm;
    padding-bottom: 2mm;
    border-bottom: 1.5pt solid var(--pink);
    break-after: avoid;
  }
  h3 { font-size: 11pt; margin: 6mm 0 2mm; color: var(--charcoal); break-after: avoid; }
  p { margin: 0 0 3mm; }
  strong { font-weight: 600; }
  code {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.87em;
    background: var(--cream);
    padding: 0.4mm 1mm;
    border-radius: 1mm;
  }
  ul, ol { margin: 0 0 3mm; padding-left: 5mm; }
  li { margin-bottom: 1.2mm; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 4mm;
    font-size: 8.6pt;
  }
  tr { break-inside: avoid; }
  th {
    text-align: left;
    font-weight: 600;
    font-size: 7.4pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--charcoal);
    background: var(--cream);
    padding: 2mm 2.2mm;
    border-bottom: 1pt solid var(--rose);
  }
  td { padding: 2mm 2.2mm; border-bottom: 0.5pt solid var(--gray); vertical-align: top; }
  hr { border: none; border-top: 0.5pt solid var(--gray); margin: 7mm 0; }
  .wordmark {
    font-size: 10pt;
    letter-spacing: 0.42em;
    font-weight: 500;
    margin-bottom: 7mm;
  }
  .rule-pink { height: 3mm; background: var(--pink); margin-bottom: 6mm; }
  .kicker {
    font-size: 7.6pt;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--rose);
    margin-bottom: 2mm;
  }
</style></head>
<body>
  <div class="wordmark">KITSCH</div>
  <div class="rule-pink"></div>
  <div class="kicker">Internal · QA Automation</div>
  ${body}
</body></html>`;

const page = documentFor(toHtml(readFileSync(SOURCE, 'utf8')));

// Same escape hatch as playwright.config.ts, for images whose bundled Chromium
// build does not match the pinned @playwright/test version.
const executablePath = process.env.KITSCH_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
const tab = await browser.newPage();
await tab.setContent(page, { waitUntil: 'load' });
await tab.pdf({
  path: OUTPUT,
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '15mm', right: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate:
    '<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#53565A;' +
    'padding:0 15mm;display:flex;justify-content:space-between;">' +
    '<span>KITSCH · QA Automation · Internal</span>' +
    '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
});
await browser.close();

process.stdout.write(`wrote ${OUTPUT}\n`);
