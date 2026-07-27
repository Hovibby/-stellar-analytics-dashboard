/**
 * no-unhandled-promise-in-resolver
 *
 * Detects `async` resolver functions that contain floating Promise calls —
 * `await`-less invocations of async methods — which silently swallow errors
 * in the GraphQL execution context.
 *
 * Why this matters
 *   When a resolver fires a side-effect (cache update, pub/sub publish,
 *   metrics increment, etc.) without `await` AND without `.catch()`, any
 *   rejection from that call:
 *     - Is NOT surfaced as a GraphQL error to the client
 *     - May cause an unhandledRejection that crashes the Node.js process
 *       (with --unhandled-rejections=throw, which is the default since v15)
 *
 * What is flagged
 *   A `CallExpression` inside an `async` function that:
 *     1. Is NOT preceded by `await`
 *     2. Is NOT assigned to a variable (`.then()` chained) or returned
 *     3. Calls a method whose name is in the "known async" set:
 *        cacheSet, cacheGet, cacheDel, incrementCacheMetric, publish,
 *        alertService.*, broadcastRealtimeUpdate, etc.
 *
 * What is NOT flagged
 *   - `void somePromise()` — explicit discard is intentional
 *   - `.catch()` chains — the rejection is handled
 *   - Top-level `setInterval` / `setTimeout` callbacks
 *
 * @example
 * // ❌ Flagged
 * async function resolver() {
 *   const result = await db.query(sql, params);
 *   db.cacheSet(key, result, TTL);   // floating — rejection swallowed
 *   return result;
 * }
 *
 * // ✅ Allowed
 * async function resolver() {
 *   const result = await db.query(sql, params);
 *   await db.cacheSet(key, result, TTL);
 *   return result;
 * }
 *
 * // ✅ Also allowed (explicit discard)
 * async function resolver() {
 *   void db.incrementCacheMetric('ledgers');
 *   return result;
 * }
 */

import type { Rule } from 'eslint';

// Names of methods / functions that return Promises and MUST be awaited
// unless the developer explicitly uses `void` to signal intentional discard.
const ASYNC_METHOD_NAMES = new Set([
  // database / cache
  'cacheSet',
  'cacheGet',
  'cacheDel',
  'cacheDelPattern',
  'cacheExists',
  'cacheRefresh',
  'incrementCacheMetric',
  'query',
  'queryOne',
  'queryMany',
  // pub-sub
  'publish',
  // realtime / websocket
  'broadcastRealtimeUpdate',
  // alerting
  'alertLedgerProcessingError',
  'alertHighErrorRate',
  'alertDatabaseError',
  'alertCircuitBreakerOpen',
  'alertGracefulShutdown',
  // DataLoader
  'load',
  'loadMany',
  'clearAll',
  'prime',
]);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    hasSuggestions: true,
    docs: {
      description:
        'Disallow floating (unawaited, uncaught) Promise calls inside async resolver and indexer functions. Add `await`, chain `.catch()`, or use `void` for intentional discards.',
      recommended: true,
      url: 'https://github.com/your-org/stellar-analytics-dashboard/blob/main/docs/static-analysis.md',
    },
    messages: {
      floatingPromise:
        'Possible unhandled Promise: `{{call}}` is not awaited and has no .catch() handler. ' +
        'Add `await`, chain `.catch()`, or use `void {{call}}` to signal intentional discard.',
      addAwait: 'Add `await` before this call.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          additionalAsyncMethods: {
            type: 'array',
            items: { type: 'string' },
          },
          // Patterns in file paths where this rule applies
          filePatterns: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] as {
      additionalAsyncMethods?: string[];
      filePatterns?: string[];
    }) ?? {};

    const asyncMethods = new Set([
      ...ASYNC_METHOD_NAMES,
      ...(options.additionalAsyncMethods ?? []),
    ]);

    const filePatterns = options.filePatterns ?? [
      '/resolvers/',
      '/indexer/',
      '/loader.',
      '/ingester.',
    ];

    const filename = context.getFilename();
    const appliesToFile = filePatterns.some((p) => filename.includes(p));
    if (!appliesToFile) return {};

    // Track the nearest enclosing async function
    const asyncFunctionStack: boolean[] = [];

    function isInAsync(): boolean {
      return asyncFunctionStack.length > 0 &&
        asyncFunctionStack[asyncFunctionStack.length - 1];
    }

    function pushAsync(node: any) {
      asyncFunctionStack.push(!!node.async);
    }

    function popAsync() {
      asyncFunctionStack.pop();
    }

    /** Returns true when the call is already handled (awaited / .catch chained / void-ed / assigned). */
    function isHandled(node: any): boolean {
      const parent = node.parent;
      if (!parent) return false;

      // await someCall()
      if (parent.type === 'AwaitExpression') return true;

      // void someCall()
      if (
        parent.type === 'UnaryExpression' &&
        parent.operator === 'void'
      )
        return true;

      // const x = someCall() — assignment / declaration
      if (
        parent.type === 'VariableDeclarator' ||
        parent.type === 'AssignmentExpression'
      )
        return true;

      // return someCall()
      if (parent.type === 'ReturnStatement') return true;

      // someCall().catch(…) or someCall().then(…)
      if (
        parent.type === 'MemberExpression' &&
        parent.object === node &&
        (parent.property?.name === 'catch' ||
          parent.property?.name === 'then' ||
          parent.property?.name === 'finally')
      )
        return true;

      // someCall().catch(…) — the outer CallExpression
      if (
        parent.type === 'CallExpression' &&
        parent.callee?.type === 'MemberExpression' &&
        (parent.callee.property?.name === 'catch' ||
          parent.callee.property?.name === 'then' ||
          parent.callee.property?.name === 'finally')
      )
        return true;

      // Promise.all([someCall()]) — handled by the outer await
      if (
        parent.type === 'ArrayExpression' &&
        parent.parent?.type === 'CallExpression' &&
        parent.parent.callee?.type === 'MemberExpression' &&
        parent.parent.callee.object?.name === 'Promise'
      )
        return true;

      return false;
    }

    /** Extract a short human-readable name for the call for the error message. */
    function callName(node: any): string {
      const callee = node.callee;
      if (callee.type === 'MemberExpression') {
        const obj = callee.object?.name ?? callee.object?.property?.name ?? '…';
        const method = callee.property?.name ?? '…';
        return `${obj}.${method}()`;
      }
      return callee.name ? `${callee.name}()` : '(expression)()';
    }

    /** Returns true when the CallExpression targets one of our async methods. */
    function isKnownAsyncCall(node: any): boolean {
      const callee = node.callee;
      if (callee.type === 'MemberExpression') {
        return asyncMethods.has(callee.property?.name ?? '');
      }
      // Top-level function call
      return asyncMethods.has(callee.name ?? '');
    }

    return {
      FunctionDeclaration: pushAsync,
      'FunctionDeclaration:exit': popAsync,
      FunctionExpression: pushAsync,
      'FunctionExpression:exit': popAsync,
      ArrowFunctionExpression: pushAsync,
      'ArrowFunctionExpression:exit': popAsync,

      CallExpression(node: any) {
        if (!isInAsync()) return;
        if (!isKnownAsyncCall(node)) return;
        if (isHandled(node)) return;

        const name = callName(node);
        context.report({
          node,
          messageId: 'floatingPromise',
          data: { call: name },
          suggest: [
            {
              messageId: 'addAwait',
              fix(fixer) {
                return fixer.insertTextBefore(node, 'await ');
              },
            },
          ],
        });
      },
    };
  },
};

export default rule;
