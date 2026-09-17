import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import importX from 'eslint-plugin-import-x';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['build']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'import-x': importX,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Auto-sortable import groups.
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^node:', '^@?\\w'], // 1. node builtins + external packages
            ['^#types'], // 2. shared types (#types.js)
            ['^#components(/|$)', '^\\.'], // 3. components + relative siblings
            ['^#'], // 4. utils + everything else internal
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      // Merge / forbid duplicate imports from the same module path.
      'import-x/no-duplicates': 'error',
      // Prefer the `#*` subpath alias over parent-relative imports.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message:
                'Use the `#...` alias (maps to backend/src) instead of ../ imports.',
            },
          ],
        },
      ],
    },
  },
  // Kysely migrations use `Kysely<any>` by design — the migration API operates
  // outside the typed schema, so `any` is the sanctioned signature here.
  {
    files: ['scripts/migrations/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // Must stay last: disables ESLint stylistic rules that conflict with Prettier.
  eslintConfigPrettier,
]);
