import js from '@eslint/js';
import globals from 'globals';

/**
 * Flat ESLint config for a build-free MV3 extension.
 *
 * Three environments are configured separately so that `no-undef` catches real
 * mistakes instead of being silenced globally:
 *   - src/    : browser + WebExtension APIs (the extension itself)
 *   - tests/  : Node (the built-in node:test runner and its chrome mock)
 *   - tool/   : Node (packaging / validation scripts)
 */

const sharedRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': 'error',
  // The extension logs with a '[Tab Sleep]' prefix on purpose; it is the only
  // diagnostic channel available inside a service worker.
  'no-console': 'off'
};

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.npm-cache/**', 'src/assets/**']
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: sharedRules
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: sharedRules
  },
  {
    files: ['tool/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: sharedRules
  }
];
