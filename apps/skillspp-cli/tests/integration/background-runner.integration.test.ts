import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBackgroundTask } from "@skillspp/platform-node";

describe("CLI background runner orchestration @integration", () => {
  it("keeps parent process responsive while child task executes @integration", async () => {
    const heartbeatTimes: number[] = [];
    const startedAt = Date.now();
    let lastProgressLabel: string | undefined;

    const executorDir = fs.mkdtempSync(path.join(os.tmpdir(), "skillspp-bg-executor-"));
    const executorPath = path.join(executorDir, "executor.mjs");
    fs.writeFileSync(
      executorPath,
      [
        "export async function executeBackgroundTask(request, emitProgress) {",
        "  const durationMs = Number(request?.payload?.durationMs ?? 0);",
        "  const label = String(request?.payload?.progressLabel ?? 'working');",
        "  await emitProgress(label);",
        "  await new Promise((resolve) => setTimeout(resolve, durationMs));",
        "  return { durationMs };",
        "}",
      ].join("\n"),
      "utf8",
    );

    const timer = setInterval(() => {
      heartbeatTimes.push(Date.now() - startedAt);
    }, 40);

    try {
      const result = await runBackgroundTask<{ durationMs: number }>(
        {
          payload: {
            durationMs: 320,
            progressLabel: "busy worker",
          },
        },
        {
          executorModule: executorPath,
          onProgress: (label) => {
            lastProgressLabel = label;
          },
        },
      );

      expect(result.durationMs).toBe(320);
    } finally {
      clearInterval(timer);
      fs.rmSync(executorDir, { recursive: true, force: true });
    }

    expect(lastProgressLabel).toBe("busy worker");
    expect(heartbeatTimes.length).toBeGreaterThanOrEqual(4);
  });
});
