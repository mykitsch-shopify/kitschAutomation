/**
 * Declared SLAs for the asynchronous nodes in the stack.
 *
 * These are budgets, not guesses: a check that exceeds one is reported as an
 * SLA breach with the elapsed time attached, which is a different finding
 * from "the UI is broken" and routes differently.
 */

export const sla = {
  constructor: {
    /** Catalog write → searchable in the index. */
    catalogPropagation: 120_000,
  },
  shopify: {
    /** Translation registered → served by the storefront. */
    translationPropagation: 60_000,
  },
} as const;
