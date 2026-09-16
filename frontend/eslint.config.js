import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // These effects intentionally load remote state when route inputs change.
      // The React 19 compiler rule is too broad for this data-fetching pattern.
      'react-hooks/set-state-in-effect': 'off',
      // Errors are translated into user-facing wallet messages at this boundary;
      // retaining the provider error as `cause` is not supported by every wallet.
      'preserve-caught-error': 'off',
      // Wallet event handlers intentionally use the current connection callback.
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['src/context/EscrowContext.jsx'],
    rules: {
      // The provider and its matching hook form one context module.
      'react-refresh/only-export-components': 'off',
    },
  },
])
