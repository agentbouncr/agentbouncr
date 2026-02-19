import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/", "node_modules/", "coverage/", "ee/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["packages/*/src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    // Tests: allow non-null assertions (idiomatic after expect().not.toBeNull())
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Core/ee import isolation
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ee/**", "../../../ee/**", "../../ee/**"],
              message: "Core (ELv2) must NEVER import from /ee. Import isolation is enforced.",
            },
          ],
        },
      ],
    },
  },
);
