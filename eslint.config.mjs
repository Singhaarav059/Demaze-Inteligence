import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Codebase convention: an underscore-prefixed param/var name (e.g. an
    // interface-mandated argument a mock provider implementation doesn't
    // need) is intentionally unused, not dead code.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested .next output isn't caught by the pattern above, which only
    // matches at the repo root — sibling git worktrees under .claude/
    // each have their own .next build directory that would otherwise get
    // linted as if it were source.
    "**/.next/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
