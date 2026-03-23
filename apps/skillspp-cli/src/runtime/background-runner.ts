import { runBackgroundTask as runBackgroundTaskInPlatform } from "@skillspp/platform-node";
import type {
  BackgroundTaskKind,
  BackgroundTaskRequest,
  BackgroundTaskResult,
} from "./background-task-types";

export type RunBackgroundTaskOptions = {
  onProgress?: (label: string) => void;
};

export async function runBackgroundTask<TKind extends BackgroundTaskKind>(
  request: BackgroundTaskRequest<TKind>,
  options: RunBackgroundTaskOptions = {}
): Promise<BackgroundTaskResult<TKind>> {
  return runBackgroundTaskInPlatform<BackgroundTaskResult<TKind>>(request, {
    onProgress: options.onProgress,
    executorModule: "@skillspp/core/runtime/background-tasks",
  });
}
