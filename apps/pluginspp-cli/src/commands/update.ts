import { type Command } from "commander";
import { type CliCommandContext } from "../command-builder";

export function registerUpdateCommand(
  program: Command,
  context: CliCommandContext,
): void {
  program
    .command("update")
    .description("Update an AI agent plugin")
    .argument("[plugin]", "Plugin name to update (updates all if omitted)")
    .action(
      context.wrapAction("update", async (_plugin?: string) => {
        // TODO: implement update plugin logic
      }),
    );
}
