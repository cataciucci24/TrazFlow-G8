import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// La presentación tiene su propio ritmo; la suite automática conserva su velocidad.
export default defineConfig(config, {
  timeout: 120_000,
  metadata: { presentation: true },
  use: {
    ...config.use,
    video: "on",
    launchOptions: { slowMo: 1200 },
  },
});
