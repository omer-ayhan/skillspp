type TaskProgressEvent = {
  type: "progress";
  label: string;
};

type TaskResultEvent = {
  type: "result";
  result: unknown;
};

type TaskErrorEvent = {
  type: "error";
  message: string;
  stack?: string;
  code?: string;
};

type TaskEvent = TaskProgressEvent | TaskResultEvent | TaskErrorEvent;

type TaskExecutorModule = {
  executeBackgroundTask: (
    request: unknown,
    emitProgress: (label: string) => Promise<void> | void,
  ) => Promise<unknown>;
};

function sendMessage(message: TaskEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error("Background worker requires IPC"));
      return;
    }
    process.send(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function sendProgress(label: string): Promise<void> {
  await sendMessage({ type: "progress", label });
}

async function sendError(error: unknown): Promise<void> {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;

  try {
    await sendMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      code,
    });
  } finally {
    process.exit(1);
  }
}

async function loadExecutor(): Promise<TaskExecutorModule> {
  const modulePath = process.env.SKILLSPP_BG_EXECUTOR;
  if (!modulePath) {
    throw new Error("Missing SKILLSPP_BG_EXECUTOR for background worker");
  }

  const loaded = (await import(modulePath)) as Partial<TaskExecutorModule>;
  if (!loaded.executeBackgroundTask) {
    throw new Error(`Executor module does not export executeBackgroundTask: ${modulePath}`);
  }

  return loaded as TaskExecutorModule;
}

process.once("message", async (message: unknown) => {
  try {
    const executor = await loadExecutor();

    const maybeRequest = message as { payload?: { cwd?: unknown } };
    const cwd = maybeRequest.payload?.cwd;
    if (typeof cwd === "string" && cwd.length > 0) {
      process.chdir(cwd);
    }

    const result = await executor.executeBackgroundTask(message, sendProgress);
    await sendMessage({ type: "result", result });
    process.exit(0);
  } catch (error) {
    await sendError(error);
  }
});
