// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundaries are enforced here, in CI — not by convention.
 * `DEV_GUIDE.md` §4 and `RULES.md` §3.9 both require this; a rule that only lives in a
 * document is a rule that gets broken during a deadline.
 */
const FEATURE_MODULES = [
  'src/auth/**/*.ts',
  'src/users/**/*.ts',
  'src/devices/**/*.ts',
  'src/authorization/**/*.ts',
  'src/share-sessions/**/*.ts',
  'src/protocol/**/*.ts',
  'src/realtime/**/*.ts',
  'src/rate-limiting/**/*.ts',
];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.contracts/**', 'jest.config.js', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', URL: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error', // observability/logger.service.ts is the only sanctioned output path
      'no-restricted-syntax': [
        'error',
        {
          // Clipboard content must never be logged, and the redacting logger is the only writer.
          selector: "MemberExpression[object.name='console']",
          message: 'Use LoggerService. Raw console output bypasses the redaction allowlist (SECURITY.md, Logging).',
        },
      ],
    },
  },

  // Feature modules: no transport layer, no SQL.
  //
  // Controllers and the realtime gateway are excluded from the http/ half of this rule: they ARE
  // the transport adapter, and wiring a validation pipe or an exception shape is their job. What
  // the rule protects is the layer beneath them — a *service* reaching for an HTTP concern is the
  // inversion that makes the domain untestable and unreusable from the socket.
  {
    files: FEATURE_MODULES,
    ignores: ['**/*.controller.ts', '**/*.gateway.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/http/**', '../http/*', '../../http/*'],
              message:
                'Feature modules must not import from http/. Transport depends on the domain, never the reverse (DEV_GUIDE.md §4).',
            },
            {
              group: ['drizzle-orm', 'drizzle-orm/**', 'pg', '@electric-sql/pglite'],
              message:
                'Feature modules must not touch the database driver. Depend on a repository interface; only persistence/repositories/drizzle-*.ts knows SQL exists (ADR-007).',
            },
            {
              group: ['**/persistence/schema', '**/persistence/repositories/drizzle-*'],
              message:
                'Import the repository INTERFACE and its injection token, never the Drizzle implementation or the table definitions.',
            },
          ],
        },
      ],
    },
  },

  // Repository interfaces are ports: they must stay driver-free.
  // The drizzle-* adapters are the one place that may know SQL exists, so they are excluded.
  {
    files: ['src/persistence/repositories/*.repository.ts', 'src/persistence/mappers/**/*.ts'],
    ignores: ['src/persistence/repositories/drizzle-*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/**', 'pg', '@electric-sql/pglite'],
              message: 'A repository port or a mapper must not depend on a database driver (ADR-007).',
            },
          ],
        },
      ],
    },
  },

  // Tests may reach further, but still may not print.
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
