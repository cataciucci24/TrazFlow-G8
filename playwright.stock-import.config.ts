import { defineConfig } from "@playwright/test";
import base from "./playwright.plan-changes.config";

const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!;

// Sin ERP: la carga directa. Con ERP: playwright.stock-import-erp.config.ts.
export default defineConfig({
  ...base,
  testMatch: "stock-import.spec.ts",
  webServer: { ...server, env: { ...server.env, ERP_PROVIDER: "" } },
});
