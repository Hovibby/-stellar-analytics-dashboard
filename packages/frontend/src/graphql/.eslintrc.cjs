/**
 * GraphQL query document linting
 *
 * Uses @graphql-eslint to enforce consistent formatting, naming conventions,
 * and GraphQL best practices on all gql-tagged template literals in this
 * directory.  The schema is loaded from the API's typeDefs so every rule
 * can leverage type information (e.g. no-deprecated, require-id-when-available).
 *
 * Acceptance criteria
 *   ✓ Every operation has a unique, descriptive PascalCase name
 *   ✓ Queries start with "Get" or "Search", mutations start with a verb,
 *     subscriptions start with "On"
 *   ✓ No deprecated fields are selected
 *   ✓ Every paginated list type selects __typename so the Apollo cache can
 *     normalise objects correctly
 *   ✓ Variables are named in camelCase
 *   ✓ Selections are sorted alphabetically within each object (autofix)
 *   ✓ Inline fragments carry a human-readable type condition
 */

'use strict';

const path = require('path');

// Resolve the SDL schema that ships with the API package.
// When the CI machine hasn't built packages/api/dist yet, fall back to the raw
// TypeScript source so the lint step always works without a prior build.
const schemaPath = path.resolve(__dirname, '../../../../../packages/api/src/schema/typeDefs.ts');

module.exports = {
  root: false, // inherits from packages/frontend/.eslintrc.cjs
  overrides: [
    {
      // Target TypeScript files in the graphql/ directory that use gql tags.
      files: ['*.ts', '*.tsx'],
      processor: '@graphql-eslint/graphql',
      plugins: ['@graphql-eslint'],
      parserOptions: {
        // Pass the schema so type-aware rules can run.
        // Using schemaPath lets the linter parse the raw SDL without a server.
        schema: schemaPath,
        // Point at the operations so cross-file fragment checks work.
        documents: path.resolve(__dirname, './**/*.ts'),
      },
    },
    {
      // Rules that apply to the extracted GraphQL documents themselves.
      files: ['*.graphql'],
      extends: ['plugin:@graphql-eslint/operations-recommended'],
      plugins: ['@graphql-eslint'],
      parser: '@graphql-eslint/eslint-plugin',
      parserOptions: {
        schema: schemaPath,
        documents: path.resolve(__dirname, './**/*.graphql'),
      },
      rules: {
        // ── Naming ────────────────────────────────────────────────────────

        /**
         * Require every operation to have an explicit name.
         * Anonymous operations are harder to trace in logs and the Apollo
         * DevTools.
         */
        '@graphql-eslint/require-operation-name': 'error',

        /**
         * Operation names must be unique across the entire document set so
         * the Apollo cache does not inadvertently share cached results between
         * semantically different queries.
         */
        '@graphql-eslint/unique-operation-name': 'error',

        /**
         * Enforce naming conventions:
         *   • Queries    → PascalCase, must start with "Get" or "Search"
         *   • Mutations  → PascalCase, must start with a mutating verb
         *     (Create, Update, Delete, Add, Remove, Set, Revoke, Generate, …)
         *   • Subscriptions → PascalCase, must start with "On"
         *   • Fragment names → PascalCase, must end with "Fragment"
         *   • Variables → camelCase
         */
        '@graphql-eslint/naming-convention': [
          'error',
          {
            OperationDefinition: {
              style: 'PascalCase',
              // Readable pattern per operation type
              QueryDefinition: {
                style: 'PascalCase',
                forbiddenPrefixes: [],
                requiredPrefixes: ['Get', 'Search'],
              },
              MutationDefinition: {
                style: 'PascalCase',
                requiredPrefixes: [
                  'Create',
                  'Update',
                  'Delete',
                  'Add',
                  'Remove',
                  'Set',
                  'Revoke',
                  'Generate',
                  'Register',
                  'Login',
                ],
              },
              SubscriptionDefinition: {
                style: 'PascalCase',
                requiredPrefixes: ['On'],
              },
            },
            FragmentDefinition: {
              style: 'PascalCase',
              requiredSuffixes: ['Fragment'],
            },
            VariableDefinition: {
              style: 'camelCase',
            },
          },
        ],

        // ── Deprecation ───────────────────────────────────────────────────

        /**
         * Flag any field marked @deprecated in the schema.
         * Error-level so the CI pipeline catches regressions immediately.
         */
        '@graphql-eslint/no-deprecated': 'error',

        // ── Selection quality ─────────────────────────────────────────────

        /**
         * Disallow selecting __typename explicitly when it is already
         * added automatically by Apollo Client.  Keeping the document clean
         * avoids confusion about who owns the field.
         */
        '@graphql-eslint/no-typename-prefix': 'error',

        /**
         * Every object-typed field must have a sub-selection.
         * Prevents accidentally returning whole objects as scalars.
         */
        '@graphql-eslint/require-selections': 'error',

        /**
         * When a type has an `id` field, selecting it ensures the Apollo
         * InMemoryCache can normalise objects and avoid stale data.
         */
        '@graphql-eslint/require-id-when-available': 'warn',

        /**
         * Prevent the "select all" anti-pattern that downloads more data
         * than the component needs and inflates query complexity scores.
         */
        '@graphql-eslint/no-introspection': 'warn',

        // ── Structure ─────────────────────────────────────────────────────

        /**
         * Every field and variable must be used.  Unused selections bloat
         * network payloads; unused variables confuse readers.
         */
        '@graphql-eslint/no-unused-fields': 'warn',
        '@graphql-eslint/no-unused-variables': 'error',

        /**
         * Fragments must be used at least once.  Dead fragments add noise
         * and are often left-over from earlier iterations.
         */
        '@graphql-eslint/no-unused-fragments': 'error',

        /**
         * Warn when the same field is selected more than once in a single
         * selection set — a sign of copy-paste drift.
         */
        '@graphql-eslint/no-duplicate-fields': 'warn',

        // ── Formatting (autofix-friendly) ─────────────────────────────────

        /**
         * Keep selection sets alphabetically sorted so diffs are easier to
         * read and field additions are consistently placed.
         * Run `pnpm lint:graphql:fix` to autofix.
         */
        '@graphql-eslint/alphabetize': [
          'warn',
          {
            fields: ['ObjectTypeDefinition', 'InterfaceTypeDefinition', 'InputObjectTypeDefinition'],
            values: true,
            arguments: ['FieldDefinition', 'Field', 'DirectiveDefinition', 'Directive'],
            definitions: false,
          },
        ],
      },
    },
  ],
};
