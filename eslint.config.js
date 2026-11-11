import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const restrictImports = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...restrictImports(['**/server/**']),
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: restrictImports(['**/web/**', '**/repositories/**']),
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: restrictImports(['**/web/**', '**/server/**', '**/repositories/**', '**/contracts/**']),
  },
  {
    files: ['src/contracts/**/*.ts'],
    rules: restrictImports(['**/web/**', '**/server/**', '**/repositories/**']),
  },
);
