import { describe, expect, it, vi, beforeEach } from "vitest";

const runManySelectionStep = vi.fn();

vi.mock("./ui/selection-step", async () => {
  const actual = await vi.importActual<typeof import("./ui/selection-step")>(
    "./ui/selection-step",
  );
  return {
    ...actual,
    runManySelectionStep,
  };
});

const {
  applyForcedAddOptionFlags,
  buildNamedAddSelectionRows,
  buildBaseAddOptions,
  filterNamedAddSelection,
  parseAddLockFormatValue,
  resolveNamedAddSelection,
} = await import("./add-command");

const ITEMS = [
  { name: "alpha", description: "first" },
  { name: "beta", description: "second" },
] as const;

const BASE_OPTIONS = {
  rows: buildNamedAddSelectionRows(ITEMS),
  keyHints: [{ key: "space", action: "toggle" }] as const,
  view: {
    title: "Choose Items",
    countLine: "available",
    instructionLine: "Select items",
    labelWidth: 32,
    descWidth: 40,
    minWidth: 74,
    defaultHints: [{ key: "space", action: "toggle" }],
  },
  promptTitle: "Choose Items",
  requiredMessage: "Select at least one item",
  emptyMessage: "No items available",
  multipleInNonInteractiveMessage: "Multiple items found",
  renderClosed: (selectedNames: string[]) => ({
    type: "text" as const,
    text: selectedNames.join(", "),
  }),
};

describe("add-command helpers @unit", () => {
  beforeEach(() => {
    runManySelectionStep.mockReset();
  });

  it("builds selection rows from named items @unit", () => {
    expect(buildNamedAddSelectionRows(ITEMS)).toEqual([
      { id: "alpha", label: "alpha", description: "first" },
      { id: "beta", label: "beta", description: "second" },
    ]);
  });

  it("filters requested names case-insensitively and honors wildcard @unit", () => {
    expect(filterNamedAddSelection(ITEMS, ["BETA"])).toEqual([ITEMS[1]]);
    expect(filterNamedAddSelection(ITEMS, ["*"])).toEqual(ITEMS);
    expect(filterNamedAddSelection(ITEMS)).toEqual(ITEMS);
  });

  it("returns filtered results in list mode without prompting @unit", async () => {
    const selected = await resolveNamedAddSelection({
      ...BASE_OPTIONS,
      available: ITEMS,
      interactive: false,
      listMode: true,
      requested: ["beta"],
    });

    expect(selected).toEqual([ITEMS[1]]);
    expect(runManySelectionStep).not.toHaveBeenCalled();
  });

  it("replays requested selections without prompting when matches exist @unit", async () => {
    runManySelectionStep.mockResolvedValue(["alpha"]);

    const selected = await resolveNamedAddSelection({
      ...BASE_OPTIONS,
      available: ITEMS,
      interactive: false,
      requested: ["alpha"],
    });

    expect(selected).toEqual([ITEMS[0]]);
    expect(runManySelectionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: false,
        shouldPrompt: false,
        selectedIds: ["alpha"],
      }),
    );
  });

  it("auto-selects the only item without prompting @unit", async () => {
    runManySelectionStep.mockResolvedValue(["alpha"]);

    const selected = await resolveNamedAddSelection({
      ...BASE_OPTIONS,
      available: [ITEMS[0]],
      interactive: false,
      rows: buildNamedAddSelectionRows([ITEMS[0]]),
    });

    expect(selected).toEqual([ITEMS[0]]);
    expect(runManySelectionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        shouldPrompt: false,
        selectedIds: ["alpha"],
      }),
    );
  });

  it("throws the configured error when no items are available @unit", async () => {
    await expect(
      resolveNamedAddSelection({
        ...BASE_OPTIONS,
        available: [],
        interactive: true,
        rows: [],
      }),
    ).rejects.toThrow("No items available");
  });

  it("throws the configured non-interactive error for multiple choices @unit", async () => {
    await expect(
      resolveNamedAddSelection({
        ...BASE_OPTIONS,
        available: ITEMS,
        interactive: false,
      }),
    ).rejects.toThrow("Multiple items found");
  });

  it("prompts interactively when multiple items remain @unit", async () => {
    runManySelectionStep.mockResolvedValue(["beta"]);

    const selected = await resolveNamedAddSelection({
      ...BASE_OPTIONS,
      available: ITEMS,
      interactive: true,
    });

    expect(selected).toEqual([ITEMS[1]]);
    expect(runManySelectionStep).toHaveBeenCalledWith(
      expect.objectContaining({
        interactive: true,
        shouldPrompt: true,
      }),
    );
  });

  it("parses shared add options consistently @unit", () => {
    expect(
      buildBaseAddOptions(
        {
          global: true,
          symlink: true,
          yaml: true,
          list: true,
          nonInteractive: true,
          trustWellKnown: true,
          agent: ["Codex", "claude-code"],
          selectedNames: ["alpha"],
          allowHost: ["EXAMPLE.COM"],
          denyHost: ["BAD.EXAMPLE"],
          maxDownloadBytes: "42",
          policyMode: "warn",
          lockFormat: "yaml",
          experimental: true,
        },
        { globalProvided: true, symlinkProvided: true },
      ),
    ).toEqual(
      expect.objectContaining({
        global: true,
        symlink: true,
        yaml: true,
        list: true,
        nonInteractive: true,
        trustWellKnown: true,
        agent: ["Codex", "claude-code"],
        agentFlagProvided: true,
        globalFlagProvided: true,
        symlinkFlagProvided: true,
        skill: ["alpha"],
        allowHost: ["example.com"],
        denyHost: ["bad.example"],
        maxDownloadBytes: 42,
        policyMode: "warn",
        lockFormat: "yaml",
        experimental: true,
      }),
    );
  });

  it("supports all-mode wildcard expansion for shared add options @unit", () => {
    expect(
      buildBaseAddOptions({
        all: true,
        selectedNames: ["ignored"],
        agent: ["ignored"],
      }),
    ).toEqual(
      expect.objectContaining({
        all: true,
        skill: ["*"],
        agent: ["*"],
      }),
    );
  });

  it("marks forced global/symlink flags without changing values @unit", () => {
    expect(
      applyForcedAddOptionFlags(
        { global: false, symlink: false },
        { global: true, symlink: true },
      ),
    ).toEqual(
      expect.objectContaining({
        global: false,
        symlink: false,
        globalFlagProvided: true,
        symlinkFlagProvided: true,
      }),
    );
  });

  it("parses and validates shared lock formats @unit", () => {
    expect(parseAddLockFormatValue("json")).toBe("json");
    expect(parseAddLockFormatValue("yaml")).toBe("yaml");
    expect(parseAddLockFormatValue()).toBeUndefined();
    expect(() => parseAddLockFormatValue("toml")).toThrow(
      "Invalid --lock-format value: toml",
    );
  });
});
