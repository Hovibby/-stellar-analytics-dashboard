import { RuleTester } from 'eslint';
import rule from '../require-auth-check';

const tester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const filename = '/project/packages/api/src/resolvers/index.ts';

tester.run('require-auth-check', rule, {
  valid: [
    // Auth check present — `if (!context.user) throw`
    {
      filename,
      code: `
        export const resolvers = {
          Mutation: {
            createRecord: async (_, args, context) => {
              if (!context.user) throw new Error('Unauthorized');
              return db.query('INSERT ...', []);
            }
          }
        };
      `,
    },
    // Auth check using ctx alias
    {
      filename,
      code: `
        export const resolvers = {
          Mutation: {
            deleteRecord: async (_, args, ctx) => {
              if (!ctx.user) throw new AuthError();
              return db.query('DELETE ...', []);
            }
          }
        };
      `,
    },
    // withResolverLogging wrapper with inner auth check
    {
      filename,
      code: `
        export const resolvers = {
          Mutation: {
            generateApiKey: withResolverLogging('Mutation.generateApiKey',
              async (_, __, context) => {
                if (!context.user) throw new AuthError();
                return authService.generateApiKey();
              }
            )
          }
        };
      `,
    },
    // Query resolvers are NOT checked by this rule
    {
      filename,
      code: `
        export const resolvers = {
          Query: {
            ledgers: async (_, args, context) => {
              return db.query('SELECT ...', []);
            }
          }
        };
      `,
    },
  ],

  invalid: [
    // Missing auth check in Mutation
    {
      filename,
      code: `
        export const resolvers = {
          Mutation: {
            deleteAccount: async (_, args, context) => {
              return db.query('DELETE FROM accounts WHERE id = $1', [args.id]);
            }
          }
        };
      `,
      errors: [{ messageId: 'missingAuthCheck', data: { name: 'deleteAccount' } }],
    },
    // Missing auth check — arrow function shorthand body (expression body has no block)
    {
      filename,
      code: `
        export const resolvers = {
          Mutation: {
            revokeKey: async (_, __, context) => db.query('UPDATE users SET api_key = NULL', [])
          }
        };
      `,
      errors: [{ messageId: 'missingAuthCheck' }],
    },
  ],
});
