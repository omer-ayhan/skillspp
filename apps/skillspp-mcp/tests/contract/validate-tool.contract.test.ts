import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function callMcpTool(input: object): Promise<any> {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const child = spawn(
    process.execPath,
    [
      path.resolve(appRoot, "node_modules/tsx/dist/cli.mjs"),
      path.resolve(appRoot, "src/index.ts"),
    ],
    {
      cwd: appRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    }
  );

  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));

  child.stdin.write(`${JSON.stringify(input)}\n`);

  const response = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timeout waiting for MCP response"));
    }, 15_000);

    const onData = () => {
      const output = Buffer.concat(chunks).toString("utf8");
      const firstLine = output
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0);
      if (firstLine) {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        resolve(firstLine);
      }
    };

    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      const firstLine = output
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0);
      if (!firstLine) {
        const stderr = Buffer.concat(errChunks).toString("utf8");
        reject(new Error(`MCP process exited (${String(code)}): ${stderr}`));
      }
    });
  });

  return JSON.parse(response);
}

describe("skills.validate MCP contract @contract", () => {
  it("returns diagnostics on success and JSON-RPC error on invalid source @contract @critical", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skillspp-mcp-validate-"));
    const skillDir = path.join(tmpRoot, "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: demo\n---\n\n# Demo\n",
      "utf8"
    );

    const okResponse = await callMcpTool({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "skills.validate",
        arguments: {
          source: tmpRoot,
        },
      },
    });

    expect(okResponse.error).toBeFalsy();
    expect(Array.isArray(okResponse.result?.diagnostics)).toBe(true);

    const failResponse = await callMcpTool({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "skills.validate",
        arguments: {
          source: path.join(tmpRoot, "missing-root"),
        },
      },
    });

    expect(Boolean(failResponse.error)).toBe(true);
  });
});
