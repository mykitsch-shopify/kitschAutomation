import { test } from 'node:test';

import { RuleTester } from 'eslint';

import kitsch from '../eslint-plugin-kitsch/index.js';

/**
 * Negative control for the lint layer.
 *
 * A rule that never fires is the same hazard as a comparator that never
 * fires: the gate stays green and nobody notices it stopped looking. Each
 * rule below is given code it must reject and code it must accept.
 */

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

const rules = kitsch.rules;

void test('no-prod-target rejects a production URL and accepts the dev store', () => {
  ruleTester.run('no-prod-target', rules['no-prod-target'], {
    valid: [
      { code: "const baseURL = 'https://kitsch-dev.myshopify.com';" },
      { code: "const email = 'qa@mykitsch.com';" },
      { code: "const baseURL = process.env.KITSCH_BASE_URL;" },
    ],
    invalid: [
      {
        code: "const baseURL = 'https://mykitsch.com';",
        errors: [{ messageId: 'prodTarget' }],
      },
      {
        code: "await page.goto('https://www.mykitsch.com/fr/cart');",
        errors: [{ messageId: 'prodTarget' }],
      },
    ],
  });
});

void test('no-hardcoded-price rejects currency literals', () => {
  ruleTester.run('no-hardcoded-price', rules['no-hardcoded-price'], {
    valid: [
      { code: "expect(price).toMatch(locale.pricePattern);" },
      { code: "const handle = 'satin-pillowcase-set';" },
    ],
    invalid: [
      { code: "expect(price).toBe('$24.00');", errors: [{ messageId: 'hardcodedPrice' }] },
      { code: "expect(total).toBe('24,00 €');", errors: [{ messageId: 'hardcodedPrice' }] },
      { code: "expect(krw).toBe('₩32,000');", errors: [{ messageId: 'hardcodedPrice' }] },
    ],
  });
});

void test('no-write-operation rejects a GraphQL mutation in a collector', () => {
  ruleTester.run('no-write-operation', rules['no-write-operation'], {
    valid: [
      // GraphQL reads are POSTs, so the method proves nothing — only the
      // mutation keyword does.
      { code: "const QUERY = `query TranslatableResources { translatableResources { id } }`;" },
      { code: "const method = 'POST';" },
    ],
    invalid: [
      {
        code: "const M = `mutation translationsRegister($id: ID!) { translationsRegister { id } }`;",
        errors: [{ messageId: 'mutation' }],
      },
      {
        code: "const M = 'mutation productUpdate { id }';",
        errors: [{ messageId: 'mutation' }],
      },
    ],
  });
});

void test('require-spec-rationale demands a stated reason for a spec to exist', () => {
  ruleTester.run('require-spec-rationale', rules['require-spec-rationale'], {
    valid: [
      {
        code: `/**
 * What this catches that an API check cannot: a SKU present in the index but
 * not rendering in the results grid — a template or client-filter defect the
 * reconciliation engine cannot see.
 */
test('renders', () => {});`,
      },
    ],
    invalid: [
      { code: "test('renders', () => {});", errors: [{ messageId: 'missing' }] },
      {
        // A short comment is not a rationale.
        code: "/* smoke */\ntest('renders', () => {});",
        errors: [{ messageId: 'missing' }],
      },
    ],
  });
});
