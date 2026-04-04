import { Command, CommanderError } from "commander";
import { createRequire } from "node:module";
import { registerAddCommand } from "./commands/add";
import { registerCheckCommand } from "./commands/check";
import { registerFindCommand } from "./commands/find";
import { registerInitCommand } from "./commands/init";
import { registerListCommand } from "./commands/list";
import { registerRemoveCommand } from "./commands/remove";
import { registerUpdateCommand } from "./commands/update";
import { registerValidateCommand } from "./commands/validate";
import {
  applyExitOverride,
  createCliCommandContext,
  emitCommanderParseErrorTelemetry,
  isGracefulCommanderExit,
} from "@skillspp/cli-shared/command-builder";
import { isPromptCancelledError } from "@skillspp/cli-shared/interactive";
import { configureLogoAssetPaths } from "@skillspp/cli-shared/ui/logo";
import { type TelemetryEmitter } from "@skillspp/core/telemetry";
import { createCliTelemetryEmitter, parseTelemetrySink } from "./telemetry";
import picocolors from "picocolors";
import { finalizeUiSession } from "@skillspp/cli-shared/ui/screens";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: unknown };
const CLI_VERSION =
  typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

function resolveSkillsppLogoDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../src/assets/ascii/logo");
}

export function configureSkillsppLogoAssetPaths(): void {
  const logoDir = resolveSkillsppLogoDir();
  configureLogoAssetPaths({
    sessionPath: path.join(logoDir, "skillspp-logo.session.json"),
    textPath: path.join(logoDir, "skillspp-logo.txt"),
  });
}

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
    .version(CLI_VERSION, "-v, --version")
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

function parseTelemetryFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--telemetry") {
      continue;
    }
    return argv[i + 1];
  }
  return undefined;
}

export async function runCli(argv: string[]): Promise<number> {
  configureSkillsppLogoAssetPaths();

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
    if (isGracefulCommanderExit(error)) {
      return 0;
    }
    if (error instanceof CommanderError) {
      emitCommanderParseErrorTelemetry(emitter, argv, error, {
        valueFlags: ["--telemetry"],
      });
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
