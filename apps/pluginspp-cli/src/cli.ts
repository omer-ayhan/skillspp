import { Command, CommanderError } from "commander";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { registerAddCommand } from "./commands/add";
import { registerRemoveCommand } from "./commands/remove";
import { registerUpdateCommand } from "./commands/update";
import {
  applyExitOverride,
  createCliCommandContext,
  emitCommanderParseErrorTelemetry,
  isGracefulCommanderExit,
} from "@skillspp/cli-shared/command-builder";
import { configureLogoAssetPaths } from "@skillspp/cli-shared/ui/logo";
import {
  createTelemetryEmitter,
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
    if (isGracefulCommanderExit(error)) {
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
