import { Command, CommanderError } from "commander";
import {
  emitLifecycleEvent,
  type TelemetryEmitter,
} from "@skillspp/core/telemetry";

export type CliCommandContext = {
  experimental: boolean;
  emitCommandEvent: (
    command: string,
    event: {
      eventType: string;
      reason: string;
      status: "start" | "ok" | "error" | "warn";
      error?: string;
      metadata?: Record<string, unknown>;
      source?: string;
    },
  ) => void;
  wrapAction: <TArgs extends unknown[]>(
    command: string,
    action: (...args: TArgs) => Promise<void>,
  ) => (...args: TArgs) => Promise<void>;
};

export function createCliCommandContext(
  emitter: TelemetryEmitter,
  options: { experimental?: boolean } = {},
): CliCommandContext {
  const emitCommandEvent: CliCommandContext["emitCommandEvent"] = (
    command,
    event,
  ) => {
    emitLifecycleEvent(emitter, {
      eventType: event.eventType,
      source: event.source ?? command,
      reason: event.reason,
      command,
      status: event.status,
      error: event.error,
      metadata: event.metadata,
    });
  };

  return {
    experimental: Boolean(options.experimental),
    emitCommandEvent,
    wrapAction:
      <TArgs extends unknown[]>(
        command: string,
        action: (...args: TArgs) => Promise<void>,
      ) =>
      async (...args: TArgs): Promise<void> => {
        emitCommandEvent(command, {
          eventType: `${command}_started`,
          reason: `${command}_started`,
          status: "start",
        });

        try {
          await action(...args);
          emitCommandEvent(command, {
            eventType: `${command}_completed`,
            reason: "complete",
            status: "ok",
          });
        } catch (error) {
          emitCommandEvent(command, {
            eventType: `${command}_failed`,
            reason: `${command}_failed`,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
  };
}

export function applyExitOverride(command: Command): void {
  command.exitOverride((error) => {
    throw error;
  });

  for (const subcommand of command.commands) {
    applyExitOverride(subcommand);
  }
}

export function isGracefulCommanderExit(
  error: unknown,
): error is CommanderError {
  return (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" ||
      error.code === "commander.version")
  );
}

type InferCommandSourceOptions = {
  fallbackSource?: string;
  valueFlags?: string[];
};

export function inferCommandSource(
  argv: string[],
  options: InferCommandSourceOptions = {},
): string {
  const valueFlags = new Set(options.valueFlags ?? []);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return arg;
  }

  return options.fallbackSource ?? "cli";
}

export function emitCommanderParseErrorTelemetry(
  emitter: TelemetryEmitter,
  argv: string[],
  error: CommanderError,
  options: InferCommandSourceOptions = {},
): void {
  const source = inferCommandSource(argv, options);
  emitLifecycleEvent(emitter, {
    eventType: `${source}_failed`,
    source,
    reason: "commander_parse_error",
    command: source,
    status: "error",
    error: error.message,
    metadata: {
      commanderCode: error.code,
    },
  });
}

export async function parseStandaloneCommand(
  command: Command,
  args: string[],
): Promise<void> {
  applyExitOverride(command);

  try {
    await command.parseAsync(args, { from: "user" });
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === "commander.helpDisplayed"
    ) {
      return;
    }
    if (error instanceof CommanderError) {
      throw new Error(error.message);
    }
    throw error;
  }
}
