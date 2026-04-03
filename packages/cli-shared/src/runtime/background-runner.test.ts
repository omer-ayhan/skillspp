import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runBackgroundTaskInPlatform = vi.fn(async () => ({ durationMs: 123 }));

vi.mock("@skillspp/platform-node", () => ({
  runBackgroundTask: runBackgroundTaskInPlatform,
}));

const { createBackgroundTaskRunner } = await import("./background-runner");

describe("shared background-runner adapter @unit", () => {
  it("delegates execution to platform-node with resolvable executor module @unit", async () => {
    const appRunnerUrl = pathToFileURL(
      path.resolve(
        process.cwd(),
        "../../apps/pluginspp-cli/src/runtime/background-runner.ts",
      ),
    ).href;
    const runBackgroundTask = createBackgroundTaskRunner(appRunnerUrl);

    const response = await runBackgroundTask(
      {
        kind: "test.blocking",
        payload: {
          durationMs: 123,
          progressLabel: "busy",
        },
      },
      {
        onProgress: () => {
          // no-op
        },
      },
    );

    expect(runBackgroundTaskInPlatform).toHaveBeenCalled();
    const secondArg = (runBackgroundTaskInPlatform.mock.calls[0] as any)?.[1];
    expect(typeof secondArg?.executorModule).toBe("string");
    expect(secondArg.executorModule).toContain("background-executor");
    expect(response).toEqual({ durationMs: 123 });
  });
});
