import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createTelemetryEmitter } from "@skillspp/core/telemetry";
import { createCliCommandContext } from "@skillspp/cli-shared/command-builder";
import { registerRemoveCommand } from "../../src/commands/remove";

function buildRemoveCommand(): Command {
  const program = new Command().name("pluginspp").exitOverride();
  const context = createCliCommandContext(createTelemetryEmitter());
  registerRemoveCommand(program, context);
  return program.commands.find(
    (command) => command.name() === "remove",
  ) as Command;
}

describe("pluginspp remove command @unit", () => {
  it("matches the plugin-specific option surface @unit", () => {
    const removeCommand = buildRemoveCommand();
    const help = removeCommand.helpInformation();

    expect(help).toContain("[plugins...]");
    expect(help).toContain("--plugin");
    expect(help).toContain("--agent");
    expect(help).toContain("--non-interactive");
    expect(help).not.toContain("--skill");
    expect(help).not.toMatch(/(^|\s)--all(?:\s|,|$)/m);
  });

  it("registers the rm alias @unit", () => {
    const removeCommand = buildRemoveCommand();
    expect(removeCommand.aliases()).toContain("rm");
  });
});
