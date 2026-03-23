import path from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

function assertNoRuntimeInputs(inputs: string[], label: string): void {
  const runtimeInputs = inputs.filter((input) =>
    input.includes("packages/core/src/runtime/")
  );

  expect(runtimeInputs, `Tree-shake smoke failed (${label})`).toHaveLength(0);
}

describe("core command export tree-shaking @contract", () => {
  it("does not include runtime modules in command contract bundles @contract", async () => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const contractsEntry = path.join(repoRoot, "packages/core/src/contracts/commands.ts");

    const result = await build({
      entryPoints: [contractsEntry],
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      metafile: true,
    });

    const bundledInputs = Object.keys(result.metafile?.inputs ?? {});
    assertNoRuntimeInputs(bundledInputs, "direct commands module");

    const aliasResult = await build({
      stdin: {
        contents: `import "@skillspp/core/commands";`,
        resolveDir: repoRoot,
        sourcefile: "alias-entry.ts",
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      platform: "node",
      write: false,
      metafile: true,
      plugins: [
        {
          name: "core-alias-test",
          setup(buildApi) {
            buildApi.onResolve({ filter: /^@skillspp\/core\/commands$/ }, () => ({
              path: path.join(repoRoot, "packages/core/src/contracts/commands.ts"),
            }));
          },
        },
      ],
    });

    const aliasInputs = Object.keys(aliasResult.metafile?.inputs ?? {});
    assertNoRuntimeInputs(aliasInputs, "alias @skillspp/core/commands");
  });
});
