import { Command, CommanderError } from "commander";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { registerAddCommand } from "./commands/add";
import { registerRemoveCommand } from "./commands/remove";
import { registerUpdateCommand } from "./commands/update";
import { createCliCommandContext } from "@skillspp/cli-shared/command-builder";
import { configureLogoAssetPaths } from "@skillspp/cli-shared/ui/logo";
import {
  createTelemetryEmitter,
  emitLifecycleEvent,
  type TelemetryEmitter,
} from "@skillspp/core/telemetry";
import picocolors from "picocolors";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: unknown };
const CLI_VERSION =
  typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

function resolvePluginsppLogoDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../assets/ascii/logo");
}

export function configurePluginsppLogoAssetPaths(): void {
  const logoDir = resolvePluginsppLogoDir();
  configureLogoAssetPaths({
    sessionPath: path.join(logoDir, "pluginspp-logo.session.json"),
    textPath: path.join(logoDir, "pluginspp-logo.txt"),
  });
}

function createProgram(emitter: TelemetryEmitter): Command {
  const program = new Command()
    .name("pluginspp")
    .usage("<command> [options]")
    .description("Skills++ Plugins CLI for managing AI agent plugins.")
    .version(CLI_VERSION, "-v, --version")
    .helpOption("-h, --help", "Show help");

  const context = createCliCommandContext(emitter);
  registerAddCommand(program, context);
  registerRemoveCommand(program, context);
  registerUpdateCommand(program, context);

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

function inferCommandSource(argv: string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
  configurePluginsppLogoAssetPaths();

  const emitter = createTelemetryEmitter();
  const program = createProgram(emitter);

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
      (error.code === "commander.helpDisplayed" ||
        error.code === "commander.version")
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

function isDirectCliInvocation(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectCliInvocation()) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exit(code);
    },
    (error: unknown) => {
      if (error instanceof CommanderError) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(picocolors.red(`${message}\n`));
      process.exit(1);
    },
  );
}
