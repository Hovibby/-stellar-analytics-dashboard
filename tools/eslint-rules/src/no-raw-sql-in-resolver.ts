/**
 * no-raw-sql-in-resolver
 *
 * Detects raw SQL string templates or string literals passed directly as the
 * first argument to db.query() / db.queryOne() calls inside resolver files.
 *
 * Risky pattern: SQL is built by hand inside a resolver rather than in an
 * isolated query helper.  This makes it easy to:
 *   - Introduce SQL injection via string concatenation
 *   - Duplicate similar queries across resolvers (drift)
 *   - Bypass the QueryMonitor / caching layer
 *
 * Safe pattern: extract the SQL into packages/api/src/database/ and import it.
 *
 * @example
 * // ❌ Flagged — raw SQL template literal in resolver
 * const rows = await db.query(`SELECT * FROM ledgers WHERE sequence = ${seq}`, []);
 *
 * // ❌ Flagged — raw SQL string literal with interpolation
 * const rows = await db.query('SELECT * FROM ledgers WHERE sequence = $1', [seq]);
 *   // still flagged: SQL in resolver — move it to a query helper
 *
 * // ✅ Allowed — query helper imported from database layer
 * import { getLedgerBySequence } from '../database/ledger-queries';
 * const row = await getLedgerBySequence(seq);
 */

import type { Rule } from 'eslint';

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow raw SQL string literals passed directly to db.query() or db.queryOne() inside resolver files. Extract SQL into database query helpers instead.',
      recommended: true,
      url: 'https://github.com/your-org/stellar-analytics-dashboard/blob/main/docs/static-analysis.md',
    },
    messages: {
      rawSqlInResolver:
        'Raw SQL found directly in a resolver. Extract this query to a database query helper ' +
        '(packages/api/src/database/) and import it. This keeps SQL centralised, testable, and ' +
        'prevents SQL injection from string concatenation.',
      templateLiteralSql:
        'SQL template literal with interpolated expression detected in a resolver. ' +
        'Template literals with ${} inside SQL are a SQL-injection risk. ' +
        'Use parameterised queries ($1, $2, …) and pass values as the params array.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Additional method names to flag beyond db.query / db.queryOne
          additionalMethods: {
            type: 'array',
            items: { type: 'string' },
          },
          // File path patterns that count as "resolver files" (default: **/resolvers/**)
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
      additionalMethods?: string[];
      resolverPattern?: string;
    }) ?? {};

    const resolverPattern = options.resolverPattern ?? '/resolvers/';
    const extraMethods = new Set(options.additionalMethods ?? []);

    // Only run in resolver files
    const filename = context.getFilename();
    if (!filename.includes(resolverPattern)) {
      return {};
    }

    /** Returns true when a call expression is db.query / db.queryOne / pool.query etc. */
    function isSqlCall(node: Rule.Node): boolean {
      if (node.type !== 'CallExpression') return false;
      const call = node as any;
      const callee = call.callee;
      if (callee.type !== 'MemberExpression') return false;

      const methodName: string = callee.property?.name ?? '';
      const builtIn = new Set(['query', 'queryOne', 'queryMany', 'queryRaw']);
      return builtIn.has(methodName) || extraMethods.has(methodName);
    }

    /** Returns true when a node looks like it contains SQL (SELECT / INSERT / UPDATE / DELETE) */
    function looksSql(value: string): boolean {
      return /\b(SELECT|INSERT|UPDATE|DELETE|WITH|FROM|WHERE|JOIN)\b/i.test(value);
    }

    return {
      CallExpression(node: any) {
        if (!isSqlCall(node)) return;

        const firstArg = node.arguments?.[0];
        if (!firstArg) return;

        if (firstArg.type === 'TemplateLiteral') {
          // Any template literal with expressions (${}) inside SQL is risky
          if (firstArg.expressions?.length > 0) {
            context.report({
              node: firstArg,
              messageId: 'templateLiteralSql',
            });
            return;
          }
          // Template literal with no expressions — still SQL in resolver
          const raw = firstArg.quasis?.[0]?.value?.raw ?? '';
          if (looksSql(raw)) {
            context.report({ node: firstArg, messageId: 'rawSqlInResolver' });
          }
        } else if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
          if (looksSql(firstArg.value)) {
            context.report({ node: firstArg, messageId: 'rawSqlInResolver' });
          }
        }
      },
    };
  },
};

export default rule;
