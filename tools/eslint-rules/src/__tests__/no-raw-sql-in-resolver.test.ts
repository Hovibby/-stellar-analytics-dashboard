import { RuleTester } from 'eslint';
import rule from '../no-raw-sql-in-resolver';

const tester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// Simulate a resolver file path
const filename = '/project/packages/api/src/resolvers/ledgers.ts';

tester.run('no-raw-sql-in-resolver', rule, {
  valid: [
    // SQL in a database query helper — NOT a resolver file
    {
      filename: '/project/packages/api/src/database/ledger-queries.ts',
      code: `const rows = await db.query('SELECT * FROM ledgers WHERE id = $1', [id]);`,
    },
    // Calling an imported query helper (no raw SQL string passed)
    {
      filename,
      code: `
        import { getLedger } from '../database/ledger-queries';
        export const resolvers = {
          Query: { ledger: async (_, args) => getLedger(args.sequence) }
        };
      `,
    },
    // Template literal with no SQL keywords
    {
      filename,
      code: `await db.query(\`hello world\`, []);`,
    },
  ],

  invalid: [
    // Raw string literal with SQL inside a resolver
    {
      filename,
      code: `const rows = await db.query('SELECT * FROM ledgers WHERE sequence = $1', [seq]);`,
      errors: [{ messageId: 'rawSqlInResolver' }],
    },
    // Raw template literal (no interpolation) with SQL
    {
      filename,
      code: "const rows = await db.query(`SELECT id FROM ledgers LIMIT 10`, []);",
      errors: [{ messageId: 'rawSqlInResolver' }],
    },
    // Template literal with interpolated expression — SQL injection risk
    {
      filename,
      code: 'const rows = await db.query(`SELECT * FROM ledgers WHERE sequence = ${seq}`, []);',
      errors: [{ messageId: 'templateLiteralSql' }],
    },
    // db.queryOne with raw SQL
    {
      filename,
      code: `const row = await db.queryOne('SELECT id FROM ledgers WHERE sequence = $1', [seq]);`,
      errors: [{ messageId: 'rawSqlInResolver' }],
    },
    // DELETE statement
    {
      filename,
      code: `await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);`,
      errors: [{ messageId: 'rawSqlInResolver' }],
    },
  ],
});
