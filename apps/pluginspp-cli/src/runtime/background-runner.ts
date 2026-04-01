import { runBackgroundTask as runBackgroundTaskInPlatform } from "@skillspp/platform-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  BackgroundTaskKind,
  BackgroundTaskRequest,
  BackgroundTaskResult,
} from "./background-task-types";

export type RunBackgroundTaskOptions = {
  onProgress?: (label: string) => void;
};

function resolveExecutorModule(): string {
  const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
  const localCandidates = [
    path.join(runtimeDir, "background-executor.js"),
    path.join(runtimeDir, "background-executor.ts"),
  ];

  for (const candidate of localCandidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  return "@skillspp/core/runtime/background-tasks";
}

export async function runBackgroundTask<TKind extends BackgroundTaskKind>(
  request: BackgroundTaskRequest<TKind>,
  options: RunBackgroundTaskOptions = {},
): Promise<BackgroundTaskResult<TKind>> {
  return runBackgroundTaskInPlatform<BackgroundTaskResult<TKind>>(request, {
    onProgress: options.onProgress,
    executorModule: resolveExecutorModule(),
  });
}
