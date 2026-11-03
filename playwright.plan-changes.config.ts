import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Nunca lee credenciales de .env.local ni permite apuntar a un proyecto remoto.
const status = JSON.parse(execFileSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
if (status.API_URL !== "http://127.0.0.1:54321") throw new Error("Estas pruebas requieren Supabase local en 127.0.0.1:54321.");
process.env.TRZ_LOCAL_SERVICE_KEY = status.SERVICE_ROLE_KEY;
process.env.TRZ_LOCAL_ANON_KEY = status.ANON_KEY;

export default defineConfig({
  testDir: "./tests/local",
  testMatch: "plan-changes.spec.ts",
  workers: 1, fullyParallel: false, timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3102", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3102",
    url: "http://127.0.0.1:3102/login", timeout: 120_000, reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: "", ERP_PROVIDER: "mock", ERP_BASE_URL: "", ERP_API_KEY: "", ERP_API_SECRET: "", CRON_SECRET: "",
      NEXT_TEST_DIST_DIR: ".next/plan-changes-local", TRAZFLOW_E2E: "0", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve("scripts/e2e-fonts.cjs") },
  },
});
