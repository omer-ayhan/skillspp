import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { createTelemetryEmitter } from "@skillspp/core/telemetry";
import { createCliCommandContext } from "@skillspp/cli-shared/command-builder";
import { registerUpdateCommand } from "../../src/commands/update";

function buildUpdateCommand(): Command {
  const program = new Command().name("pluginspp").exitOverride();
  const context = createCliCommandContext(createTelemetryEmitter());
  registerUpdateCommand(program, context);
  return program.commands.find(
    (command) => command.name() === "update",
  ) as Command;
}

describe("pluginspp update command @unit", () => {
  it("matches the plugin-specific update option surface @unit", () => {
    const updateCommand = buildUpdateCommand();
    const help = updateCommand.helpInformation();

    expect(help).toContain("[plugin...]");
    expect(help).toContain("-p, --plugin");
    expect(help).toContain("--global");
    expect(help).toContain("--migrate");
    expect(help).toContain("--dry-run");
    expect(help).toContain("--non-interactive");
    expect(help).toContain("--trust-well-known");
    expect(help).toContain("--allow-host");
    expect(help).toContain("--deny-host");
    expect(help).toContain("--max-download-bytes");
    expect(help).toContain("--policy-mode");
    expect(help).toContain("--lock-format");
    expect(help).not.toContain("--skill");
    expect(help).not.toContain("-s, --plugin");
  });
});
