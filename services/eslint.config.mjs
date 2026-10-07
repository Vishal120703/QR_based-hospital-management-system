import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  // Module boundaries (see src/modules/README.md). Another module is used only
  // through its index.ts, so its internals can change freely.
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./[a-z-]+/(?!index\\.js$)[^/]+$',
              message: "Import another module through its index.ts, e.g. '../auth/index.js'.",
            },
          ],
        },
      ],
    },
  },
  // Only repositories talk to the database. Services pass the client or their
  // transaction to a repository; they never query a table themselves.
  {
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/**/*.repository.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.type='ThisExpression'][object.property.name='database'][property.name!='$transaction']",
          message: 'Run database queries in the module repository, not here.',
        },
        {
          selector: 'MemberExpression[object.name=/^(transaction|tx|db)$/]',
          message: 'Run database queries in the module repository, not here.',
        },
        // Repositories stay private to their module, so other modules reach
        // its tables only through its services and helpers.
        {
          selector: 'ExportNamedDeclaration[source.value=/\\.repository\\.js$/]',
          message: 'Do not export a repository from a module; export a service or helper.',
        },
        {
          selector: 'ExportAllDeclaration',
          message: 'List what a module exports by name.',
        },
      ],
    },
  },
  // Controllers and routes speak HTTP only: no repositories, no Prisma.
  {
    files: [
      'src/modules/**/*.controller.ts',
      'src/modules/**/*.routes.ts',
      'src/modules/**/*.schemas.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@prisma/client', message: 'Controllers and routes do not use Prisma.' }],
          patterns: [
            {
              regex: '^\\.\\./[a-z-]+/(?!index\\.js$)[^/]+$',
              message: "Import another module through its index.ts, e.g. '../auth/index.js'.",
            },
            {
              regex: '\\.repository\\.js$',
              message: 'Controllers call services, not repositories.',
            },
          ],
        },
      ],
    },
  },
);
