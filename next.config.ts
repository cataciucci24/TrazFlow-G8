import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las pruebas de navegador pueden compilar sin ocupar el servidor local.
  distDir: process.env.NEXT_TEST_DIST_DIR || ".next",
  // Agregá esta línea con tu IP actual:
  allowedDevOrigins: ["192.168.1.100:3000", "192.168.1.100"],
};

export default nextConfig;
