import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createTelemetryEmitter } from "@skillspp/core/telemetry";
import { createCliCommandContext } from "@skillspp/cli-shared/command-builder";
import { registerAddCommand } from "../../src/commands/add";

function buildAddCommand(): Command {
  const program = new Command().name("pluginspp").exitOverride();
  const context = createCliCommandContext(createTelemetryEmitter());
  registerAddCommand(program, context);
  return program.commands.find((command) => command.name() === "add") as Command;
}

describe("pluginspp add command @unit", () => {
  it("matches the plugin-specific option surface @unit", () => {
    const addCommand = buildAddCommand();
    const help = addCommand.helpInformation();

    expect(help).toContain("<source>");
    expect(help).toContain("--plugin");
    expect(help).toContain("--agent");
    expect(help).toContain("--list");
    expect(help).toContain("--non-interactive");
    expect(help).not.toContain("--skill");
    expect(help).not.toMatch(/(^|\s)--all(?:\s|,|$)/m);
  });
});
