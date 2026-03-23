import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import baseConfig from "../../vitest.config.base";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.json")] })],
    test: {
      name: "skillspp-mcp",
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        reportsDirectory: "./coverage",
        include: ["src/request-handler.ts"],
        thresholds: {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 75,
        },
      },
    },
  })
);
