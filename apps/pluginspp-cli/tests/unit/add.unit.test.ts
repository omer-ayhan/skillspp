import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerAddCommand } from "../../src/commands/add";
import { createCliCommandContext } from "../../src/command-builder";
import { createTelemetryEmitter } from "@skillspp/core/telemetry";

vi.mock("@skillspp/core", () => ({
  AddPluginService: class {
    execute() {
      return Promise.resolve({
        installedPlugins: ["codex"],
        skippedPlugins: [],
        failedPlugins: [],
      });
    }
  },
}));

vi.mock("@skillspp/platform-node", () => ({
  createNodeCoreCommandPort: () => ({}),
}));

function buildTestProgram(): Command {
  const emitter = createTelemetryEmitter();
  const context = createCliCommandContext(emitter);
  const program = new Command().name("pluginspp").exitOverride();
  registerAddCommand(program, context);
  return program;
}

describe("registerAddCommand @unit", () => {
  it("registers add subcommand @unit", () => {
    const program = buildTestProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("add");
  });

  it("add command accepts a single positional <source> argument @unit", () => {
    const program = buildTestProgram();
    const addCmd = program.commands.find((c) => c.name() === "add");
    expect(addCmd).toBeDefined();
    const args = addCmd!.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe("source");
    expect(args[0].variadic).toBe(false);
  });

  it("add command has -a, --agent option @unit", () => {
    const program = buildTestProgram();
    const addCmd = program.commands.find((c) => c.name() === "add");
    expect(addCmd).toBeDefined();
    const optionNames = addCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--agent");
  });

  it("add command has --global option @unit", () => {
    const program = buildTestProgram();
    const addCmd = program.commands.find((c) => c.name() === "add");
    expect(addCmd).toBeDefined();
    const optionNames = addCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--global");
  });

  it("add command has --non-interactive option @unit", () => {
    const program = buildTestProgram();
    const addCmd = program.commands.find((c) => c.name() === "add");
    expect(addCmd).toBeDefined();
    const optionNames = addCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--non-interactive");
  });

  it("throws for unknown agent name @unit", async () => {
    const program = buildTestProgram();

    await expect(
      program.parseAsync(["add", "./plugins", "-a", "not-a-real-agent"], { from: "user" }),
    ).rejects.toThrow("Unknown agent: not-a-real-agent");
  });

  it("does not throw validation error for wildcard '*' agent @unit", async () => {
    const program = buildTestProgram();

    await expect(
      program.parseAsync(["add", "./plugins", "-a", "*"], { from: "user" }),
    ).resolves.not.toThrow();
  });
});
