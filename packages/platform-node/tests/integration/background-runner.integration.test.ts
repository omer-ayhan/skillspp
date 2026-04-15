import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBackgroundTask } from "../../src/background-runner";

describe("platform-node background runner @integration", () => {
  it("spawns worker, emits progress, and returns task result @integration", async () => {
    const executorDir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-bg-"));
    const executorPath = path.join(executorDir, "executor.mjs");

    fs.writeFileSync(
      executorPath,
      [
        "export async function executeBackgroundTask(request, emitProgress) {",
        "  await emitProgress('progress-label');",
        "  return { echoed: request?.payload?.value ?? null };",
        "}",
      ].join("\n"),
      "utf8",
    );

    let progressLabel: string | undefined;

    const result = await runBackgroundTask<{ echoed: string }>(
      {
        payload: {
          value: "ok",
        },
      },
      {
        executorModule: executorPath,
        onProgress: (label) => {
          progressLabel = label;
        },
      },
    );

    expect(progressLabel).toBe("progress-label");
    expect(result.echoed).toBe("ok");

    fs.rmSync(executorDir, { recursive: true, force: true });
  });
});
