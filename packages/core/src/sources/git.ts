import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ParsedSource } from "../contracts/runtime-types";
type GitLikeSource = Exclude<ParsedSource, { type: "well-known" | "catalog" }>;

function runGit(args: string[], cwd?: string): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const detail = stderr || stdout || "git command failed";
    throw new Error(`${detail}`);
  }
}

function runGitOutput(args: string[], cwd?: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    const detail = stderr || stdout || "git command failed";
    throw new Error(`${detail}`);
  }
  return String(result.stdout || "").trim();
}

function runGitAsync(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim() || stdout.trim() || "git command failed";
      reject(new Error(detail));
    });
  });
}

function runGitOutputAsync(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const detail = stderr.trim() || stdout.trim() || "git command failed";
      reject(new Error(detail));
    });
  });
}

function applyCheckoutRefSync(repoDir: string, ref?: string): void {
  if (!ref) {
    return;
  }
  runGit(["fetch", "--depth", "1", "origin", ref], repoDir);
  runGit(["checkout", ref], repoDir);
}

async function applyCheckoutRefAsync(repoDir: string, ref?: string): Promise<void> {
  if (!ref) {
    return;
  }
  await runGitAsync(["fetch", "--depth", "1", "origin", ref], repoDir);
  await runGitAsync(["checkout", ref], repoDir);
}

export function prepareSourceDir(parsed: GitLikeSource): {
  basePath: string;
  cleanup?: () => void;
} {
  if (parsed.type === "local") {
    if (!fs.existsSync(parsed.localPath)) {
      throw new Error(`Local source not found: ${parsed.localPath}`);
    }
    return { basePath: parsed.localPath };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillspp-cli-"));
  runGit(["clone", "--depth", "1", parsed.repoUrl, tmp]);

  const ref = parsed.type === "github" ? parsed.ref : undefined;
  applyCheckoutRefSync(tmp, ref);

  const basePath =
    parsed.type === "github" && parsed.subpath
      ? path.join(tmp, parsed.subpath)
      : tmp;
  return {
    basePath,
    cleanup: () => {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export async function prepareSourceDirAsync(parsed: GitLikeSource): Promise<{
  basePath: string;
  cleanup?: () => void;
}> {
  if (parsed.type === "local") {
    if (!fs.existsSync(parsed.localPath)) {
      throw new Error(`Local source not found: ${parsed.localPath}`);
    }
    return { basePath: parsed.localPath };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skillspp-cli-"));
  await runGitAsync(["clone", "--depth", "1", parsed.repoUrl, tmp]);

  const ref = parsed.type === "github" ? parsed.ref : undefined;
  await applyCheckoutRefAsync(tmp, ref);

  const basePath =
    parsed.type === "github" && parsed.subpath
      ? path.join(tmp, parsed.subpath)
      : tmp;
  return {
    basePath,
    cleanup: () => {
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export function prepareSourceDirWithRef(
  parsed: GitLikeSource,
  options: { overrideRef?: string } = {},
): {
  basePath: string;
  cleanup?: () => void;
} {
  if (parsed.type === "local") {
    return prepareSourceDir(parsed);
  }
  const effectiveParsed =
    parsed.type === "github"
      ? { ...parsed, ref: options.overrideRef || parsed.ref }
      : parsed;
  const prepared = prepareSourceDir(effectiveParsed);
  if (parsed.type === "git" && options.overrideRef) {
    applyCheckoutRefSync(prepared.basePath, options.overrideRef);
  }
  return prepared;
}

export async function prepareSourceDirAsyncWithRef(
  parsed: GitLikeSource,
  options: { overrideRef?: string } = {},
): Promise<{
  basePath: string;
  cleanup?: () => void;
}> {
  if (parsed.type === "local") {
    return prepareSourceDirAsync(parsed);
  }
  const effectiveParsed =
    parsed.type === "github"
      ? { ...parsed, ref: options.overrideRef || parsed.ref }
      : parsed;
  const prepared = await prepareSourceDirAsync(effectiveParsed);
  if (parsed.type === "git" && options.overrideRef) {
    await applyCheckoutRefAsync(prepared.basePath, options.overrideRef);
  }
  return prepared;
}

export function resolveGitHeadRef(repoDir: string): string {
  return runGitOutput(["rev-parse", "HEAD"], repoDir);
}

export async function resolveGitHeadRefAsync(repoDir: string): Promise<string> {
  return runGitOutputAsync(["rev-parse", "HEAD"], repoDir);
}
