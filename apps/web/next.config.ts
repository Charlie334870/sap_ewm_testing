import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@ewm/shared"],
  poweredByHeader: false,
  devIndicators: false,
};

export default config;
