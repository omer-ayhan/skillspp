import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerAddCommand } from "../../src/commands/add";
import { registerRemoveCommand } from "../../src/commands/remove";
import { registerUpdateCommand } from "../../src/commands/update";
import { createCliCommandContext } from "../../src/command-builder";
import { createTelemetryEmitter } from "@skillspp/core/telemetry";

function buildTestProgram(): Command {
  const emitter = createTelemetryEmitter();
  const context = createCliCommandContext(emitter);
  const program = new Command().name("skillspp-plugins").exitOverride();
  registerAddCommand(program, context);
  registerRemoveCommand(program, context);
  registerUpdateCommand(program, context);
  return program;
}

describe("skillspp-plugins CLI program @unit", () => {
  it("registers add subcommand @unit", () => {
    const program = buildTestProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("add");
  });

  it("registers remove subcommand @unit", () => {
    const program = buildTestProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("remove");
  });

  it("registers update subcommand @unit", () => {
    const program = buildTestProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("update");
  });

  it("registers exactly three subcommands @unit", () => {
    const program = buildTestProgram();
    expect(program.commands).toHaveLength(3);
  });
});
