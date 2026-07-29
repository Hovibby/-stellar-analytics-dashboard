module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'prettier', '@stellar-analytics'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  rules: {
    'prettier/prettier': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'packages/*/dist/', 'tools/*/dist/'],
  overrides: [
    {
      files: ['*.d.ts', '.eslintrc.js', 'jest.config.js'],
      parserOptions: { project: null },
      rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
    },

    // ── API resolvers ──────────────────────────────────────────────────────
    // Apply the three custom rules to all API resolver and service files.
    {
      files: [
        'packages/api/src/resolvers/**/*.ts',
        'packages/api/src/services/**/*.ts',
      ],
      parserOptions: {
        project: './packages/api/tsconfig.json',
      },
      rules: {
        // SQL belongs in the database layer, not inside resolvers.
        // Warn rather than error so existing code isn't blocked immediately;
        // raise to 'error' once the database query helpers are in place.
        '@stellar-analytics/no-raw-sql-in-resolver': 'warn',

        // Every Mutation resolver MUST guard context.user before executing.
        '@stellar-analytics/require-auth-check': 'error',

        // Unawaited Promises silently drop errors in the GraphQL context.
        '@stellar-analytics/no-unhandled-promise-in-resolver': 'error',
      },
    },

    // ── Indexer ────────────────────────────────────────────────────────────
    // Apply the unhandled-promise rule to the indexer's async data pipeline.
    {
      files: [
        'indexer/src/**/*.ts',
        'packages/indexer/src/**/*.ts',
      ],
      parserOptions: {
        project: ['./indexer/tsconfig.json'],
      },
      rules: {
        '@stellar-analytics/no-unhandled-promise-in-resolver': 'error',
      },
    },
  ],
};

// Issue #345: Static analysis rule — no raw SQL in API resolvers
// Prevents raw SQL usage directly inside GraphQL resolver functions
const noRawSqlInResolversRule = {
  files: ['api/src/resolvers/**/*.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.name='query']",
        message: 'Raw SQL query() calls are not allowed in resolvers. Use parameterized data access methods instead.',
      },
      {
        selector: "CallExpression[callee.object.name='db'][callee.property.name='raw']",
        message: 'Raw SQL via db.raw() is not allowed in resolvers. Use parameterized data access methods instead.',
      },
      {
        selector: "TemplateLiteral TaggedTemplateExpression[tag.name='sql']",
        message: 'SQL template literals are not allowed in resolvers. Use parameterized data access methods instead.',
      },
    ],
  },
};

// Merge into existing config
if (!module.exports.overrides) module.exports.overrides = [];
module.exports.overrides.push(noRawSqlInResolversRule);
