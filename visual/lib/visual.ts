import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

/**
 * Visual regression — configuration and the pure decisions.
 *
 * Kept separate from the spec so the judgement can be unit-tested without a
 * browser. What is decided here: which shots exist, what their names are, and
 * whether a measured difference counts as a regression. What is not decided
 * here: anything requiring a screenshot — that is the spec's job.
 */

export type VisualPage = {
  readonly id: string;
  readonly path: string;
  /** Why this page is worth a baseline. Quoted into the report. */
  readonly why: string;
};

export type Viewport = { readonly id: string; readonly width: number; readonly height: number };

export type Mask = { readonly selector: string; readonly why: string };

export type VisualConfig = {
  readonly pages: readonly VisualPage[];
  readonly viewports: readonly Viewport[];
  readonly masks: readonly Mask[];
  readonly maxDiffRatio: number;
  readonly pixelThreshold: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, at: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`visual.yaml: "${at}" must be a non-empty string`);
  }
  return value.trim();
};

const requireNumber = (value: unknown, at: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`visual.yaml: "${at}" must be a number`);
  }
  return value;
};

export const loadVisualConfig = (path = 'config/visual.yaml'): VisualConfig => {
  const raw: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || !Array.isArray(raw.pages) || !Array.isArray(raw.viewports)) {
    throw new Error(`${path}: expected "pages" and "viewports"`);
  }
  if (raw.pages.length === 0) {
    // A visual suite with no pages passes instantly, every time, having
    // photographed nothing. That is the shape of failure this repo exists to
    // refuse, and it is one empty list away at all times.
    throw new Error(`${path}: "pages" is empty — the suite would compare nothing and pass.`);
  }
  if (raw.viewports.length === 0) {
    throw new Error(`${path}: "viewports" is empty — no shot would be taken.`);
  }

  const maxDiffRatio = requireNumber(raw.max_diff_ratio, 'max_diff_ratio');
  if (maxDiffRatio <= 0 || maxDiffRatio >= 1) {
    throw new Error(
      `${path}: max_diff_ratio is ${String(maxDiffRatio)}. It is a fraction of the frame, so it ` +
        'must sit between 0 and 1. At 0 nothing but the machine that made the baseline can pass; ' +
        'at 1 nothing can fail.',
    );
  }

  return {
    pages: raw.pages.map((entry, index) => {
      const at = `pages[${String(index)}]`;
      if (!isRecord(entry)) throw new Error(`${path}: expected a mapping at "${at}"`);
      return {
        id: requireString(entry.id, `${at}.id`),
        path: requireString(entry.path, `${at}.path`),
        why: requireString(entry.why, `${at}.why`),
      };
    }),
    viewports: raw.viewports.map((entry, index) => {
      const at = `viewports[${String(index)}]`;
      if (!isRecord(entry)) throw new Error(`${path}: expected a mapping at "${at}"`);
      return {
        id: requireString(entry.id, `${at}.id`),
        width: requireNumber(entry.width, `${at}.width`),
        height: requireNumber(entry.height, `${at}.height`),
      };
    }),
    masks: (Array.isArray(raw.masks) ? raw.masks : []).map((entry, index) => {
      const at = `masks[${String(index)}]`;
      if (!isRecord(entry)) throw new Error(`${path}: expected a mapping at "${at}"`);
      return {
        selector: requireString(entry.selector, `${at}.selector`),
        // Required, not optional. A mask is a deliberate blind spot, and one
        // added without a reason is indistinguishable from one added to make a
        // failing check go quiet.
        why: requireString(entry.why, `${at}.why`),
      };
    }),
    maxDiffRatio,
    pixelThreshold: requireNumber(raw.pixel_threshold, 'pixel_threshold'),
  };
};

/**
 * The name a baseline is stored under.
 *
 * Deterministic and readable, because these are committed files a human
 * reviews in a diff. `home-mobile.png` is reviewable; a hash is not.
 */
export const shotName = (pageId: string, viewportId: string): string =>
  `${pageId}-${viewportId}.png`;

/** Every shot the configuration implies, in a stable order. */
export const shotsFor = (
  config: VisualConfig,
): readonly { readonly page: VisualPage; readonly viewport: Viewport; readonly name: string }[] =>
  config.pages.flatMap((page) =>
    config.viewports.map((viewport) => ({
      page,
      viewport,
      name: shotName(page.id, viewport.id),
    })),
  );
