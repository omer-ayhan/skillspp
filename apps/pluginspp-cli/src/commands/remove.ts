import { type Command } from "commander";
import { type CliCommandContext } from "../command-builder";

export function registerRemoveCommand(
  program: Command,
  context: CliCommandContext,
): void {
  program
    .command("remove")
    .description("Remove an AI agent plugin")
    .argument("<plugin>", "Plugin name to remove")
    .action(
      context.wrapAction("remove", async (_plugin: string) => {
        // TODO: implement remove plugin logic
      }),
    );
}
