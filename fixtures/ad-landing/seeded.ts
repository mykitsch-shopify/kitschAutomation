/**
 * Defects the seeded ad-landing fixture plants, and nothing else.
 *
 * One per check in the daily brief, so no check is claimed without having been
 * watched to fail.
 *
 * One case is deliberately absent: "in stock but redirected away". It is not
 * decidable from the storefront — once a product URL redirects, its page never
 * renders, so there is no stock state to read. Catching it needs inventory from
 * the Admin API, which this suite does not have. A redirect to the configured
 * substitute is therefore accepted whether or not the product was actually out
 * of stock. Kept apart from server.ts because that module listens on a
 * port as an import side effect.
 */

export type SeededDefect = {
  readonly kind: string;
  readonly where: string;
  readonly note: string;
};

export const SEEDED: readonly SeededDefect[] = [
  {
    kind: 'compare_at_invalid',
    where: 'seed-bad-compare-at',
    note: 'struck-through price equal to the selling price — a saving that does not exist',
  },
  {
    kind: 'autoship_not_cheaper',
    where: 'seed-autoship-flat',
    note: 'auto-ship priced the same as one-time, so subscribing saves nothing',
  },
  {
    kind: 'autoship_rate_wrong',
    where: 'seed-autoship-offrate',
    note: 'auto-ship discounted by 5% where the configured rate is 15%',
  },
  {
    kind: 'byob_no_options',
    where: 'seed-byob-empty',
    note: 'builder renders with nothing to build from',
  },
  {
    kind: 'byob_price_static',
    where: 'seed-byob-static',
    note: 'bundle price does not move when items are chosen',
  },
  {
    kind: 'oos_no_redirect',
    where: 'seed-oos-stranded',
    note: 'sold out and still serving its own page, stranding ad traffic',
  },
  {
    kind: 'oos_wrong_target',
    where: 'seed-oos-misrouted',
    note: 'sold out and redirected somewhere other than the configured substitute',
  },
  {
    kind: 'redirect_wrong_target',
    where: '/discount/SEEDWRONG',
    note: 'discount link lands on the homepage instead of the offer',
  },
  {
    kind: 'redirect_broken',
    where: '/discount/SEEDDEAD',
    note: 'discount link 404s',
  },
  {
    kind: 'discount_stacked',
    where: 'SEEDFIXED + SEEDWIDE',
    note: 'a site-wide code stacks on a fixed-discount code that must not stack',
  },
];
