import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const distDir = path.join(packageRoot, "dist");
const cliOutFile = path.join(distDir, "cli.js");

async function runBuild() {
  await mkdir(distDir, { recursive: true });

  await build({
    entryPoints: [path.join(packageRoot, "src", "cli.ts")],
    outfile: cliOutFile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node20",
    sourcemap: true,
    tsconfig: path.join(packageRoot, "tsconfig.json"),
    logLevel: "info",
    banner: { js: "#!/usr/bin/env node" },
  });

  await chmod(cliOutFile, 0o755);
}

runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
