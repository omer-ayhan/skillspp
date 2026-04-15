import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const distDir = path.join(packageRoot, "dist");
const cliOutFile = path.join(distDir, "cli.js");
const workerOutFile = path.join(distDir, "background-worker.js");
const executorOutFile = path.join(distDir, "background-executor.js");

function createBuildOptions(entryPoint, outfile, banner) {
  return {
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node20",
    sourcemap: true,
    tsconfig: path.join(packageRoot, "tsconfig.json"),
    logLevel: "info",
    banner,
  };
}

async function runBuild() {
  await mkdir(distDir, { recursive: true });

  await build(
    createBuildOptions(path.join(packageRoot, "src", "cli.ts"), cliOutFile, {
      js: "#!/usr/bin/env node",
    }),
  );

  await build(
    createBuildOptions(
      path.resolve(packageRoot, "../../packages/platform-node/src/background-worker.ts"),
      workerOutFile,
    ),
  );

  await build(
    createBuildOptions(
      path.join(packageRoot, "src", "runtime", "background-executor.ts"),
      executorOutFile,
    ),
  );

  await chmod(cliOutFile, 0o755);
}

runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
