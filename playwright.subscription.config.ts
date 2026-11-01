import { defineConfig } from "@playwright/test";
import base from "./playwright.plan-changes.config";

export default defineConfig({ ...base, testMatch: "subscription.spec.ts" });
