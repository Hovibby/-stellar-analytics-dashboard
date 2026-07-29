import { RuleTester } from 'eslint';
import rule from '../no-unhandled-promise-in-resolver';

const tester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const filename = '/project/packages/api/src/resolvers/transactions.ts';

tester.run('no-unhandled-promise-in-resolver', rule, {
  valid: [
    // Properly awaited
    {
      filename,
      code: `
        async function resolver() {
          const result = await db.query('SELECT 1', []);
          await db.cacheSet('key', result, 300);
          return result;
        }
      `,
    },
    // Explicit void discard — intentional, not flagged
    {
      filename,
      code: `
        async function resolver() {
          const result = await db.query('SELECT 1', []);
          void db.incrementCacheMetric('ledgers');
          return result;
        }
      `,
    },
    // .catch() chain — handled
    {
      filename,
      code: `
        async function resolver() {
          db.cacheSet('key', val, 60).catch(console.error);
          return val;
        }
      `,
    },
    // Assigned to variable — handled
    {
      filename,
      code: `
        async function resolver() {
          const p = db.cacheSet('key', val, 60);
          await p;
          return val;
        }
      `,
    },
    // Promise.all wrapping — the outer await handles it
    {
      filename,
      code: `
        async function resolver() {
          await Promise.all([db.cacheSet('a', 1), db.cacheSet('b', 2)]);
        }
      `,
    },
    // Non-async function — rule does not apply
    {
      filename,
      code: `
        function syncResolver() {
          db.cacheSet('key', val, 60);
        }
      `,
    },
    // File not in resolvers or indexer — rule does not apply
    {
      filename: '/project/packages/frontend/src/utils/helpers.ts',
      code: `
        async function helper() {
          db.cacheSet('key', val, 60);
        }
      `,
    },
  ],

  invalid: [
    // Floating cacheSet — no await, no catch, not void-ed
    {
      filename,
      code: `
        async function resolver() {
          const result = await db.query('SELECT 1', []);
          db.cacheSet('key', result, 300);
          return result;
        }
      `,
      errors: [{ messageId: 'floatingPromise' }],
    },
    // Floating incrementCacheMetric
    {
      filename,
      code: `
        async function resolver() {
          db.incrementCacheMetric('transactions');
          return [];
        }
      `,
      errors: [{ messageId: 'floatingPromise' }],
    },
    // Floating publish
    {
      filename,
      code: `
        async function resolver() {
          pubsub.publish('LEDGER_ADDED', { ledgerAdded: data });
          return data;
        }
      `,
      errors: [{ messageId: 'floatingPromise' }],
    },
    // Multiple floating calls
    {
      filename,
      code: `
        async function resolver() {
          db.cacheSet('k1', v1, 60);
          db.cacheSet('k2', v2, 60);
          return v1;
        }
      `,
      errors: [
        { messageId: 'floatingPromise' },
        { messageId: 'floatingPromise' },
      ],
    },
  ],
});
