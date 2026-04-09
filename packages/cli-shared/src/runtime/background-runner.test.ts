import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runBackgroundTaskInPlatform = vi.fn(async () => ({ durationMs: 123 }));

vi.mock("@skillspp/platform-node", () => ({
  runBackgroundTask: runBackgroundTaskInPlatform,
}));

const { createBackgroundTaskRunner } = await import("./background-runner");

describe("shared background-runner adapter @unit", () => {
  it("uses a colocated executor module when one exists @unit", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const appRunnerUrl = pathToFileURL(
      path.resolve(
        here,
        "../../../../apps/skillspp-cli/src/runtime/background-runner.ts",
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

  it("falls back to the core executor module when no local executor exists @unit", async () => {
    runBackgroundTaskInPlatform.mockClear();

    const here = path.dirname(fileURLToPath(import.meta.url));
    const appRunnerUrl = pathToFileURL(
      path.resolve(
        here,
        "../../../../apps/pluginspp-cli/src/runtime/background-runner.ts",
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
    expect(secondArg.executorModule).toBe(
      "@skillspp/core/runtime/background-tasks",
    );
    expect(response).toEqual({ durationMs: 123 });
  });
});
