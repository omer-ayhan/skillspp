export type { RunBackgroundTaskOptions } from "@skillspp/cli-shared/runtime/background-runner";

import { createBackgroundTaskRunner } from "@skillspp/cli-shared/runtime/background-runner";

export const runBackgroundTask = createBackgroundTaskRunner(import.meta.url);
