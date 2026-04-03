import { stripVTControlCharacters } from "node:util";
import React, { type ReactNode, useEffect, useState } from "react";
import { Box, Text, render, useInput, useStdout } from "ink";
import type { Instance } from "ink";
import { compactAgentDisplayNames, shortenHomePath } from "./format";
import {
  type AnimatedLogo,
  getAnimatedLogoFrames,
  getBannerLogoLines,
} from "./logo";
import { ANSI_RESET, bold, colorToken, dim } from "./colors";
import type { SelectionRow } from "@skillspp/core/agents";

export type PanelStyle = "square" | "rounded";

export type UiSection =
  | { type: "banner"; title: string; width?: number }
  | {
      type: "panel";
      title: string;
      lines: string[];
      style?: PanelStyle;
      minWidth?: number;
      indent?: string;
    }
  | { type: "lines"; lines: string[] }
  | { type: "source"; source: string }
  | { type: "text"; text: string };

export type ManySelectionViewConfig = {
  title: string;
  countLine: string;
  instructionLine: string;
  labelWidth: number;
  descWidth: number;
  minWidth?: number;
  defaultHints: Array<{ key: string; action: string }>;
};

export type SingleSelectionViewConfig = {
  title: string;
  instructionLine: string;
  minWidth?: number;
};

export type SelectionKeyHint = {
  key: string;
  action: string;
};

export type StepStatus = "completed" | "failed";

const DEFAULT_BANNER_WIDTH = 78;
const DEFAULT_PANEL_MIN_WIDTH = 58;
const MIN_TERMINAL_WIDTH = 40;
const MIN_INNER_WIDTH = 16;
const FRAME_OVERHEAD = 4;
const SELECTION_ROW_OVERHEAD = 8;
const PINNED_LOGO_HEADER_WIDTH = 78;
const PINNED_LOGO_BOTTOM_MARGIN_LINES = 1;

function singleLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUiBlock(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[0]?.trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }
  return lines.join("\n");
}

function finalizeUiBlock(value: string): string {
  const normalized = normalizeUiBlock(value);
  return normalized.length === 0 ? "" : `${normalized}\n`;
}

function visibleLength(text: string): number {
  return stripVTControlCharacters(text).length;
}

function readAnsiSequence(text: string, index: number): string | null {
  if (text[index] !== "\x1b") {
    return null;
  }
  const match = /^\x1b\[[0-9;]*m/.exec(text.slice(index));
  return match?.[0] ?? null;
}

function splitVisiblePrefix(
  text: string,
  visibleChars: number,
): { head: string; tail: string } {
  const target = Math.max(0, Math.floor(visibleChars));
  if (target <= 0) {
    return { head: "", tail: text };
  }

  let index = 0;
  let visible = 0;
  let head = "";
  while (index < text.length && visible < target) {
    const ansi = readAnsiSequence(text, index);
    if (ansi) {
      head += ansi;
      index += ansi.length;
      continue;
    }
    head += text[index] ?? "";
    index += 1;
    visible += 1;
  }

  if (head.includes("\x1b[") && !head.endsWith(ANSI_RESET)) {
    head += ANSI_RESET;
  }

  return {
    head,
    tail: text.slice(index),
  };
}

function wrapVisibleLine(text: string, width: number): string[] {
  const normalized = singleLine(text);
  const target = Math.max(1, Math.floor(width));
  if (normalized.length === 0) {
    return [""];
  }

  const out: string[] = [];
  let remaining = normalized;
  while (visibleLength(remaining) > target) {
    const { head, tail } = splitVisiblePrefix(remaining, target);
    out.push(head);
    remaining = tail;
  }
  out.push(remaining);
  return out;
}

function truncate(text: string, width: number): string {
  const target = Math.max(0, Math.floor(width));
  if (target <= 0) {
    return "";
  }
  const value = singleLine(text);
  if (value.length <= target) {
    return value;
  }
  if (target <= 3) {
    return value.slice(0, target);
  }
  return `${value.slice(0, target - 3)}...`;
}

function padRight(text: string, width: number): string {
  const target = Math.max(0, Math.floor(width));
  const value = singleLine(text);
  const valueVisibleLength = visibleLength(value);
  if (valueVisibleLength >= target) {
    return splitVisiblePrefix(value, target).head;
  }
  return `${value}${" ".repeat(target - valueVisibleLength)}`;
}

function center(text: string, width: number): string {
  const target = Math.max(0, Math.floor(width));
  const value = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, " ");
  const valueLength = visibleLength(value);
  if (valueLength >= target) {
    return value;
  }
  const left = Math.floor((target - valueLength) / 2);
  const right = target - valueLength - left;
  return `${" ".repeat(left)}${value}${" ".repeat(right)}`;
}

export function selectionHintsText(hints: SelectionKeyHint[]): string {
  return hints
    .map((hint) => `${dim(hint.key)} ${hint.action}`.trim())
    .join("   ");
}

function resolveTerminalColumns(): number {
  return Math.max(MIN_TERMINAL_WIDTH, process.stdout.columns || 80);
}

function resolveMaxInnerWidth(indent = "  "): number {
  return Math.max(
    MIN_INNER_WIDTH,
    resolveTerminalColumns() - indent.length - FRAME_OVERHEAD,
  );
}

function clampToTerminalInnerWidth(
  idealWidth: number,
  minWidth: number,
  indent = "  ",
): number {
  const maxInnerWidth = resolveMaxInnerWidth(indent);
  const lowerBound = Math.min(minWidth, maxInnerWidth);
  return Math.max(lowerBound, Math.min(idealWidth, maxInnerWidth));
}

function resolvePanelWidth(options: {
  title: string;
  lines: string[];
  minWidth?: number;
}): number {
  const lineLengths = options.lines.map((line) =>
    visibleLength(singleLine(line)),
  );
  return Math.max(
    options.minWidth ?? DEFAULT_PANEL_MIN_WIDTH,
    singleLine(options.title).length + 4,
    ...lineLengths,
  );
}

export function resolveSelectionColumnWidths(
  innerWidth: number,
  targetLabelWidth: number,
  targetDescWidth: number,
): { labelWidth: number; descWidth: number } {
  const availableColumns = Math.max(8, innerWidth - SELECTION_ROW_OVERHEAD);
  const targetTotal = Math.max(
    8,
    targetLabelWidth + Math.max(0, targetDescWidth),
  );
  if (availableColumns >= targetTotal) {
    return {
      labelWidth: targetLabelWidth,
      descWidth: targetDescWidth,
    };
  }

  let labelWidth = Math.max(8, Math.floor(availableColumns * 0.6));
  let descWidth = Math.max(0, availableColumns - labelWidth);
  if (descWidth < 6 && labelWidth > 8) {
    const shift = Math.min(6 - descWidth, labelWidth - 8);
    labelWidth -= shift;
    descWidth += shift;
  }

  return { labelWidth, descWidth };
}

function renderFramedPanel(options: {
  title: string;
  width: number;
  indent: string;
  lines: string[];
  style: PanelStyle;
}): string {
  const title = singleLine(options.title);
  const width = Math.max(1, options.width);
  const topTail = Math.max(1, width - title.length - 1);
  const bottomWidth = width + 2;

  const topLeft = options.style === "rounded" ? "╭" : "┌";
  const topRight = options.style === "rounded" ? "╮" : "┐";
  const bottomLeft = options.style === "rounded" ? "╰" : "└";
  const bottomRight = options.style === "rounded" ? "╯" : "┘";

  const out: string[] = [];
  out.push(
    `${options.indent}${dim(
      `${topLeft}─ ${title} ${"─".repeat(topTail)}${topRight}`,
    )}`,
  );
  for (const line of options.lines) {
    for (const wrappedLine of wrapVisibleLine(line, width)) {
      out.push(
        `${options.indent}${dim("│")} ${padRight(wrappedLine, width)} ${dim(
          "│",
        )}`,
      );
    }
  }
  out.push(
    `${options.indent}${dim(
      `${bottomLeft}${"─".repeat(bottomWidth)}${bottomRight}`,
    )}`,
  );
  return out.join("\n");
}

function toSelectedRows(
  rows: SelectionRow[],
  selectedIds: string[],
): Array<{ label: string; description: string }> {
  const selected = new Set(selectedIds);
  return rows
    .filter((row) => selected.has(row.id))
    .map((row) => ({
      label: row.label,
      description: row.description || "",
    }));
}

export function renderPanelText(options: {
  title: string;
  lines: string[];
  style?: PanelStyle;
  minWidth?: number;
  indent?: string;
}): string {
  const indent = options.indent || "  ";
  const idealWidth = resolvePanelWidth({
    title: options.title,
    lines: options.lines,
    minWidth: options.minWidth,
  });
  const width = clampToTerminalInnerWidth(
    idealWidth,
    options.minWidth ?? DEFAULT_PANEL_MIN_WIDTH,
    indent,
  );

  return finalizeUiBlock(
    renderFramedPanel({
      title: options.title,
      width,
      indent,
      lines: options.lines,
      style: options.style || "square",
    }),
  );
}

export function resolveSelectionPanelLayout(options: {
  title: string;
  staticLines: string[];
  minWidth?: number;
  labelWidth: number;
  descWidth: number;
  indent?: string;
}): { width: number; labelWidth: number; descWidth: number } {
  const indent = options.indent || "  ";
  const idealWidth = Math.max(
    resolvePanelWidth({
      title: options.title,
      lines: options.staticLines,
      minWidth: options.minWidth,
    }),
    SELECTION_ROW_OVERHEAD + options.labelWidth + options.descWidth,
  );
  const width = clampToTerminalInnerWidth(
    idealWidth,
    options.minWidth ?? DEFAULT_PANEL_MIN_WIDTH,
    indent,
  );
  const columns = resolveSelectionColumnWidths(
    width,
    options.labelWidth,
    options.descWidth,
  );
  return {
    width,
    labelWidth: columns.labelWidth,
    descWidth: columns.descWidth,
  };
}

export function formatSelectionDisplayLine(options: {
  prefix: string;
  marker?: string;
  label: string;
  description?: string;
  labelWidth: number;
  descWidth: number;
}): string {
  const label = options.marker
    ? padRight(truncate(options.label, options.labelWidth), options.labelWidth)
    : truncate(options.label, options.labelWidth);
  const description = truncate(options.description || "", options.descWidth);

  if (!options.marker) {
    return options.description
      ? `${options.prefix}${label}  ${description}`
      : `${options.prefix}${label}`;
  }

  return `${options.prefix}${options.marker} ${label}  ${description}`;
}

function renderSectionToText(section: UiSection): string {
  switch (section.type) {
    case "banner": {
      const logoLines = getBannerLogoLines();
      const widestLogoLine = logoLines.reduce(
        (max, line) => Math.max(max, visibleLength(line)),
        0,
      );
      const resolvedWidth = clampToTerminalInnerWidth(
        Math.max(
          section.width ?? DEFAULT_BANNER_WIDTH,
          singleLine(section.title).length,
          widestLogoLine,
        ),
        Math.max(singleLine(section.title).length, widestLogoLine),
      );
      const border = "─".repeat(resolvedWidth);
      const bodyLines = [
        ...logoLines.map((line) => center(line, resolvedWidth)),
        ...(logoLines.length > 0 ? [center("", resolvedWidth)] : []),
        center(section.title, resolvedWidth),
      ];
      return finalizeUiBlock(
        [
          dim(`╭${border}╮`),
          ...bodyLines.map((line) => `${dim("│")}${line}${dim("│")}`),
          dim(`╰${border}╯`),
        ].join("\n"),
      );
    }
    case "panel": {
      return renderPanelText(section);
    }
    case "source":
      return finalizeUiBlock(`  Plugins source: ${section.source}`);
    case "lines":
      return finalizeUiBlock(section.lines.join("\n"));
    case "text":
      return finalizeUiBlock(section.text);
    default:
      return "";
  }
}

export function composeUiSections(sections: UiSection[]): string {
  const normalizedSections = sections
    .map((section) => normalizeUiBlock(renderSectionToText(section)))
    .filter((section) => section.length > 0);
  if (normalizedSections.length === 0) {
    return "";
  }
  return `${normalizedSections.join("\n\n")}\n`;
}

type HistoryEntry = {
  id: number;
  sections: UiSection[];
};

type SessionSnapshot = {
  history: HistoryEntry[];
  liveRenderer: ((resizeTick: number) => ReactNode) | null;
  loaderLabel: string | null;
  logoHeader: AnimatedLogo | null;
};

function HistoryText({ text }: { text: string }) {
  return <Text>{text.replace(/\n$/, "")}</Text>;
}

function renderPinnedLogoHeaderText(lines: string[]): string {
  const widestLogoLine = lines.reduce(
    (max, line) => Math.max(max, visibleLength(line)),
    0,
  );
  const resolvedWidth = clampToTerminalInnerWidth(
    Math.max(PINNED_LOGO_HEADER_WIDTH, widestLogoLine),
    Math.max(1, widestLogoLine),
  );
  const bodyLines = lines.map((line) => center(line, resolvedWidth));
  return finalizeUiBlock(bodyLines.join("\n"));
}

const AnimatedLogoHeader = React.memo(function AnimatedLogoHeader(props: {
  logo: AnimatedLogo;
}) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    if (props.logo.frames.length <= 1) {
      return;
    }
    const frameDurationMs = Math.max(16, Math.floor(1000 / props.logo.fps));
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % props.logo.frames.length);
    }, frameDurationMs);

    return () => {
      clearInterval(timer);
    };
  }, [props.logo]);

  const frameLines =
    props.logo.frames[frameIndex] ?? props.logo.frames[0] ?? [];
  return (
    <Box flexDirection="column" marginBottom={PINNED_LOGO_BOTTOM_MARGIN_LINES}>
      <HistoryText text={renderPinnedLogoHeaderText(frameLines)} />
    </Box>
  );
});

function useResizeTick(): number {
  const { stdout } = useStdout();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const handleResize = () => {
      setTick((prev) => prev + 1);
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  return tick;
}

function SessionScreen(props: SessionSnapshot) {
  const resizeTick = useResizeTick();

  return (
    <Box flexDirection="column">
      {props.logoHeader ? <AnimatedLogoHeader logo={props.logoHeader} /> : null}
      {props.history.map((entry) => (
        <HistoryText key={entry.id} text={composeUiSections(entry.sections)} />
      ))}
      {props.loaderLabel ? <Spinner label={props.loaderLabel} /> : null}
      {props.liveRenderer ? props.liveRenderer(resizeTick) : null}
    </Box>
  );
}

class InkSession {
  private instance: Instance | null = null;
  private history: HistoryEntry[] = [];
  private liveRenderer: ((resizeTick: number) => ReactNode) | null = null;
  private loaderLabel: string | null = null;
  private logoHeader: AnimatedLogo | null = null;
  private nextId = 1;

  private ensureMounted(): void {
    if (this.instance) {
      return;
    }
    this.maybeInitializeGlobalLogoHeader();
    this.instance = render(<SessionScreen {...this.snapshot()} />, {
      exitOnCtrlC: false,
      patchConsole: false,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });
  }

  private maybeInitializeGlobalLogoHeader(): void {
    if (this.logoHeader) {
      return;
    }
    if (!process.stdout.isTTY || Boolean(process.env.CI)) {
      return;
    }
    const animated = getAnimatedLogoFrames();
    if (!animated || animated.frames.length === 0) {
      return;
    }
    this.logoHeader = animated;
  }

  private snapshot(): SessionSnapshot {
    return {
      history: [...this.history],
      liveRenderer: this.liveRenderer,
      loaderLabel: this.loaderLabel,
      logoHeader: this.logoHeader,
    };
  }

  private sync(): void {
    this.ensureMounted();
    this.instance?.rerender(<SessionScreen {...this.snapshot()} />);
  }

  appendSections(sections: UiSection[]): void {
    if (sections.length === 0) {
      return;
    }
    const text = composeUiSections(sections);
    if (!text.trim()) {
      return;
    }
    this.history = [
      ...this.history,
      {
        id: this.nextId++,
        sections: [...sections],
      },
    ];
    this.sync();
  }

  setLiveRenderer(renderer: ((resizeTick: number) => ReactNode) | null): void {
    this.liveRenderer = renderer;
    this.sync();
  }

  clearLiveRenderer(): void {
    this.liveRenderer = null;
    this.sync();
  }

  ensureUiStarted(): void {
    this.ensureMounted();
  }

  isGlobalLogoHeaderEnabled(): boolean {
    return this.logoHeader !== null;
  }

  showLoader(label: string): void {
    this.loaderLabel = label;
    this.sync();
  }

  hideLoader(): void {
    if (!this.loaderLabel) {
      return;
    }
    this.loaderLabel = null;
    this.sync();
  }

  async close(): Promise<void> {
    this.history = [];
    this.liveRenderer = null;
    this.loaderLabel = null;
    this.logoHeader = null;
    const current = this.instance;
    this.instance = null;
    current?.unmount();
  }
}

let activeSession: InkSession | null = null;

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getSession(): InkSession {
  if (!activeSession) {
    activeSession = new InkSession();
  }
  return activeSession;
}

export async function renderStaticScreen(sections: UiSection[]): Promise<void> {
  const session = getSession();
  session.ensureUiStarted();
  const headerEnabled = session.isGlobalLogoHeaderEnabled();
  session.appendSections(
    headerEnabled
      ? filterBannerSectionsForGlobalMode(sections)
      : freezeBannerSections(sections, getBannerLogoLines()),
  );
  await waitForNextFrame();
}

function renderSectionToTextWithLogoLines(
  section: UiSection,
  logoLinesOverride: string[] | null,
): string {
  if (section.type !== "banner") {
    return renderSectionToText(section);
  }

  const logoLines = logoLinesOverride ?? getBannerLogoLines();
  const widestLogoLine = logoLines.reduce(
    (max, line) => Math.max(max, visibleLength(line)),
    0,
  );
  const resolvedWidth = clampToTerminalInnerWidth(
    Math.max(
      section.width ?? DEFAULT_BANNER_WIDTH,
      singleLine(section.title).length,
      widestLogoLine,
    ),
    Math.max(singleLine(section.title).length, widestLogoLine),
  );
  const border = "─".repeat(resolvedWidth);
  const bodyLines = [
    ...logoLines.map((line) => center(line, resolvedWidth)),
    ...(logoLines.length > 0 ? [center("", resolvedWidth)] : []),
    center(section.title, resolvedWidth),
  ];
  return finalizeUiBlock(
    [
      `╭${border}╮`,
      ...bodyLines.map((line) => `│${line}│`),
      `╰${border}╯`,
    ].join("\n"),
  );
}

function freezeBannerSections(
  sections: UiSection[],
  logoLines: string[],
): UiSection[] {
  return sections.map((section) => {
    if (section.type !== "banner") {
      return section;
    }
    return {
      type: "text",
      text: renderSectionToTextWithLogoLines(section, logoLines),
    };
  });
}

export function filterBannerSectionsForGlobalMode(
  sections: UiSection[],
): UiSection[] {
  return sections.filter((section) => section.type !== "banner");
}

export function setLiveScreen(
  renderer: ((resizeTick: number) => ReactNode) | null,
): void {
  getSession().setLiveRenderer(renderer);
}

export function clearLiveScreen(): void {
  activeSession?.clearLiveRenderer();
}

export function showLoader(label = "loading"): void {
  getSession().showLoader(label);
}

export function hideLoader(): void {
  activeSession?.hideLoader();
}

export async function flushUiFrame(): Promise<void> {
  await waitForNextFrame();
}

export async function finalizeUiSession(): Promise<void> {
  if (!activeSession) {
    return;
  }
  await waitForNextFrame();
  const session = activeSession;
  activeSession = null;
  await session.close();
}

export function bannerSection(title: string, width?: number): UiSection {
  return { type: "banner", title, width };
}

export function panelSection(options: {
  title: string;
  lines: string[];
  style?: PanelStyle;
  minWidth?: number;
  indent?: string;
}): UiSection {
  return { type: "panel", ...options };
}

export function linesSection(lines: string[]): UiSection {
  return { type: "lines", lines };
}

export function statusStepsSection(
  steps: Array<{ status: StepStatus; label: string }>,
): UiSection {
  return linesSection(
    steps.map(({ status, label }) => {
      const marker =
        status === "failed"
          ? colorToken("x", "danger")
          : colorToken("✓", "success");
      return `  ${marker} ${singleLine(label)}`;
    }),
  );
}

export function completedStepsSection(steps: string[]): UiSection {
  return statusStepsSection(
    steps.map((step) => ({ status: "completed" as const, label: step })),
  );
}

export function failedStepsSection(steps: string[]): UiSection {
  return statusStepsSection(
    steps.map((step) => ({ status: "failed" as const, label: step })),
  );
}

export function sourceSection(source: string): UiSection {
  return { type: "source", source };
}

export function textSection(text: string): UiSection {
  return { type: "text", text };
}

export function completionSummarySection(options: {
  skillCount: number;
  agentCount: number;
}): UiSection {
  const skillLabel = options.skillCount === 1 ? "skill" : "skills";
  const agentLabel = options.agentCount === 1 ? "agent" : "agents";
  return linesSection([
    "Done.",
    `Installed ${options.skillCount} ${skillLabel} across ${options.agentCount} ${agentLabel}.`,
  ]);
}

export function removeCompletionSummarySection(
  removedCount: number,
): UiSection {
  return linesSection(["Done.", `Total removed: ${removedCount}`]);
}

export function installationSummarySection(options: {
  mode: "copy" | "symlink";
  scope: string;
  skillCount: number;
  agentCount: number;
  targetCount: number;
  targets: Array<{
    skillName: string;
    agentDisplayName: string;
    destinationPath: string;
    mode: "copy" | "symlink";
  }>;
}): UiSection {
  const lines: string[] = [
    `${bold("Mode:")} ${dim(options.mode)}   ${bold("Scope:")} ${dim(
      options.scope,
    )}   ${bold("Skills:")} ${colorToken(
      options.skillCount.toString(),
      "primary",
    )}   ${bold("Agents:")} ${colorToken(
      options.agentCount.toString(),
      "primary",
    )}   ${bold("Targets:")} ${colorToken(
      options.targetCount.toString(),
      "primary",
    )}`,
    "",
    bold("Targets:"),
  ];

  let activeSkill = "";
  for (const row of options.targets) {
    if (row.skillName !== activeSkill) {
      activeSkill = row.skillName;
      lines.push("");
      lines.push(colorToken(`  ${row.skillName}`, "primary"));
    }
    lines.push(
      `    - ${row.agentDisplayName.padEnd(16, " ")} ${dim(
        shortenHomePath(row.destinationPath),
      )} ${dim(`[${row.mode}]`)}`,
    );
  }

  return panelSection({
    title: "Installation Summary",
    lines,
    style: "rounded",
    minWidth: 72,
  });
}

export function uninstallSummarySection(options: {
  globalInstall: boolean;
  itemNames: string[];
  itemLabel?: string;
  agentDisplayNames: string[];
}): UiSection {
  const itemLabel = options.itemLabel || "Skills";
  return panelSection({
    title: "Uninstall Summary",
    lines: [
      `Scope: ${options.globalInstall ? "global" : "current project"}`,
      "",
      `${itemLabel} (${options.itemNames.length}):`,
      ...options.itemNames.map((name) => `  - ${name}`),
      "",
      `Agents (${options.agentDisplayNames.length}): ${compactAgentDisplayNames(
        [...options.agentDisplayNames].sort((a, b) => a.localeCompare(b)),
        4,
      )}`,
    ],
    style: "rounded",
    minWidth: 74,
  });
}

export function manySelectionClosedSection(
  config: Pick<
    ManySelectionViewConfig,
    "title" | "labelWidth" | "descWidth" | "minWidth"
  >,
  rows: SelectionRow[],
  selectedIds: string[],
): UiSection {
  const selectedRows = toSelectedRows(rows, selectedIds);
  const layout = resolveSelectionPanelLayout({
    title: config.title,
    staticLines: [],
    minWidth: config.minWidth,
    labelWidth: config.labelWidth,
    descWidth: config.descWidth,
  });

  const lines: string[] = [];
  if (selectedRows.length === 0) {
    lines.push("  ○ (none)");
  } else {
    for (const row of selectedRows) {
      lines.push(
        formatSelectionDisplayLine({
          prefix: "  ",
          marker: colorToken("●", "primary"),
          label: row.label,
          description: row.description,
          labelWidth: layout.labelWidth,
          descWidth: layout.descWidth,
        }),
      );
    }
  }

  return panelSection({
    title: config.title,
    lines,
    style: "square",
    minWidth: config.minWidth,
  });
}

export function singleSelectionClosedSection(
  config: Pick<SingleSelectionViewConfig, "title" | "minWidth">,
  selectedLabel: string,
): UiSection {
  return panelSection({
    title: config.title,
    lines: [`  ▸ ${singleLine(selectedLabel)}`],
    style: "square",
    minWidth: config.minWidth,
  });
}

export class PromptCancelledError extends Error {
  constructor(message = "Interactive prompt cancelled by user") {
    super(message);
    this.name = "PromptCancelledError";
  }
}

function TextInputScreen(props: {
  message: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  onCancel: (error: Error) => void;
}) {
  const [value, setValue] = useState(props.defaultValue || "");

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      props.onCancel(new PromptCancelledError());
      return;
    }
    if (key.escape) {
      props.onCancel(new PromptCancelledError());
      return;
    }
    if (key.return) {
      props.onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => [...prev].slice(0, -1).join(""));
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setValue((prev) => `${prev}${input}`);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{`${props.message}: ${value}`}</Text>
      <Text dimColor>enter confirm esc cancel</Text>
    </Box>
  );
}

export async function runTextInputScreen(options: {
  message: string;
  defaultValue?: string;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    setLiveScreen(() => (
      <TextInputScreen
        message={options.message}
        defaultValue={options.defaultValue}
        onSubmit={(value) => {
          clearLiveScreen();
          resolve(value);
        }}
        onCancel={(error) => {
          clearLiveScreen();
          reject(error);
        }}
      />
    ));
  });
}

export function Spinner({ label }: { label: string }) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frames.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text>{`  ${colorToken(frames[frameIndex], "primary")} ${label}`}</Text>
  );
}
