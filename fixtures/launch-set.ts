import { LAUNCH_HANDLE } from './catalog/content.js';

/**
 * Launch fixture set.
 *
 * Resolved at runtime, never hardcoded prices or inventory counts. A stale
 * expected value produces a green test asserting the wrong number, which is
 * the worst failure mode available to a suite like this — see
 * FRAMEWORK-AND-ROADMAP.md §8.
 */

export type LaunchSku = {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly searchTerm: string;
};

export const launchSet: { readonly primary: LaunchSku } = {
  primary: {
    id: process.env.KITSCH_LAUNCH_SKU_ID ?? 'gid://shopify/Product/8801',
    handle: process.env.KITSCH_LAUNCH_HANDLE ?? LAUNCH_HANDLE,
    title: 'Satin Pillowcase Set',
    searchTerm: 'satin pillowcase',
  },
};

export const resolveLaunchHandle = (): string => launchSet.primary.handle;
