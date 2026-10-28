import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cada suite puede compilar sin ocupar el servidor local ni la otra suite.
  distDir: process.env.NEXT_TEST_DIST_DIR || (process.env.TRAZFLOW_E2E === "1" ? ".next/e2e" : ".next"),
  // Agregá esta línea con tu IP actual:
  allowedDevOrigins: ["192.168.1.100:3000", "192.168.1.100"],
};

export default nextConfig;
