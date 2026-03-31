import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type RunResult = {
  code: number;
  output: string;
};

function runCli(cwd: string, args: string[]): Promise<RunResult> {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const tsxPath = path.resolve(appRoot, "node_modules/tsx/dist/cli.mjs");
  const cliEntry = path.resolve(appRoot, "src/cli.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxPath, cliEntry, ...args], {
      cwd,
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

describe("skillspp-plugins binary @e2e", () => {
  it("resolves and returns help output in a clean temp directory @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-"),
    );
    try {
      const result = await runCli(workdir, ["--help"]);
      expect(result.code).toBe(0);
      expect(result.output).toContain("skillspp-plugins");
      expect(result.output).toContain("add");
      expect(result.output).toContain("remove");
      expect(result.output).toContain("update");
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);
});
