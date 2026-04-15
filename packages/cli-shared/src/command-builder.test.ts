import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  applyExitOverride,
  createCliCommandContext,
  emitCommanderParseErrorTelemetry,
  inferCommandSource,
  isGracefulCommanderExit,
  parseStandaloneCommand,
} from "./command-builder";
import { createTelemetryEmitter } from "@skillspp/core/telemetry";

describe("createCliCommandContext @unit", () => {
  it("wrapAction emits start and ok events on success @unit", async () => {
    const emitter = createTelemetryEmitter();
    const events: string[] = [];
    emitter.subscribe((event) => events.push(event.eventType));

    const context = createCliCommandContext(emitter);
    const action = vi.fn().mockResolvedValue(undefined);
    const wrapped = context.wrapAction("add", action);

    await wrapped("some-plugin");

    expect(action).toHaveBeenCalledWith("some-plugin");
    expect(events).toContain("add_started");
    expect(events).toContain("add_completed");
  });

  it("wrapAction emits error event and rethrows on failure @unit", async () => {
    const emitter = createTelemetryEmitter();
    const events: string[] = [];
    emitter.subscribe((event) => events.push(event.eventType));

    const context = createCliCommandContext(emitter);
    const error = new Error("plugin not found");
    const action = vi.fn().mockRejectedValue(error);
    const wrapped = context.wrapAction("remove", action);

    await expect(wrapped("missing-plugin")).rejects.toThrow("plugin not found");
    expect(events).toContain("remove_started");
    expect(events).toContain("remove_failed");
    expect(events).not.toContain("remove_completed");
  });

  it("emitCommandEvent forwards event to telemetry emitter @unit", () => {
    const emitter = createTelemetryEmitter();
    const received: string[] = [];
    emitter.subscribe((event) => received.push(event.eventType));

    const context = createCliCommandContext(emitter);
    context.emitCommandEvent("update", {
      eventType: "update_custom",
      reason: "test",
      status: "warn",
    });

    expect(received).toContain("update_custom");
  });
});

describe("commander helpers @unit", () => {
  it("applyExitOverride cascades to subcommands @unit", async () => {
    const program = new Command("root");
    const child = new Command("child")
      .requiredOption("--required <value>")
      .action(() => undefined);
    program.addCommand(child);

    applyExitOverride(program);

    await expect(
      program.parseAsync(["child"], { from: "user" }),
    ).rejects.toBeInstanceOf(CommanderError);
  });

  it("inferCommandSource skips option values and falls back to cli @unit", () => {
    expect(
      inferCommandSource(["--telemetry", "stdout-json", "add", "foo"], {
        valueFlags: ["--telemetry"],
      }),
    ).toBe("add");
    expect(inferCommandSource(["--help"])).toBe("cli");
  });

  it("emitCommanderParseErrorTelemetry reports command-specific metadata @unit", () => {
    const emitter = createTelemetryEmitter();
    const received: Array<Record<string, unknown>> = [];
    emitter.subscribe((event) => received.push(event));

    emitCommanderParseErrorTelemetry(
      emitter,
      ["--telemetry", "stdout-json", "validate"],
      new CommanderError(1, "commander.unknownOption", "unknown option"),
      {
        valueFlags: ["--telemetry"],
      },
    );

    expect(received).toEqual([
      expect.objectContaining({
        eventType: "validate_failed",
        source: "validate",
        reason: "commander_parse_error",
        command: "validate",
        status: "error",
        error: "unknown option",
        metadata: expect.objectContaining({
          commanderCode: "commander.unknownOption",
        }),
      }),
    ]);
  });

  it("detects help/version exits without swallowing real commander errors @unit", () => {
    expect(
      isGracefulCommanderExit(
        new CommanderError(0, "commander.helpDisplayed", "help"),
      ),
    ).toBe(true);
    expect(
      isGracefulCommanderExit(new CommanderError(0, "commander.version", "1")),
    ).toBe(true);
    expect(
      isGracefulCommanderExit(
        new CommanderError(1, "commander.unknownOption", "bad"),
      ),
    ).toBe(false);
  });
});

describe("parseStandaloneCommand @unit", () => {
  it("runs a command successfully @unit", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const cmd = new Command("test").argument("<arg>").action(action);

    await parseStandaloneCommand(cmd, ["hello"]);
    expect(action).toHaveBeenCalled();
    expect(action.mock.calls[0][0]).toBe("hello");
  });

  it("swallows helpDisplayed commander error @unit", async () => {
    const cmd = new Command("test").helpOption("-h, --help");
    await expect(
      parseStandaloneCommand(cmd, ["--help"]),
    ).resolves.toBeUndefined();
  });

  it("converts other CommanderError to Error @unit", async () => {
    const cmd = new Command("test").requiredOption("--required <val>");
    await expect(parseStandaloneCommand(cmd, [])).rejects.toThrow(Error);
  });
});
