import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agregá esta línea con tu IP actual:
  allowedDevOrigins: ["192.168.1.100:3000", "192.168.1.100"],
};

export default nextConfig;
