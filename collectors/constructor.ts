/**
 * Constructor search-index collector — read-only.
 *
 * Stubbed against the live API until Phase 1 credentials land (open question
 * §12.4). It is typed and shaped as the real client will be, so the specs
 * that depend on it are written against the final interface rather than
 * being rewritten later.
 */

export type SearchIndexClient = {
  readonly contains: (productId: string) => Promise<boolean>;
};

const endpoint = process.env.CONSTRUCTOR_API_URL;
const apiKey = process.env.CONSTRUCTOR_API_KEY;

export const searchIndex: SearchIndexClient = {
  contains: async (productId: string): Promise<boolean> => {
    if (endpoint === undefined || apiKey === undefined) {
      throw new Error(
        'CONSTRUCTOR_API_URL / CONSTRUCTOR_API_KEY are not set. The search-visibility spec needs a real index; it must not silently pass.',
      );
    }
    const response = await fetch(
      `${endpoint}/search/items/${encodeURIComponent(productId)}?key=${encodeURIComponent(apiKey)}`,
      { headers: { 'X-Kitsch-QA': 'playwright' } },
    );
    return response.ok;
  },
};
