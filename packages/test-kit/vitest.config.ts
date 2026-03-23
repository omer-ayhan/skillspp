import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.base";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: "test-kit",
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        reportsDirectory: "./coverage",
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
