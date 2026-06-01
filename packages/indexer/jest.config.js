const path = require('path');

// Resolve ts-jest from the pnpm virtual store at the workspace root
const tsJestPath = path.resolve(
  __dirname,
  '../../node_modules/.pnpm/ts-jest@29.4.6_@babel+core@7.29.0_@jest+transform@30.3.0_@jest+types@30.3.0_babel-jest@30.3.0_ywazqpqiy72pgx36j5dij2dtmy/node_modules/ts-jest'
);

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      tsJestPath,
      {
        diagnostics: false,
        isolatedModules: true,
        tsconfig: {
          module: 'commonjs',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@stellar-analytics/shared$': '<rootDir>/../shared/src/index.ts',
    '^pg$': path.resolve(
      __dirname,
      '../../node_modules/.pnpm/pg@8.20.0/node_modules/pg'
    ),
    '^zod$': path.resolve(
      __dirname,
      '../../node_modules/.pnpm/zod@4.3.6/node_modules/zod'
    ),
    '^prom-client$': path.resolve(
      __dirname,
      '../../node_modules/.pnpm/prom-client@15.1.0/node_modules/prom-client'
    ),
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
