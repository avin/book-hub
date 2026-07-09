import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import solid from 'eslint-plugin-solid';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'storybook-static/**', 'public/pdfjs-assets/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  solid.configs['flat/recommended'],
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    rules: {
      curly: ['error', 'all'],
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        jsxImportSource: 'solid-js',
      },
    },
  },
  eslintConfigPrettier,
);
