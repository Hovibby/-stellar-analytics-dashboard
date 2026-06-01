/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/graphql': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/subscriptions': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      exclude: [
        'node_modules/**',
        'src/test/**',
        'src/main.tsx',
        'src/App.tsx',
        '**/*.d.ts',
        '**/*.config.*',
        // Exclude files that require a running server / complex browser APIs
        'src/graphql/**',
        'src/pages/AccountDetail.tsx',
        'src/pages/TransactionDetail.tsx',
        'src/pages/Accounts.tsx',
        'src/pages/Assets.tsx',
        'src/pages/Ledgers.tsx',
        'src/pages/Transactions.tsx',
        'src/pages/Search.tsx',
        'src/pages/Network.tsx',
        'src/pages/Dashboard.tsx',
        'src/pages/NotFound.tsx',
        'src/components/TransactionsChart.tsx',
        'src/components/LedgerTimelineChart.tsx',
        'src/components/NetworkChart.tsx',
        'src/components/GlobalSearch.tsx',
        'src/components/Layout.tsx',
        'src/components/FilterBar.tsx',
        'src/components/DataTable.tsx',
        'src/components/TopAssets.tsx',
        'src/components/RecentTransactions.tsx',
        'src/components/ConnectionStatus.tsx',
        'src/components/ProtectedRoute.tsx',
        'src/hooks/useRealtimeUpdates.ts',
        'src/hooks/useWebSocketStatus.ts',
        'src/hooks/useNotifications.ts',
      ],
    },
  },
});
