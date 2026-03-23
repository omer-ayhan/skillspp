import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "__pycache__",
]);
const SKIP_FILES = new Set(["skillspp-lock.json", "skillspp-lock.yaml"]);

function walkDir(
  baseDir: string,
  dir: string,
  hash: ReturnType<typeof createHash>,
): void {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\n`);
      walkDir(baseDir, fullPath, hash);
      continue;
    }

    if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) {
        continue;
      }
      const content = fs.readFileSync(fullPath);
      hash.update(`file:${relativePath}\n`);
      hash.update(content);
      hash.update("\n");
    }
  }
}

function waitForNextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function walkDirAsync(
  baseDir: string,
  dir: string,
  hash: ReturnType<typeof createHash>,
): Promise<void> {
  const entries = (
    await fs.promises.readdir(dir, { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    await waitForNextTurn();

    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\n`);
      await walkDirAsync(baseDir, fullPath, hash);
      continue;
    }

    if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) {
        continue;
      }
      const content = await fs.promises.readFile(fullPath);
      hash.update(`file:${relativePath}\n`);
      hash.update(content);
      hash.update("\n");
    }
  }
}

export function hashDirectory(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Directory not found for hashing: ${resolved}`);
  }

  const hash = createHash("sha256");
  walkDir(resolved, resolved, hash);
  return hash.digest("hex");
}

export async function hashDirectoryAsync(dirPath: string): Promise<string> {
  const resolved = path.resolve(dirPath);
  const stats = await fs.promises.stat(resolved).catch(() => null);
  if (!stats || !stats.isDirectory()) {
    throw new Error(`Directory not found for hashing: ${resolved}`);
  }

  const hash = createHash("sha256");
  await walkDirAsync(resolved, resolved, hash);
  return hash.digest("hex");
}
