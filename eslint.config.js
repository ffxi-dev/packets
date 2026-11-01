import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', '.venv/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
