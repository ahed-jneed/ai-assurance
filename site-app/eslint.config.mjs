import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and checkout-local tool state.
    "dist/**",
    "coverage/**",
    ".vinext/**",
    ".wrangler/**",
    ".test-output/**",
    // Playwright output.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
  {
    rules: {
      // Allow the `const { omitted, ...rest } = value` idiom for dropping keys.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    // The criteria loader and its bundle are server-only: client components
    // receive projections from the API (docs/design/criteria-model.md 14.4).
    files: ["app/**/*.tsx"],
    ignores: ["app/**/*.test.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/lib/criteria/registry",
                "**/lib/criteria/pin",
                "**/lib/criteria/bundle.generated.json",
              ],
              message:
                "The criteria loader is server-only; use the projections GET /api/workspace and GET /api/coverage send.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored from shadcn@4.17.0, verbatim except that
      // dialog, sheet and alert-dialog return focus to their opener (#203,
      // hooks/use-return-focus.ts). Otherwise keep the registry source
      // intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
