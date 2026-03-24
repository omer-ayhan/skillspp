import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const outFile = path.join(packageRoot, "dist", "cli.js");

async function runBuild() {
  await mkdir(path.dirname(outFile), { recursive: true });
  await build({
    entryPoints: [path.join(packageRoot, "src", "cli.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node20",
    sourcemap: true,
    tsconfig: path.join(packageRoot, "tsconfig.json"),
    logLevel: "info",
    banner: {
      js: "#!/usr/bin/env node",
    },
  });
  await chmod(outFile, 0o755);
}

runBuild().catch((error) => {
  console.error(error);
  process.exit(1);
});
