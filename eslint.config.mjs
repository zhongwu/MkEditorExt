import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build and test config files run in Node.
    files: ['*.mjs', '*.mts'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
