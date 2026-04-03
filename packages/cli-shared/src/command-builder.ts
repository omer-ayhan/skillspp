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
    }
  ) => void;
  wrapAction: <TArgs extends unknown[]>(
    command: string,
    action: (...args: TArgs) => Promise<void>
  ) => (...args: TArgs) => Promise<void>;
};

export function createCliCommandContext(
  emitter: TelemetryEmitter,
  options: { experimental?: boolean } = {}
): CliCommandContext {
  const emitCommandEvent: CliCommandContext["emitCommandEvent"] = (
    command,
    event
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
        action: (...args: TArgs) => Promise<void>
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

export async function parseStandaloneCommand(
  command: Command,
  args: string[]
): Promise<void> {
  command.exitOverride((error) => {
    throw error;
  });

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
