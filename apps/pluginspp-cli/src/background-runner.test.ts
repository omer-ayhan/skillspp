import { describe, expect, it, vi } from "vitest";

const createBackgroundTaskRunner = vi.fn();
const runBackgroundTaskImpl = vi.fn(async () => ({ durationMs: 123 }));
createBackgroundTaskRunner.mockReturnValue(runBackgroundTaskImpl);

vi.mock("@skillspp/cli-shared/runtime/background-runner", () => ({
  createBackgroundTaskRunner,
}));

const { runBackgroundTask } = await import("./runtime/background-runner");

describe("CLI runtime background-runner adapter @unit", () => {
  it("delegates to the shared background-runner factory @unit", async () => {
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

    expect(createBackgroundTaskRunner).toHaveBeenCalledTimes(1);
    expect(runBackgroundTaskImpl).toHaveBeenCalled();
    expect(response).toEqual({ durationMs: 123 });
  });
});
