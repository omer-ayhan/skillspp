import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type RunResult = {
  code: number;
  output: string;
};

function runCli(args: string[]): Promise<RunResult> {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const tsxPath = path.resolve(appRoot, "node_modules/tsx/dist/cli.mjs");
  const cliEntry = path.resolve(appRoot, "src/cli.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxPath, cliEntry, ...args], {
      cwd: appRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));

    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code: code ?? 1,
        output: `${Buffer.concat(out).toString("utf8")}${Buffer.concat(err).toString("utf8")}`,
      });
    });
  });
}

describe("pluginspp CLI @integration", () => {
  it("--help exits 0 and lists all subcommands @integration", async () => {
    const result = await runCli(["--help"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("add");
    expect(result.output).toContain("remove");
    expect(result.output).toContain("update");
  }, 30_000);

  it("--version prints package version @integration", async () => {
    const result = await runCli(["--version"]);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/\d+\.\d+\.\d+/);
  }, 30_000);
});
