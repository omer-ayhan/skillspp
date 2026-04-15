/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["cli", "mcp", "core", "platform-node", "test-kit", "release", "docs", "github"],
    ],
  },
};
