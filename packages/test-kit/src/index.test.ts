import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempWorkspace, runProcess } from "./index";

describe("test-kit exports and helpers @unit", () => {
  it("creates an isolated temp workspace @unit", () => {
    const dir = createTempWorkspace("test-kit-");
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs a child process and collects stdout/stderr @unit", async () => {
    const dir = createTempWorkspace("test-kit-");
    const scriptPath = path.join(dir, "echo-script.mjs");

    fs.writeFileSync(
      scriptPath,
      [
        "process.stdout.write('hello-out');",
        "process.stderr.write('hello-err');",
      ].join("\n"),
      "utf8"
    );

    const result = await runProcess(process.execPath, [scriptPath], dir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-out");
    expect(result.stderr).toContain("hello-err");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
