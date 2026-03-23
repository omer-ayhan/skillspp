import { describe, expect, it, vi } from "vitest";

const runBackgroundTaskInPlatform = vi.fn(async () => ({ durationMs: 123 }));

vi.mock("@skillspp/platform-node", () => ({
  runBackgroundTask: runBackgroundTaskInPlatform,
}));

const { runBackgroundTask } = await import("./runtime/background-runner");

describe("CLI runtime background-runner adapter @unit", () => {
  it("delegates execution to platform-node with core executor module @unit", async () => {
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
      }
    );

    expect(runBackgroundTaskInPlatform).toHaveBeenCalled();
    const secondArg = (runBackgroundTaskInPlatform.mock.calls[0] as any)?.[1];
    expect(secondArg).toMatchObject({
      executorModule: "@skillspp/core/runtime/background-tasks",
    });
    expect(response).toEqual({ durationMs: 123 });
  });
});
