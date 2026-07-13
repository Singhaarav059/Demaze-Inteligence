import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Resolve the project's "@/..." path alias (from tsconfig) for tests, so
// lib modules that import via "@/lib/..." can be unit-tested directly.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, ''),
    },
  },
})
