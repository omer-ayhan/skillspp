import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampActiveVisibleIndex,
  filterSelectionRowIndexes,
  invertRowsSelection,
  renderManySelectionOpenPanel,
  setAllRowsSelected,
  toggleSelectionAtVisibleIndex,
  type SelectableRowState,
} from "./selection-step";
import {
  bannerSection,
  composeUiSections,
  manySelectionClosedSection,
  panelSection,
  singleSelectionClosedSection,
} from "./screens";
import { resetLogoCache } from "./logo";

const rows: SelectableRowState[] = [
  { id: "a", label: "Alpha", description: "first", selected: false },
  { id: "b", label: "Beta", description: "second", selected: true },
  { id: "c", label: "Gamma", description: "third", selected: false },
];

describe("CLI selection and screen rendering helpers @unit", () => {
  it("applies selection helpers deterministically @unit", () => {
    expect(filterSelectionRowIndexes(rows, "be")).toEqual([1]);
    expect(toggleSelectionAtVisibleIndex(rows, [0, 1, 2], 0)[0]?.selected).toBe(
      true,
    );
    expect(setAllRowsSelected(rows, true).every((row) => row.selected)).toBe(
      true,
    );
    expect(invertRowsSelection(rows)[0]?.selected).toBe(true);
    expect(invertRowsSelection(rows)[1]?.selected).toBe(false);
    expect(clampActiveVisibleIndex(-1, 3)).toBe(0);
    expect(clampActiveVisibleIndex(99, 3)).toBe(2);
  });

  it("renders responsive open/closed panels based on terminal width @unit", () => {
    const originalColumns = process.stdout.columns;
    const originalIsTTY = process.stdout.isTTY;

    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const selectionModel = {
      title: "Choose Skills",
      rows: [
        {
          id: "skill-a",
          label: "react-native-skill",
          description: "RN code skill",
        },
        {
          id: "skill-b",
          label: "external-skill-b",
          description: "External skill B",
        },
      ],
      visibleRowIds: ["skill-a", "skill-b"],
      activeVisibleIndex: 0,
      selectedIds: ["skill-a"],
      searchable: true,
      required: true,
      searchTerm: "",
      keyHints: [{ key: "space", action: "toggle" }],
    };

    try {
      Object.defineProperty(process.stdout, "columns", {
        configurable: true,
        value: 80,
      });

      const wideOpen = renderManySelectionOpenPanel(
        {
          title: "Choose Skills",
          countLine: "2 available",
          instructionLine: "Select skills (space to toggle)",
          labelWidth: 32,
          descWidth: 40,
          minWidth: 74,
          defaultHints: [{ key: "space", action: "toggle" }],
        },
        selectionModel,
      );

      const wideClosedMany = composeUiSections([
        manySelectionClosedSection(
          {
            title: "Choose Skills",
            labelWidth: 32,
            descWidth: 40,
            minWidth: 74,
          },
          selectionModel.rows,
          ["skill-a"],
        ),
      ]);

      const wideClosedSingle = composeUiSections([
        singleSelectionClosedSection(
          {
            title: "Choose Agent",
            minWidth: 58,
          },
          "react-native-skill",
        ),
      ]);

      Object.defineProperty(process.stdout, "columns", {
        configurable: true,
        value: 40,
      });

      const narrowOpen = renderManySelectionOpenPanel(
        {
          title: "Choose Skills",
          countLine: "2 available",
          instructionLine: "Select skills (space to toggle)",
          labelWidth: 32,
          descWidth: 40,
          minWidth: 74,
          defaultHints: [{ key: "space", action: "toggle" }],
        },
        selectionModel,
      );

      const narrowClosedMany = composeUiSections([
        manySelectionClosedSection(
          {
            title: "Choose Skills",
            labelWidth: 32,
            descWidth: 40,
            minWidth: 74,
          },
          selectionModel.rows,
          ["skill-a"],
        ),
      ]);

      const narrowClosedSingle = composeUiSections([
        singleSelectionClosedSection(
          {
            title: "Choose Agent",
            minWidth: 58,
          },
          "react-native-skill",
        ),
      ]);

      expect(wideOpen).not.toEqual(narrowOpen);
      expect(wideClosedMany).not.toEqual(narrowClosedMany);
      expect(wideClosedSingle).not.toEqual(narrowClosedSingle);

      const panel = composeUiSections([
        panelSection({
          title: "Summary",
          lines: ["alpha", "beta"],
          minWidth: 20,
        }),
      ]);
      expect(panel).toContain("Summary");
    } finally {
      Object.defineProperty(process.stdout, "columns", {
        configurable: true,
        value: originalColumns,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: originalIsTTY,
      });
    }
  });

  it("falls back from session-logo to txt to title banner @unit", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "skillspp-logo-test-"),
    );
    const sessionPath = path.join(tmpDir, "skillspp-logo.session.json");
    const textPath = path.join(tmpDir, "skillspp-logo.txt");

    const validSession = {
      canvas: { width: 6, height: 3 },
      animation: { frameRate: 12, looping: true, currentFrame: 0 },
      frames: [
        {
          index: 0,
          name: "frame-1",
          duration: 100,
          cells: [
            { x: 0, y: 1, char: "@", color: "#ffffff", bgColor: "transparent" },
          ],
          cellCount: 1,
        },
      ],
    };

    fs.writeFileSync(sessionPath, JSON.stringify(validSession), "utf8");
    fs.writeFileSync(textPath, "\n\n#####\n\n", "utf8");

    process.env.SKILLSPP_LOGO_SESSION_PATH = sessionPath;
    process.env.SKILLSPP_LOGO_TEXT_PATH = textPath;
    resetLogoCache();

    const bannerFromSession = composeUiSections([bannerSection("LOGO TEST")]);
    expect(bannerFromSession).toContain("@");

    fs.writeFileSync(sessionPath, "{invalid json", "utf8");
    resetLogoCache();
    const bannerFromTxtFallback = composeUiSections([
      bannerSection("LOGO TEST"),
    ]);
    expect(bannerFromTxtFallback).toContain("#####");

    fs.unlinkSync(textPath);
    resetLogoCache();
    const bannerTextOnly = composeUiSections([bannerSection("LOGO TEST")]);
    expect(bannerTextOnly).toContain("LOGO TEST");
    expect(bannerTextOnly).not.toContain("#####");

    delete process.env.SKILLSPP_LOGO_SESSION_PATH;
    delete process.env.SKILLSPP_LOGO_TEXT_PATH;
    resetLogoCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
