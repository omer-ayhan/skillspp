import { Command, CommanderError } from "commander";
import { registerAddCommand } from "./commands/add";
import { registerCheckCommand } from "./commands/check";
import { registerFindCommand } from "./commands/find";
import { registerInitCommand } from "./commands/init";
import { isPromptCancelledError } from "./interactive";
import { registerListCommand } from "./commands/list";
import { registerRemoveCommand } from "./commands/remove";
import { registerUpdateCommand } from "./commands/update";
import { registerValidateCommand } from "./commands/validate";
import { createCliCommandContext } from "./command-builder";
import {
  emitLifecycleEvent,
  type TelemetryEmitter,
} from "@skillspp/core/telemetry";
import { createCliTelemetryEmitter, parseTelemetrySink } from "./telemetry";
import picocolors from "picocolors";
import { finalizeUiSession } from "./ui/screens";

function formatCliError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "VALIDATION_MISSING_SOURCE") {
      return "validate requires <source> unless --ci is used";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function createProgram(
  emitter: TelemetryEmitter,
  experimental: boolean,
): Command {
  const program = new Command()
    .name("skillspp")
    .usage("<command> [options]")
    .description("Skills++ CLI")
    .option("--telemetry <sink>", "Emit lifecycle events (stdout-json)")
    .option("--experimental", "Enable experimental features")
    .version("0.1.0", "-v, --version")
    .helpOption("-h, --help", "Show help");

  const context = createCliCommandContext(emitter, { experimental });
  registerAddCommand(program, context);
  registerFindCommand(program, context);
  registerListCommand(program, context);
  registerInitCommand(program, context);
  registerRemoveCommand(program, context);
  registerCheckCommand(program, context);
  registerUpdateCommand(program, context);
  registerValidateCommand(program, context);

  applyExitOverride(program);
  return program;
}

function applyExitOverride(command: Command): void {
  command.exitOverride((error) => {
    throw error;
  });
  for (const subcommand of command.commands) {
    applyExitOverride(subcommand);
  }
}

function parseTelemetryFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--telemetry") {
      continue;
    }
    return argv[i + 1];
  }
  return undefined;
}

function inferCommandSource(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--telemetry") {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return arg;
  }
  return "cli";
}

function emitCommanderParseErrorTelemetry(
  emitter: TelemetryEmitter,
  argv: string[],
  error: CommanderError,
): void {
  const source = inferCommandSource(argv);
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

export async function runCli(argv: string[]): Promise<number> {
  const telemetrySink = parseTelemetrySink(parseTelemetryFromArgv(argv));
  const emitter = createCliTelemetryEmitter(telemetrySink);
  const experimental = argv.includes("--experimental");
  const program = createProgram(emitter, experimental);

  if (argv.length === 0) {
    program.outputHelp();
    return 0;
  }

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === "commander.helpDisplayed"
    ) {
      return 0;
    }
    if (error instanceof CommanderError) {
      emitCommanderParseErrorTelemetry(emitter, argv, error);
      throw new Error(error.message);
    }
    throw error;
  }
}

runCli(process.argv.slice(2)).then(
  async (code) => {
    await finalizeUiSession();
    process.exit(code);
  },
  (error: unknown) => {
    finalizeUiSession().finally(() => {
      if (isPromptCancelledError(error)) {
        process.stdout.write(picocolors.red("Cancelled.\n"));
        process.exit(0);
      }
      if (error instanceof CommanderError) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
      }

      process.stderr.write(`${formatCliError(error)}\n`);
      process.exit(1);
    });
  },
);
