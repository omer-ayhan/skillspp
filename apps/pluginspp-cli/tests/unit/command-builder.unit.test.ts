import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  createCliCommandContext,
  parseStandaloneCommand,
} from "@skillspp/cli-shared/command-builder";
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
