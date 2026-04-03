<<<<<<<< HEAD:packages/cli-shared/src/ui/selection-step.tsx
import React from "react";
import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  clearLiveScreen,
  PromptCancelledError,
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  type SingleSelectionViewConfig,
  type UiSection,
  formatSelectionDisplayLine,
  renderPanelText,
  renderStaticScreen,
  resolveSelectionPanelLayout,
  selectionHintsText,
  setLiveScreen,
} from "./screens";
import { colorToken, dim } from "./colors";
import type { SelectionRow } from "@skillspp/core/agents";

export type {
  ManySelectionViewConfig,
  SelectionKeyHint,
  SingleSelectionViewConfig,
} from "./screens";

type StepPromptBase = {
  title: string;
  required?: boolean;
  requiredMessage?: string;
  searchable?: boolean;
  keyHints?: SelectionKeyHint[];
};

type RunManySelectionStepOptions = {
  interactive: boolean;
  rows: SelectionRow[];
  selectedIds?: string[];
  shouldPrompt: boolean;
  prompt: StepPromptBase & {
    initialSelectedIds?: string[];
    view: ManySelectionViewConfig;
  };
  renderClosed: (selectedIds: string[]) => UiSection;
};

type RunOneSelectionStepOptions = {
  interactive: boolean;
  rows: SelectionRow[];
  selectedId?: string;
  shouldPrompt: boolean;
  prompt: StepPromptBase & {
    initialSelectedId?: string;
    view: SingleSelectionViewConfig;
  };
  renderClosed: (selectedId: string) => UiSection;
};

export type SelectableRowState = SelectionRow & {
  selected: boolean;
};

type SelectionRenderModel = {
  title: string;
  rows: SelectionRow[];
  visibleRowIds: string[];
  activeVisibleIndex: number;
  selectedIds: string[];
  searchable: boolean;
  required: boolean;
  searchTerm: string;
  errorMessage?: string;
  keyHints: SelectionKeyHint[];
};

type VisibleSelectionRow = {
  id: string;
  label: string;
  description: string;
  active: boolean;
  selected: boolean;
};

const DEFAULT_REQUIRED_MESSAGE = "At least one choice must be selected";

function assertPromptAllowed(
  shouldPrompt: boolean,
  interactive: boolean,
): void {
  if (shouldPrompt && !interactive) {
    throw new Error("Selection prompt requested in non-interactive mode.");
  }
}

export function filterSelectionRowIndexes(
  rows: SelectableRowState[],
  searchTerm: string,
): number[] {
  const normalized = searchTerm.trim().toLocaleLowerCase("en-US");
  if (!normalized) {
    return rows.map((_, index) => index);
  }

  return rows.reduce<number[]>((acc, row, index) => {
    const haystack = `${row.label} ${row.description || ""}`.toLocaleLowerCase(
      "en-US",
    );
    if (haystack.includes(normalized)) {
      acc.push(index);
    }
    return acc;
  }, []);
}

export function toggleSelectionAtVisibleIndex(
  rows: SelectableRowState[],
  visibleIndexes: number[],
  visibleIndex: number,
): SelectableRowState[] {
  const targetIndex = visibleIndexes[visibleIndex];
  if (typeof targetIndex !== "number") {
    return rows;
  }

  return rows.map((row, index) =>
    index === targetIndex ? { ...row, selected: !row.selected } : row,
  );
}

export function setAllRowsSelected(
  rows: SelectableRowState[],
  selected: boolean,
): SelectableRowState[] {
  return rows.map((row) => ({ ...row, selected }));
}

export function invertRowsSelection(
  rows: SelectableRowState[],
): SelectableRowState[] {
  return rows.map((row) => ({ ...row, selected: !row.selected }));
}

export function clampActiveVisibleIndex(
  activeVisibleIndex: number,
  visibleCount: number,
): number {
  if (visibleCount <= 0) {
    return 0;
  }
  if (activeVisibleIndex < 0) {
    return 0;
  }
  if (activeVisibleIndex >= visibleCount) {
    return visibleCount - 1;
  }
  return activeVisibleIndex;
}

function selectedRowIds(rows: SelectableRowState[]): string[] {
  return rows.filter((row) => row.selected).map((row) => row.id);
}

function toVisibleRows(model: SelectionRenderModel): VisibleSelectionRow[] {
  const rows = new Map(model.rows.map((row) => [row.id, row]));
  const selected = new Set(model.selectedIds);
  return model.visibleRowIds.map((rowId, index) => {
    const row = rows.get(rowId) || { id: rowId, label: rowId, description: "" };
    return {
      id: row.id,
      label: row.label,
      description: row.description || "",
      active: index === model.activeVisibleIndex,
      selected: selected.has(row.id),
    };
  });
}

function buildRenderModel(options: {
  request: StepPromptBase;
  rows: SelectableRowState[];
  visibleIndexes: number[];
  activeVisibleIndex: number;
  searchTerm: string;
  errorMessage?: string;
  selectedIds?: string[];
}): SelectionRenderModel {
  return {
    title: options.request.title,
    rows: options.rows.map((row) => ({
      id: row.id,
      label: row.label,
      description: row.description,
    })),
    visibleRowIds: options.visibleIndexes.map(
      (index) => options.rows[index].id,
    ),
    activeVisibleIndex: options.activeVisibleIndex,
    selectedIds: options.selectedIds ?? selectedRowIds(options.rows),
    searchable: Boolean(options.request.searchable),
    required: options.request.required !== false,
    searchTerm: options.searchTerm,
    errorMessage: options.errorMessage,
    keyHints: options.request.keyHints || [],
  };
}

function normalizeSearchTerm(next: string): string {
  return next.replace(/\r\n/g, " ").replace(/[\r\n]/g, " ");
}

function appendSearchChar(current: string, text: string): string {
  return normalizeSearchTerm(`${current}${text}`);
}

export function renderManySelectionOpenPanel(
  config: ManySelectionViewConfig,
  model: SelectionRenderModel,
): string {
  const visibleRows = toVisibleRows(model);
  const hintLine = selectionHintsText(
    model.keyHints.length > 0 ? model.keyHints : config.defaultHints,
  );
  const staticLines = [config.countLine, config.instructionLine, hintLine];
  if (model.searchable && model.searchTerm.trim().length > 0) {
    staticLines.push(`Search: ${model.searchTerm}`);
  }
  if (model.errorMessage) {
    staticLines.push(`! ${model.errorMessage}`);
  }

  const layout = resolveSelectionPanelLayout({
    title: config.title,
    staticLines,
    minWidth: config.minWidth,
    labelWidth: config.labelWidth,
    descWidth: config.descWidth,
  });

  const lines: string[] = [];
  lines.push(config.countLine);
  if (config.instructionLine) {
    lines.push(config.instructionLine);
  }
  lines.push("");

  if (model.searchable && model.searchTerm !== "") {
    lines.push(`Search: ${model.searchTerm}`);
    lines.push("");
  }

  if (visibleRows.length === 0) {
    lines.push("  (no matches)");
  } else {
    for (const row of visibleRows) {
      const prefix = `  ${row.active ? "›" : " "} `;
      const marker = row.selected ? colorToken("●", "primary") : "○";
      const content = formatSelectionDisplayLine({
        prefix: "",
        label: row.label,
        description: row.description,
        labelWidth: layout.labelWidth,
        descWidth: layout.descWidth,
      });
      const renderedRow = `${prefix}${marker} ${
        row.active || row.selected ? content : dim(content)
      }`;
      lines.push(renderedRow);
    }
  }

  lines.push("");
  lines.push(`  ${hintLine}`);
  if (model.errorMessage) {
    lines.push(`  ! ${model.errorMessage}`);
  }

  return renderPanelText({
    title: config.title,
    lines,
    style: "square",
    minWidth: config.minWidth,
  });
}

export function renderSingleSelectionOpenPanel(
  config: SingleSelectionViewConfig,
  model: SelectionRenderModel,
): string {
  const visibleRows = toVisibleRows(model);
  const maxLabelWidth = visibleRows.reduce(
    (max, row) => Math.max(max, row.label.length),
    8,
  );
  const maxDescWidth = visibleRows.reduce(
    (max, row) => Math.max(max, row.description.length),
    0,
  );
  const layout = resolveSelectionPanelLayout({
    title: config.title,
    staticLines: [config.instructionLine, "↑↓ navigate   enter confirm"],
    minWidth: config.minWidth,
    labelWidth: maxLabelWidth,
    descWidth: maxDescWidth,
  });

  const lines: string[] = [config.instructionLine, ""];
  for (const row of visibleRows) {
    const renderedRow = formatSelectionDisplayLine({
      prefix: `  ${row.active ? "▸" : " "} `,
      label: row.label,
      description: row.description || undefined,
      labelWidth: layout.labelWidth,
      descWidth: layout.descWidth,
    });
    lines.push(row.active ? renderedRow : dim(renderedRow));
  }
  lines.push("");
  lines.push("  ↑↓ navigate   enter confirm");
  if (model.errorMessage) {
    lines.push(`  ! ${model.errorMessage}`);
  }

  return renderPanelText({
    title: config.title,
    lines,
    style: "square",
    minWidth: config.minWidth,
  });
}

type SelectionRendererProps = {
  content: string;
};

function SelectionRenderer({ content }: SelectionRendererProps) {
  return (
    <Box flexDirection="column">
      <Text>{content.replace(/\n$/, "")}</Text>
    </Box>
  );
}

function MultiSelectPrompt(props: {
  options: RunManySelectionStepOptions["prompt"];
  rows: SelectionRow[];
  selectedIds?: string[];
  onSubmit: (selectedIds: string[]) => void;
  onCancel: (error: Error) => void;
}) {
  const initialSelectedIds = new Set(
    props.options.initialSelectedIds || props.selectedIds || [],
  );
  const [rows, setRows] = useState<SelectableRowState[]>(
    props.rows.map((row) => ({
      ...row,
      selected: initialSelectedIds.has(row.id),
    })),
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [activeVisibleIndex, setActiveVisibleIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const visibleIndexes = useMemo(
    () =>
      filterSelectionRowIndexes(
        rows,
        props.options.searchable !== false ? searchTerm : "",
      ),
    [rows, searchTerm, props.options.searchable],
  );
  const clampedIndex = clampActiveVisibleIndex(
    activeVisibleIndex,
    visibleIndexes.length,
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      props.onCancel(new PromptCancelledError());
      return;
    }
    if (key.escape) {
      props.onCancel(new PromptCancelledError());
      return;
    }
    if (key.upArrow) {
      if (visibleIndexes.length > 0) {
        setActiveVisibleIndex(
          (clampedIndex - 1 + visibleIndexes.length) % visibleIndexes.length,
        );
      }
      setErrorMessage(undefined);
      return;
    }
    if (key.downArrow) {
      if (visibleIndexes.length > 0) {
        setActiveVisibleIndex((clampedIndex + 1) % visibleIndexes.length);
      }
      setErrorMessage(undefined);
      return;
    }
    if (input === " ") {
      setRows((prev) =>
        toggleSelectionAtVisibleIndex(prev, visibleIndexes, clampedIndex),
      );
      setErrorMessage(undefined);
      return;
    }
    if (key.ctrl && input === "a") {
      setRows((prev) => {
        const shouldSelectAll = prev.some((row) => !row.selected);
        return setAllRowsSelected(prev, shouldSelectAll);
      });
      setErrorMessage(undefined);
      return;
    }
    if (key.ctrl && input === "l") {
      setRows((prev) => invertRowsSelection(prev));
      setErrorMessage(undefined);
      return;
    }
    if (key.backspace || key.delete) {
      if (props.options.searchable !== false) {
        setSearchTerm((prev) => [...prev].slice(0, -1).join(""));
        setActiveVisibleIndex(0);
        setErrorMessage(undefined);
      }
      return;
    }
    if (key.return) {
      const selectedIds = selectedRowIds(rows);
      if ((props.options.required ?? true) && selectedIds.length === 0) {
        setErrorMessage(
          props.options.requiredMessage || DEFAULT_REQUIRED_MESSAGE,
        );
        return;
      }
      props.onSubmit(selectedIds);
      return;
    }
    if (
      props.options.searchable !== false &&
      input &&
      !key.ctrl &&
      !key.meta &&
      input !== " "
    ) {
      setSearchTerm((prev) => appendSearchChar(prev, input));
      setActiveVisibleIndex(0);
      setErrorMessage(undefined);
    }
  });

  const model = buildRenderModel({
    request: props.options,
    rows,
    visibleIndexes,
    activeVisibleIndex: clampedIndex,
    searchTerm,
    errorMessage,
  });
  const content = renderManySelectionOpenPanel(
    {
      ...props.options.view,
      countLine: `${model.rows.length} ${props.options.view.countLine}`,
    },
    model,
  );

  return <SelectionRenderer content={content} />;
}

function SingleSelectPrompt(props: {
  options: RunOneSelectionStepOptions["prompt"];
  rows: SelectionRow[];
  selectedId?: string;
  onSubmit: (selectedId: string) => void;
  onCancel: (error: Error) => void;
}) {
  const initialSelectedId = props.options.initialSelectedId || props.selectedId;
  const initialIndex = Math.max(
    0,
    props.rows.findIndex((row) => row.id === initialSelectedId),
  );
  const [activeVisibleIndex, setActiveVisibleIndex] = useState(initialIndex);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      props.onCancel(new PromptCancelledError());
      return;
    }
    if (key.escape) {
      props.onCancel(new PromptCancelledError());
      return;
    }
    if (key.upArrow) {
      setActiveVisibleIndex((prev) =>
        props.rows.length === 0
          ? 0
          : (prev - 1 + props.rows.length) % props.rows.length,
      );
      setErrorMessage(undefined);
      return;
    }
    if (key.downArrow) {
      setActiveVisibleIndex((prev) =>
        props.rows.length === 0 ? 0 : (prev + 1) % props.rows.length,
      );
      setErrorMessage(undefined);
      return;
    }
    if (key.return) {
      const selectedId = props.rows[activeVisibleIndex]?.id || "";
      if ((props.options.required ?? true) && !selectedId) {
        setErrorMessage(
          props.options.requiredMessage || DEFAULT_REQUIRED_MESSAGE,
        );
        return;
      }
      props.onSubmit(selectedId);
    }
  });

  const visibleIndexes = props.rows.map((_, index) => index);
  const selectedId = props.rows[activeVisibleIndex]?.id || "";
  const model = buildRenderModel({
    request: props.options,
    rows: props.rows.map((row) => ({
      ...row,
      selected: row.id === selectedId,
    })),
    visibleIndexes,
    activeVisibleIndex,
    searchTerm: "",
    errorMessage,
    selectedIds: selectedId ? [selectedId] : [],
  });
  const content = renderSingleSelectionOpenPanel(props.options.view, model);
  return <SelectionRenderer content={content} />;
}

export async function runManySelectionStep(
  options: RunManySelectionStepOptions,
): Promise<string[]> {
  assertPromptAllowed(options.shouldPrompt, options.interactive);

  let selectedIds = options.selectedIds || [];
  if (options.shouldPrompt) {
    selectedIds = await new Promise<string[]>((resolve, reject) => {
      setLiveScreen(() => (
        <MultiSelectPrompt
          options={options.prompt}
          rows={options.rows}
          selectedIds={selectedIds}
          onSubmit={(result) => {
            clearLiveScreen();
            resolve(result);
          }}
          onCancel={(error) => {
            clearLiveScreen();
            reject(error);
          }}
        />
      ));
    });
  }

  if (options.prompt.required !== false && selectedIds.length === 0) {
    throw new Error(options.prompt.requiredMessage || DEFAULT_REQUIRED_MESSAGE);
  }

  await renderStaticScreen([options.renderClosed(selectedIds)]);
  return selectedIds;
}

export async function runOneSelectionStep(
  options: RunOneSelectionStepOptions,
): Promise<string> {
  assertPromptAllowed(options.shouldPrompt, options.interactive);

  let selectedId = options.selectedId || "";
  if (options.shouldPrompt) {
    selectedId = await new Promise<string>((resolve, reject) => {
      setLiveScreen(() => (
        <SingleSelectPrompt
          options={options.prompt}
          rows={options.rows}
          selectedId={selectedId}
          onSubmit={(result) => {
            clearLiveScreen();
            resolve(result);
          }}
          onCancel={(error) => {
            clearLiveScreen();
            reject(error);
          }}
        />
      ));
    });
  }

  if (options.prompt.required !== false && !selectedId) {
    throw new Error(options.prompt.requiredMessage || DEFAULT_REQUIRED_MESSAGE);
  }

  await renderStaticScreen([options.renderClosed(selectedId)]);
  return selectedId;
}
========
export * from "@skillspp/cli-shared/ui/selection-step";
>>>>>>>> 23a2c2a (feat(cli): add shared ui package (#20)):apps/skillspp-cli/src/ui/selection-step.tsx
