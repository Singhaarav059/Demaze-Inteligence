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
  test: {
    // .claude/worktrees holds full nested checkouts (agent worktrees) whose
    // own tests/ dirs would otherwise get scanned as part of this repo,
    // silently inflating file/test counts and duplicating assertions.
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**'],
  },
})
