import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type TaskEvent =
  | { type: "progress"; label: string }
  | { type: "result"; result: unknown }
  | { type: "error"; message: string; stack?: string; code?: string };

type RunBackgroundTaskOptions = {
  onProgress?: (label: string) => void;
  executorModule: string;
};

const activeChildren = new Set<ChildProcess>();
let cleanupHandlersInstalled = false;

function cleanupActiveChildren(): void {
  for (const child of [...activeChildren]) {
    if (child.killed || child.exitCode !== null) {
      activeChildren.delete(child);
      continue;
    }
    child.kill("SIGTERM");
  }
}

function installCleanupHandlers(): void {
  if (cleanupHandlersInstalled) {
    return;
  }
  cleanupHandlersInstalled = true;

  process.on("exit", cleanupActiveChildren);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as NodeJS.Signals[]) {
    const handler = () => {
      cleanupActiveChildren();
      process.off(signal, handler);
      setImmediate(() => {
        process.kill(process.pid, signal);
      });
    };
    process.on(signal, handler);
  }
}

function resolveWorkerEntry(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tsPath = path.join(dir, "background-worker.ts");
  if (fs.existsSync(tsPath)) {
    return tsPath;
  }
  return path.join(dir, "background-worker.js");
}

function appendOutputChunk(chunks: string[], chunk: Buffer | string): void {
  const next = chunk.toString();
  chunks.push(next);
  const combined = chunks.join("");
  if (combined.length <= 8000) {
    return;
  }
  const trimmed = combined.slice(-8000);
  chunks.splice(0, chunks.length, trimmed);
}

export async function runBackgroundTask<TResult>(
  request: unknown,
  options: RunBackgroundTaskOptions,
): Promise<TResult> {
  installCleanupHandlers();

  return new Promise<TResult>((resolve, reject) => {
    const childCwd =
      typeof request === "object" &&
      request !== null &&
      "payload" in (request as Record<string, unknown>) &&
      typeof (request as { payload?: { cwd?: unknown } }).payload?.cwd ===
        "string"
        ? (request as { payload: { cwd: string } }).payload.cwd
        : process.cwd();

    const child = spawn(
      process.execPath,
      [...process.execArgv, resolveWorkerEntry()],
      {
        cwd: childCwd,
        env: {
          ...process.env,
          SKILLSPP_BG_EXECUTOR: options.executorModule,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );

    activeChildren.add(child);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      activeChildren.delete(child);
      callback();
    };

    child.stdout?.on("data", (chunk) => {
      appendOutputChunk(stdoutChunks, chunk);
    });

    child.stderr?.on("data", (chunk) => {
      appendOutputChunk(stderrChunks, chunk);
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("message", (message: TaskEvent) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "progress") {
        options.onProgress?.(message.label);
        return;
      }

      if (message.type === "error") {
        const taskError = new Error(message.message);
        if (message.stack) {
          taskError.stack = message.stack;
        }
        if (message.code) {
          (taskError as Error & { code?: string }).code = message.code;
        }
        finish(() => reject(taskError));
        return;
      }

      if (message.type === "result") {
        finish(() => resolve(message.result as TResult));
      }
    });

    child.on("close", (code, signal) => {
      activeChildren.delete(child);
      if (settled) {
        return;
      }

      const stderr = stderrChunks.join("").trim();
      const stdout = stdoutChunks.join("").trim();
      const detail =
        stderr ||
        stdout ||
        (signal
          ? `background task exited via ${signal}`
          : `background task exited with code ${String(code)}`);
      settled = true;
      reject(new Error(detail));
    });

    child.once("spawn", () => {
      child.send(request as any);
    });
  });
}
