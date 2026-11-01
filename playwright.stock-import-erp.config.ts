import { defineConfig } from "@playwright/test";
import base from "./playwright.plan-changes.config";

// La configuración base ya levanta el servidor con ERP_PROVIDER=mock.
export default defineConfig({ ...base, testMatch: "stock-import-erp.spec.ts" });
