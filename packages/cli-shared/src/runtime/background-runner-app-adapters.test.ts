import { beforeEach, describe, expect, it, vi } from "vitest";

const createBackgroundTaskRunner = vi.fn();
const runBackgroundTaskImpl = vi.fn(async () => ({ durationMs: 123 }));

vi.mock("@skillspp/cli-shared/runtime/background-runner", () => ({
  createBackgroundTaskRunner,
}));

const APP_BACKGROUND_RUNNERS = [
  {
    label: "skillspp",
    modulePath: "../../../../apps/skillspp-cli/src/runtime/background-runner.ts",
  },
  {
    label: "pluginspp",
    modulePath: "../../../../apps/pluginspp-cli/src/runtime/background-runner.ts",
  },
] as const;

describe("CLI app background-runner adapters @unit", () => {
  beforeEach(() => {
    vi.resetModules();
    createBackgroundTaskRunner.mockReset();
    runBackgroundTaskImpl.mockReset();
    runBackgroundTaskImpl.mockResolvedValue({ durationMs: 123 });
    createBackgroundTaskRunner.mockReturnValue(runBackgroundTaskImpl);
  });

  it.each(APP_BACKGROUND_RUNNERS)(
    "delegates $label adapter creation to the shared factory @unit",
    async ({ modulePath }) => {
      const { runBackgroundTask } = await import(modulePath);

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
      expect(runBackgroundTaskImpl).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ durationMs: 123 });
    },
  );
});
