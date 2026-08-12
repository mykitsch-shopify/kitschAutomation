/**
 * eslint-plugin-kitsch — four rules, each one a standing agreement from
 * FRAMEWORK-AND-ROADMAP.md that is otherwise enforced by memory.
 *
 * Written as ESM on purpose. The proposal's §14 notes that the existing
 * plugin is CommonJS while package.json declares "type": "module", which
 * makes ESLint fail to load it outright. Starting fresh, that trap is simply
 * avoided rather than worked around.
 *
 * Deliberately small. A lint plugin that tries to encode taste produces
 * arguments; these four encode decisions that were already made and that
 * cost real money when broken.
 */

/** §8 — production is read-only, always, including "just to reproduce". */
const noProdTarget = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow production URLs as harness targets' },
    schema: [],
    messages: {
      prodTarget:
        'Production URL "{{url}}" must not appear outside tests. The harness never points at production — use KITSCH_BASE_URL and the dev store.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const match = /^https?:\/\/(?:www\.)?mykitsch\.com/u.exec(node.value);
        if (match) {
          context.report({ node, messageId: 'prodTarget', data: { url: match[0] } });
        }
      },
    };
  },
};

/**
 * §8 — no hardcoded prices in specs. A stale expected value produces a green
 * test asserting the wrong number, which is the worst failure mode available.
 */
const noHardcodedPrice = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow currency literals in specs' },
    schema: [],
    messages: {
      hardcodedPrice:
        'Hardcoded price "{{value}}" in a spec. Prices go stale and a stale expected value yields a green test asserting the wrong number — resolve fixtures at runtime, or assert the format via config.',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (/[$€£¥₩]\s?\d|\d[.,]\d{2}\s?[€£]/u.test(node.value)) {
          context.report({ node, messageId: 'hardcodedPrice', data: { value: node.value } });
        }
      },
    };
  },
};

/**
 * §4 — collectors never write. GraphQL reads are POSTs, so the method proves
 * nothing; the mutation keyword is the honest signal.
 */
const noWriteOperation = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow GraphQL mutations in read-only collectors' },
    schema: [],
    messages: {
      mutation:
        'GraphQL mutation in a collector. Collectors are read-only by contract — anything that writes belongs under integration/, against the dev store.',
    },
  },
  create(context) {
    const check = (node, raw) => {
      if (/\bmutation\s+\w/u.test(raw)) {
        context.report({ node, messageId: 'mutation' });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

/**
 * §1 — "Before any spec is written, it has to answer: what does this catch
 * that an API-level check cannot?" Mechanical proxy: the spec must carry a
 * block comment saying so. It cannot judge the answer, only that one was
 * given, which is enough to make the question unavoidable in review.
 */
const requireSpecRationale = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Require specs to state what they catch that an API check cannot' },
    schema: [{ type: 'object', properties: { minLength: { type: 'integer' } }, additionalProperties: false }],
    messages: {
      missing:
        'This spec has no rationale comment. Every spec must state what it catches that an API-level check cannot — the UI layer is the thinnest layer here on purpose.',
    },
  },
  create(context) {
    const minLength = context.options[0]?.minLength ?? 80;
    return {
      'Program:exit'(node) {
        const comments = context.sourceCode.getAllComments();
        const hasRationale = comments.some(
          (comment) => comment.type === 'Block' && comment.value.trim().length >= minLength,
        );
        if (!hasRationale) {
          context.report({ node, messageId: 'missing' });
        }
      },
    };
  },
};

export default {
  meta: { name: 'eslint-plugin-kitsch', version: '0.1.0' },
  rules: {
    'no-prod-target': noProdTarget,
    'no-hardcoded-price': noHardcodedPrice,
    'no-write-operation': noWriteOperation,
    'require-spec-rationale': requireSpecRationale,
  },
};
