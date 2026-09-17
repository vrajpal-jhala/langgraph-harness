import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import importX from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'src/__generated__']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'import-x': importX,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Auto-sortable import groups.
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^node:', '^react', '^@?\\w'], // 1. node builtins + react + external
            ['^@/types'], // 2. shared types
            ['^@/components(/|$)', '^\\.'], // 3. components + relative siblings
            ['^@/'], // 4. hooks/utils/tours/pages/misc
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      // Merge / forbid duplicate imports from the same module path.
      'import-x/no-duplicates': 'error',
      // Prefer the `@/*` alias over parent-relative imports.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message:
                'Use the `@/...` alias (maps to frontend/src) instead of ../ imports.',
            },
          ],
        },
      ],
    },
  },
  // Must stay last: disables ESLint stylistic rules that conflict with Prettier.
  eslintConfigPrettier,
]);
