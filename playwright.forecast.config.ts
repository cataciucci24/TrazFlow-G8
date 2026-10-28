import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "next-orders.spec.ts",
  testIgnore: [],
  webServer: [
    { command: "node scripts/e2e-forecast-supabase.mjs", url: "http://127.0.0.1:54329/health", reuseExistingServer: false },
    ...(Array.isArray(base.webServer) ? base.webServer.slice(1).map((server) => ({
      ...server, timeout: 300_000, env: { ...server.env, NEXT_TEST_DIST_DIR: ".next/forecast-e2e" },
    })) : []),
  ],
});
