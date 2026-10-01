import tseslint from "typescript-eslint";

// Flat config. `pnpm lint` runs `eslint .`.
// Type-checked rules apply to src/**/*.ts only; plain JS (e.g. this file)
// uses disableTypeChecked so the project service does not need to include it.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".agent/**"]
  },
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true
      }
    }
  },
  {
    // node:test registers suites/cases whose returned promises the runner awaits itself.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off"
    }
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked]
  }
);
