import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import baseConfig from "../../vitest.config.base";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [
      tsconfigPaths({
        projects: [
          path.resolve(__dirname, "tsconfig.json"),
          path.resolve(__dirname, "../../packages/cli-shared/tsconfig.json"),
          path.resolve(__dirname, "../../packages/core/tsconfig.json"),
          path.resolve(__dirname, "../../packages/platform-node/tsconfig.json"),
        ],
      }),
    ],
    test: {
      name: "skillspp-cli",
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        reportsDirectory: "./coverage",
        include: ["src/runtime/background-runner.ts"],
        thresholds: {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 75,
        },
      },
    },
  }),
);
