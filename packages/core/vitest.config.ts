import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.base";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        "@skillspp/core": path.resolve(__dirname, "./src/index.ts"),
      },
    },
    test: {
      name: "core",
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        reportsDirectory: "./coverage",
        include: ["src/application/services.ts"],
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
