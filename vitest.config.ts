import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    maxWorkers: 2,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/lib/erp/contract-suite.ts"],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: { "src/lib/stock-import/rows.ts": { lines: 90 } },
    },
  },
});
