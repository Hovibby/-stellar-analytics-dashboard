/**
 * require-auth-check
 *
 * Enforces that every GraphQL mutation resolver checks `context.user` (or
 * throws an AuthError) before performing any data mutation or privileged
 * read.
 *
 * Why this matters
 *   The pattern `if (!context.user) throw new AuthError()` is the first line
 *   of defence before any DB write in the API.  Forgetting it — even once —
 *   exposes a write endpoint to unauthenticated callers.
 *
 * What is flagged
 *   A function registered under `Mutation: { … }` that does NOT contain a
 *   check of the form:
 *     if (!context.user)  throw …
 *     if (!ctx.user)      throw …
 *
 * What is NOT flagged
 *   - Query resolvers (reads are rate-limited, not auth-gated by default)
 *   - Subscription resolvers
 *   - Any function that explicitly calls `withResolverLogging(…, async (…,
 *     context, …) => { if (!context.user) … })` — the check is nested but
 *     still present
 *
 * @example
 * // ❌ Flagged — no auth check before DB write
 * Mutation: {
 *   deleteAccount: async (_, args, context) => {
 *     await db.query('DELETE FROM accounts WHERE id = $1', [args.id]);
 *   }
 * }
 *
 * // ✅ Allowed
 * Mutation: {
 *   deleteAccount: async (_, args, context) => {
 *     if (!context.user) throw new AuthError();
 *     await db.query('DELETE FROM accounts WHERE id = $1', [args.id]);
 *   }
 * }
 */

import type { Rule } from 'eslint';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require an authentication guard (if (!context.user) throw …) at the start of every Mutation resolver.',
      recommended: true,
      url: 'https://github.com/your-org/stellar-analytics-dashboard/blob/main/docs/static-analysis.md',
    },
    messages: {
      missingAuthCheck:
        'Mutation resolver "{{name}}" does not check `context.user` before executing. ' +
        'Add `if (!context.user) throw new AuthError();` as the first statement.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Extra context variable names beyond "context" and "ctx"
          contextAliases: {
            type: 'array',
            items: { type: 'string' },
          },
          // File patterns where this rule applies (default: **/resolvers/**)
          resolverPattern: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = (context.options[0] as {
      contextAliases?: string[];
      resolverPattern?: string;
    }) ?? {};

    const resolverPattern = options.resolverPattern ?? '/resolvers/';
    const ctxNames = new Set(['context', 'ctx', ...(options.contextAliases ?? [])]);

    const filename = context.getFilename();
    if (!filename.includes(resolverPattern)) {
      return {};
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /** Walk an AST node's ancestor chain; yields each ancestor. */
    function* ancestors(node: any): Iterable<any> {
      let cur = node.parent;
      while (cur) {
        yield cur;
        cur = cur.parent;
      }
    }

    /**
     * Returns true when `node` is a property of an object that is itself the
     * value of a `Mutation` property, handling the common patterns:
     *
     *   export const resolvers = { Mutation: { login: … } }
     *   Mutation: { login: withResolverLogging('…', async (…) => { … }) }
     */
    function isInsideMutationObject(node: any): boolean {
      for (const ancestor of ancestors(node)) {
        if (
          ancestor.type === 'Property' &&
          ancestor.key?.name === 'Mutation' &&
          ancestor.value?.type === 'ObjectExpression'
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * Returns true when the function body contains a guard of the form:
     *   if (!context.user) …  /  if (!ctx.user) …
     *   or context.user === null / undefined checks.
     */
    function containsAuthCheck(funcNode: any): boolean {
      const body = funcNode.body;
      if (!body || body.type !== 'BlockStatement') return false;

      function walkStatements(statements: any[]): boolean {
        for (const stmt of statements) {
          if (stmt.type === 'IfStatement') {
            const test = stmt.test;
            // Pattern: if (!context.user)
            if (
              test.type === 'UnaryExpression' &&
              test.operator === '!' &&
              test.argument?.type === 'MemberExpression' &&
              ctxNames.has(test.argument.object?.name) &&
              test.argument.property?.name === 'user'
            ) {
              return true;
            }
            // Pattern: if (context.user === null || …)
            if (
              test.type === 'BinaryExpression' &&
              test.left?.type === 'MemberExpression' &&
              ctxNames.has(test.left.object?.name) &&
              test.left.property?.name === 'user'
            ) {
              return true;
            }
            // Pattern: if (!context.user) inside logical: !ctx.user || ...
            if (
              test.type === 'LogicalExpression' &&
              test.left?.type === 'UnaryExpression' &&
              test.left.operator === '!' &&
              test.left.argument?.type === 'MemberExpression' &&
              ctxNames.has(test.left.argument.object?.name) &&
              test.left.argument.property?.name === 'user'
            ) {
              return true;
            }
          }

          // Recurse into try/catch blocks
          if (stmt.type === 'TryStatement') {
            if (walkStatements(stmt.block?.body ?? [])) return true;
          }

          // Allow withResolverLogging wrapper — check if the inner function has the guard
          if (
            stmt.type === 'ReturnStatement' ||
            stmt.type === 'ExpressionStatement'
          ) {
            const expr =
              stmt.type === 'ReturnStatement' ? stmt.argument : stmt.expression;
            if (expr?.type === 'CallExpression') {
              // withResolverLogging('name', async (_,__,context) => { … })
              const innerFn = expr.arguments?.find(
                (a: any) =>
                  a.type === 'ArrowFunctionExpression' ||
                  a.type === 'FunctionExpression'
              );
              if (innerFn && containsAuthCheck(innerFn)) return true;
            }
          }
        }
        return false;
      }

      return walkStatements(body.body);
    }

    // ── Visitor ────────────────────────────────────────────────────────────

    function checkFunction(node: any) {
      // The function must be the direct value (or nested via withResolverLogging)
      // of a Property inside the Mutation object.
      const parent = node.parent;
      if (!parent) return;

      let resolverName = '';

      // Direct pattern: { Mutation: { login: async (_, args, context) => … } }
      if (parent.type === 'Property') {
        if (!isInsideMutationObject(parent)) return;
        resolverName = parent.key?.name ?? parent.key?.value ?? '<anonymous>';
      }
      // Wrapped: withResolverLogging('login', async (…) => { … })
      else if (parent.type === 'CallExpression') {
        const callParent = parent.parent;
        if (callParent?.type !== 'Property') return;
        if (!isInsideMutationObject(callParent)) return;
        resolverName =
          parent.arguments?.[0]?.value ??
          callParent.key?.name ??
          '<anonymous>';
      } else {
        return;
      }

      if (!containsAuthCheck(node)) {
        context.report({
          node,
          messageId: 'missingAuthCheck',
          data: { name: resolverName },
        });
      }
    }

    return {
      ArrowFunctionExpression: checkFunction,
      FunctionExpression: checkFunction,
    };
  },
};

export default rule;
