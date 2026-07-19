import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".stryker-tmp/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "eslint.config.mjs",
      "packages/**/eslint.config.mjs",
      "packages/**/stryker.config.mjs",
      "stryker.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      complexity: ["error", 8],
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["packages/turn-fold/render-patches.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["packages/**/*.test.ts"],
    rules: {
      "max-lines-per-function": ["error", { max: 160, skipBlankLines: true, skipComments: true }],
    },
  },
);
