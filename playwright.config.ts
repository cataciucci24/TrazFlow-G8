import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Cada ejecución elige una suite: forecast y e2e comparten un puerto de fixtures.
const selected = process.argv.flatMap((arg, index, args) => arg.startsWith("--project=") ? [arg.slice(10)] : arg === "--project" ? [args[index + 1]] : []);
const suite = selected[0] ?? "e2e";
if (selected.length > 1) throw new Error("Ejecutá una suite por vez con --project=<suite>.");
const local = ["plan-changes", "stock-import", "stock-import-erp", "subscription"].includes(suite);
const listing = process.argv.includes("--list");
if (listing) {
  process.env.TRZ_LOCAL_SERVICE_KEY = "listing-only-dummy-key";
  process.env.TRZ_LOCAL_ANON_KEY = "listing-only-dummy-key";
}
let status: { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string } | undefined;
if (local && !listing) {
  status = JSON.parse(execFileSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  if (status?.API_URL !== "http://127.0.0.1:54321") throw new Error("Se requiere Supabase local en 127.0.0.1:54321.");
  process.env.TRZ_LOCAL_SERVICE_KEY = status.SERVICE_ROLE_KEY;
  process.env.TRZ_LOCAL_ANON_KEY = status.ANON_KEY;
}
const browserUse = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./tests/e2e",

  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  metadata: { presentation: suite === "demo" },
  projects: [
    { name: "e2e", testIgnore: "**/next-orders.spec.ts", use: browserUse },
    { name: "demo", testMatch: "driver-delivery.spec.ts", timeout: 120_000, use: { ...browserUse, video: "on" as const, launchOptions: { slowMo: 1200 } } },
    { name: "forecast", testMatch: "next-orders.spec.ts", use: browserUse },
    ...["plan-changes", "stock-import", "stock-import-erp", "subscription"].map(name => ({
      name, testDir: "./tests/local", testMatch: name + ".spec.ts", timeout: 120_000,
      use: { ...browserUse, baseURL: "http://127.0.0.1:3102" },
    })),
  ].filter(project => listing || project.name === suite),
  webServer: listing ? [] : local ? [{
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3102",
    url: "http://127.0.0.1:3102/login", timeout: 120_000, reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: status!.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: status!.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: "", ERP_PROVIDER: suite === "stock-import" ? "" : "mock", ERP_BASE_URL: "", ERP_API_KEY: "", ERP_API_SECRET: "", CRON_SECRET: "",
      NEXT_TEST_DIST_DIR: ".next/" + suite + "-local", TRAZFLOW_E2E: "0", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve("scripts/e2e-fonts.cjs") },
  }] : [{ command: suite === "forecast" ? "node scripts/e2e-forecast-supabase.mjs" : "node scripts/e2e-supabase.mjs", url: "http://127.0.0.1:54329/health", reuseExistingServer: false }, {
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    timeout: suite === "forecast" ? 300_000 : 120_000,
    reuseExistingServer: false,
    env: {
      NEXT_TEST_DIST_DIR: suite === "forecast" ? ".next/forecast-e2e" : ".next/e2e",
      TRAZFLOW_E2E: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "demo-anon-key",
      ERP_PROVIDER: "mock",
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: resolve("scripts/e2e-fonts.cjs"),
    },
  }],
});
