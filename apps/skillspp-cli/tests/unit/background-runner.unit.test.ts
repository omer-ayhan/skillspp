import { describe, expect, it, vi } from "vitest";

const createBackgroundTaskRunner = vi.fn();
const runBackgroundTaskImpl = vi.fn(async () => ({ durationMs: 123 }));
createBackgroundTaskRunner.mockReturnValue(runBackgroundTaskImpl);

vi.mock("@skillspp/cli-shared/runtime/background-runner", () => ({
  createBackgroundTaskRunner,
}));

const { runBackgroundTask } =
  await import("../../src/runtime/background-runner");

describe("CLI background runner adapter @unit", () => {
  it("uses the colocated background executor module @unit", async () => {
    const response = await runBackgroundTask(
      {
        kind: "test.blocking",
        payload: {
          durationMs: 123,
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
