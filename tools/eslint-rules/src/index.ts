/**
 * @stellar-analytics/eslint-plugin
 *
 * Custom ESLint rules for detecting risky patterns in the API and indexer
 * packages earlier in the development cycle.
 *
 * Rules
 *   no-raw-sql-in-resolver         — SQL belongs in the database layer, not resolvers
 *   require-auth-check             — every Mutation resolver must guard context.user
 *   no-unhandled-promise-in-resolver — floating Promises silently swallow errors
 *
 * This file uses module.exports (CommonJS) because ESLint v8 loads plugins
 * with require().  The tsconfig for this package targets CommonJS so the
 * compiled output is directly consumable by ESLint without any adapter.
 */

import noRawSqlInResolver from './no-raw-sql-in-resolver';
import requireAuthCheck from './require-auth-check';
import noUnhandledPromiseInResolver from './no-unhandled-promise-in-resolver';
import type { Rule } from 'eslint';

interface EslintPlugin {
  meta: { name: string; version: string };
  rules: Record<string, Rule.RuleModule>;
  configs: Record<string, { plugins: string[]; rules: Record<string, string> }>;
}

const plugin: EslintPlugin = {
  meta: {
    name: '@stellar-analytics/eslint-plugin',
    version: '1.0.0',
  },
  rules: {
    'no-raw-sql-in-resolver': noRawSqlInResolver,
    'require-auth-check': requireAuthCheck,
    'no-unhandled-promise-in-resolver': noUnhandledPromiseInResolver,
  },
  configs: {
    /**
     * Recommended config — apply to all API and indexer TypeScript source files.
     *
     * Usage in .eslintrc.js:
     *   extends: ['plugin:@stellar-analytics/recommended']
     */
    recommended: {
      plugins: ['@stellar-analytics'],
      rules: {
        '@stellar-analytics/no-raw-sql-in-resolver': 'warn',
        '@stellar-analytics/require-auth-check': 'error',
        '@stellar-analytics/no-unhandled-promise-in-resolver': 'error',
      },
    },
  },
};

// ESLint loads plugins with require() so we must export via module.exports.
// TypeScript compiles this to a CJS module; the `export =` syntax is the
// TypeScript-idiomatic way to express a CJS default export with full type info.
export = plugin;
