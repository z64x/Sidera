import react from '@vitejs/plugin-react';
import path from 'path';
import type { UserConfig } from 'vite';

const config: UserConfig = {
  // Historical compatibility only. The shipped app uses vite.renderer.config.ts.
  clearScreen: false,

  plugins: [react()],
  root: './src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
  server: {
    port: 5174,
    open: false,
  },
};

export default config;
