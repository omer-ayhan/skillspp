import { type Command } from "commander";
import { type CliCommandContext } from "../command-builder";

export function registerAddCommand(
  program: Command,
  context: CliCommandContext,
): void {
  program
    .command("add")
    .description("Add an AI agent plugin")
    .argument("<plugin>", "Plugin name to add (e.g. codex, claude-code, gemini-cli, cursor)")
    .action(
      context.wrapAction("add", async (_plugin: string) => {
        // TODO: implement add plugin logic
      }),
    );
}
