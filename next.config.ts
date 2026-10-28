import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep browser tests separate from the local app being reviewed on port 3000.
  distDir: process.env.TRAZFLOW_E2E === "1" ? ".next/e2e" : ".next",
  // Agregá esta línea con tu IP actual:
  allowedDevOrigins: ["192.168.1.100:3000", "192.168.1.100"],
};

export default nextConfig;
