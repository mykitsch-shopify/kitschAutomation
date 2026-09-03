import type { Rule } from 'eslint';

/**
 * Types for the plugin, which is authored in plain JS so ESLint can load it
 * without a build step. Without this, every consumer sees `any` and the
 * type-aware lint rules report the plugin's own tests as unsafe.
 */

export type KitschRule =
  | 'no-prod-target'
  | 'no-hardcoded-price'
  | 'no-write-operation'
  | 'require-spec-rationale';

declare const plugin: {
  readonly meta: { readonly name: string; readonly version: string };
  readonly rules: Readonly<Record<KitschRule, Rule.RuleModule>>;
};

export default plugin;
