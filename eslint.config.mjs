// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    // Generated, vendored, or separately-toolchained trees. Keep in lock-step
    // with .prettierignore.
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/storybook-static/**",
      "**/node_modules/**",
      "**/*.wasm",
      "packages/extension/grammar/**",
      "packages/omc-client/test/fixtures/**",
      "packages/extension/e2e/node_modules/**",
      "packages/extension/e2e/test-results/**",
      "packages/extension/e2e/workspace/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Leading underscore marks a deliberately-unused binding repo-wide.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // `interface Foo extends Bar {}` is the idiom for merging into global
      // event-map interfaces.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
      // Playwright spells "no test-scoped fixtures" as `({}, use)`.
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
    },
  },
  {
    files: ["**/*.{mjs,cjs,js}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
