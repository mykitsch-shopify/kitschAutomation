import { CATEGORIES } from './tools/lib/allure.js';

/**
 * Allure 3 report configuration.
 *
 * The categories are imported rather than restated. They exist in
 * tools/lib/allure.ts because the audits write them into the results directory
 * too (Allure 2's `allure-commandline` reads them from there, this config is
 * how Allure 3 wants them) — and a severity scheme that is defined twice is a
 * severity scheme that will eventually disagree with itself about what
 * "critical" means.
 *
 * `groupBy` is parentSuite then suite: the eight suites first, then the item
 * inside each. A reader who wants to know "is the ad-traffic check clean?"
 * should not have to know a product handle to find out.
 */
export default {
  name: 'Kitsch QA',
  categories: [...CATEGORIES],
  plugins: {
    awesome: {
      options: {
        reportName: 'Kitsch QA',
        groupBy: ['parentSuite', 'suite'],
        theme: 'auto',
        // Passing checks are the denominator: 9 failures out of 12 and 9 out
        // of 600 are different stores, and the report has to show which.
        defaultSection: 'suites',
      },
    },
  },
};
