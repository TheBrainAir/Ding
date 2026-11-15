import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn/ui primitives export their variant helpers next to the component.
    files: ['src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off', 'react-hooks/purity': 'off' },
  },
  {
    // Vendored React Bits components (installed with `shadcn add @react-bits/...`), kept close
    // to upstream so they can be re-pulled. They read refs during render on purpose.
    files: ['src/components/reactbits/**/*.tsx'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'no-useless-assignment': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['mock/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
])
