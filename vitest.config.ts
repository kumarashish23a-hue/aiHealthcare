import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Mirror the tsconfig "@/*" path alias so tests can import app routes
// and "@/src/..." modules exactly as Next.js resolves them.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
  },
});
