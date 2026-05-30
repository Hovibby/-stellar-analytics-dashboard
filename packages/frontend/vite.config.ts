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
    // Warn when any individual chunk exceeds 500 kB
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          // React runtime – changes rarely, maximises cache hits
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Apollo / GraphQL – large and stable
          'vendor-apollo': ['@apollo/client', 'graphql', 'graphql-ws'],
          // Recharts – heaviest chart library
          'vendor-recharts': ['recharts'],
          // Framer Motion – animation runtime
          'vendor-framer': ['framer-motion'],
          // Utility libs
          'vendor-utils': ['date-fns', 'clsx', 'tailwind-merge', 'zustand'],
        },
      },
    },
  },
});
