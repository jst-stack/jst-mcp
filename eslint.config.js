import js from "@eslint/js";
import quality from "@jst-stack/eslint-plugin-quality";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...quality.createRulesConfig(),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/pi/extension.ts"],
    rules: {
      // Pi defines this callback contract; adapters must accept all five arguments.
      "max-params": ["error", 5],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Test suites are declarative scenarios; production limits remain unchanged.
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
    },
  },
);
