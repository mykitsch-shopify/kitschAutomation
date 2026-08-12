import type { TranslationEntry } from '../i18n/lib/locale-parity.js';

/**
 * Shopify translations collector — read-only.
 *
 * The one net-new collector the framework proposal called for. It issues
 * Admin GraphQL `translatableResources` queries and nothing else: no
 * mutations, no `translationsRegister`, no writes of any kind. The token this
 * runs under should be scoped `read_translations, read_products,
 * read_online_store_pages` and nothing more.
 *
 * Two behaviours here are load-bearing:
 *
 *   1. It paginates. Sampling the first page and calling the catalogue clean
 *      is the failure mode that makes a translation gate worthless.
 *   2. It distinguishes "fetch failed" from "value absent". Collapsing those
 *      two turns an outage into a green run, which is worse than no run.
 */

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2025-07';
const PAGE_SIZE = 50;

/** Admin API throttling is expected, not exceptional. Back off and continue. */
const THROTTLE_BACKOFF_MS = 2_000;
const MAX_ATTEMPTS = 4;

type TranslatableContent = {
  readonly key: string;
  readonly value: string | null;
  readonly locale: string;
};

type TranslationValue = {
  readonly key: string;
  readonly value: string | null;
  readonly locale: string;
};

type ResourceNode = {
  readonly resourceId: string;
  readonly translatableContent: readonly TranslatableContent[];
  readonly translations: readonly TranslationValue[] | null;
};

type PageResult = {
  readonly nodes: readonly ResourceNode[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
};

type GraphQLResponse = {
  readonly data?: {
    readonly translatableResources?: {
      readonly edges: readonly { readonly cursor: string; readonly node: ResourceNode }[];
      readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
    };
  };
  readonly errors?: readonly { readonly message: string }[];
};

const QUERY = `
  query TranslatableResources($type: TranslatableResourceType!, $locale: String!, $first: Int!, $after: String) {
    translatableResources(resourceType: $type, first: $first, after: $after) {
      edges {
        cursor
        node {
          resourceId
          translatableContent { key value locale }
          translations(locale: $locale) { key value locale }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export class ShopifyCollectorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ShopifyCollectorError';
  }
}

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new ShopifyCollectorError(
      `${name} is not set. The translations collector is read-only but still needs a scoped Admin token.`,
    );
  }
  return value;
};

/** Stable, human-readable key. Resource id alone tells triage nothing. */
const entryKey = (resourceType: string, resourceId: string, field: string): string => {
  const numericId = resourceId.split('/').pop() ?? resourceId;
  return `${resourceType.toLowerCase()}.${numericId}.${field}`;
};

export type ShopifyCollectorOptions = {
  readonly shopDomain?: string;
  readonly adminToken?: string;
  readonly fetchImpl?: typeof fetch;
};

export const createShopifyTranslationCollector = (
  options: ShopifyCollectorOptions = {},
): {
  readonly fetchCatalog: (
    locale: string,
    resourceTypes: readonly string[],
  ) => Promise<readonly TranslationEntry[]>;
} => {
  const shopDomain = options.shopDomain ?? requireEnv('SHOPIFY_SHOP_DOMAIN');
  const adminToken = options.adminToken ?? requireEnv('SHOPIFY_ADMIN_TOKEN');
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  const requestPage = async (
    resourceType: string,
    locale: string,
    after: string | null,
  ): Promise<PageResult> => {
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': adminToken,
          'X-Kitsch-QA': 'locale-parity',
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { type: resourceType, locale, first: PAGE_SIZE, after },
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${String(response.status)}`;
        await sleep(THROTTLE_BACKOFF_MS * attempt);
        continue;
      }
      if (!response.ok) {
        throw new ShopifyCollectorError(
          `Admin API returned HTTP ${String(response.status)} for ${resourceType}/${locale}`,
        );
      }

      const body = (await response.json()) as GraphQLResponse;

      const throttled = body.errors?.some((error) => /throttl/iu.test(error.message)) ?? false;
      if (throttled) {
        lastError = 'THROTTLED';
        await sleep(THROTTLE_BACKOFF_MS * attempt);
        continue;
      }
      if (body.errors !== undefined && body.errors.length > 0) {
        throw new ShopifyCollectorError(
          `Admin API error for ${resourceType}/${locale}: ${body.errors.map((error) => error.message).join('; ')}`,
        );
      }

      const resources = body.data?.translatableResources;
      if (resources === undefined) {
        throw new ShopifyCollectorError(
          `Admin API returned no translatableResources block for ${resourceType}/${locale}`,
        );
      }

      return {
        nodes: resources.edges.map((edge) => edge.node),
        hasNextPage: resources.pageInfo.hasNextPage,
        endCursor: resources.pageInfo.endCursor,
      };
    }

    throw new ShopifyCollectorError(
      `Admin API did not settle after ${String(MAX_ATTEMPTS)} attempts for ${resourceType}/${locale}: ${lastError}`,
    );
  };

  const collectResourceType = async (
    resourceType: string,
    locale: string,
    isSource: boolean,
  ): Promise<readonly TranslationEntry[]> => {
    const entries: TranslationEntry[] = [];
    let cursor: string | null = null;

    // Paginate to exhaustion. A partial catalogue reported as complete is the
    // one outcome this collector must never produce.
    for (;;) {
      let page: PageResult;
      try {
        page = await requestPage(resourceType, locale, cursor);
      } catch (error) {
        // Surface the failure as data, not as an exception that aborts the
        // whole run: one broken resource type must not erase the findings
        // from the seven that worked.
        entries.push({
          key: `${resourceType.toLowerCase()}.<fetch>`,
          locale,
          resourceType,
          resourceId: `resourceType:${resourceType}`,
          status: 'fetch_failed',
          value: undefined,
        });
        process.stderr.write(
          `collector: ${resourceType}/${locale} failed — ${error instanceof Error ? error.message : String(error)}\n`,
        );
        break;
      }

      for (const node of page.nodes) {
        const translated = new Map<string, string | null>(
          (node.translations ?? []).map((translation) => [translation.key, translation.value]),
        );

        for (const content of node.translatableContent) {
          const key = entryKey(resourceType, node.resourceId, content.key);

          if (isSource) {
            entries.push({
              key,
              locale,
              resourceType,
              resourceId: node.resourceId,
              status: content.value === null ? 'absent' : 'present',
              value: content.value ?? undefined,
            });
            continue;
          }

          const hasTranslation = translated.has(content.key);
          const value = translated.get(content.key) ?? null;
          entries.push({
            key,
            locale,
            resourceType,
            resourceId: node.resourceId,
            status: hasTranslation && value !== null ? 'present' : 'absent',
            value: value ?? undefined,
          });
        }
      }

      if (!page.hasNextPage || page.endCursor === null) {
        break;
      }
      cursor = page.endCursor;
    }

    return entries;
  };

  return {
    fetchCatalog: async (
      locale: string,
      resourceTypes: readonly string[],
    ): Promise<readonly TranslationEntry[]> => {
      const isSource = locale === (process.env.KITSCH_SOURCE_LOCALE ?? 'en');
      const all: TranslationEntry[] = [];
      for (const resourceType of resourceTypes) {
        all.push(...(await collectResourceType(resourceType, locale, isSource)));
      }
      return all;
    },
  };
};
