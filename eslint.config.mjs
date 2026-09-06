// eslint.config.mjs — flat config: typescript-eslint recommended, plus Vantage's two house rules.
//
// Why it exists: Gate 1 says "no unargued `any`". The stock `no-explicit-any` is all-or-nothing, so a
// tiny inline rule (`vantage/argued-any`) allows `any` only when the same line carries a `// any: <why>`
// comment — the argument travels with the escape hatch. The domain directory additionally forbids the
// clock and randomness syntactically (LLD §10: no `Date.now()` in domain), which `tools/lint-deps.mjs`
// double-checks with a regex so the rule holds even if ESLint is skipped.
//
// What it must never do: grow `ignores` beyond build output, or disable a recommended rule
// repo-wide to quiet one file.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** `any` must be argued on the same line: `const x: any = …; // any: express types this handler as untyped`. */
const arguedAny = {
  meta: { type: 'problem', docs: { description: 'require a same-line `// any: <reason>` comment on every explicit any' }, schema: [] },
  create(context) {
    const source = context.sourceCode;
    return {
      TSAnyKeyword(node) {
        const line = node.loc.start.line;
        const argued = source.getAllComments().some((c) => c.loc.start.line === line && /^\s*any:\s*\S/.test(c.value));
        if (!argued) context.report({ node, message: 'explicit `any` needs a same-line `// any: <reason>` comment' });
      },
    };
  },
};

const nodeGlobals = { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' };

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'docs/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `.tsx` is included so the web's React components are held to the same house rules as the API.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { vantage: { rules: { 'argued-any': arguedAny } } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'vantage/argued-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'no Date.now() in domain: the clock is a parameter (LLD §10)' },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'no new Date() in domain: the clock is a parameter (LLD §10)' },
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: 'no randomness in domain: mint is a parameter' },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: nodeGlobals, sourceType: 'module' },
  },
);
