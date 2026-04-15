import { normalizeAgentSelectionInput, type SelectionRow } from "@skillspp/core/agents";
import type { AddOptions } from "@skillspp/core/contracts/runtime-types";
import {
  runManySelectionStep,
  type ManySelectionViewConfig,
  type SelectionKeyHint,
} from "./ui/selection-step";
import type { UiSection } from "./ui/screens";

export type NamedAddSelectionItem = {
  name: string;
  description: string;
};

export type AddOptionPresence = {
  agentProvided?: boolean;
  globalProvided?: boolean;
  symlinkProvided?: boolean;
};

type BuildBaseAddOptionsInput = {
  global?: boolean;
  symlink?: boolean;
  yaml?: boolean;
  list?: boolean;
  all?: boolean;
  nonInteractive?: boolean;
  trustWellKnown?: boolean;
  agent?: string[];
  selectedNames?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: string;
  policyMode?: AddOptions["policyMode"];
  lockFormat?: string;
  experimental?: boolean;
};

export function parseAddLockFormatValue(value?: string): AddOptions["lockFormat"] {
  if (!value) {
    return undefined;
  }
  if (value !== "json" && value !== "yaml") {
    throw new Error(`Invalid --lock-format value: ${value}`);
  }
  return value;
}

export function buildBaseAddOptions(
  input: BuildBaseAddOptionsInput,
  presence: AddOptionPresence = {},
): AddOptions {
  const maxDownloadBytes = input.maxDownloadBytes ? Number(input.maxDownloadBytes) : undefined;
  if (
    typeof maxDownloadBytes === "number" &&
    (!Number.isFinite(maxDownloadBytes) || maxDownloadBytes <= 0)
  ) {
    throw new Error(`Invalid --max-download-bytes value: ${input.maxDownloadBytes}`);
  }

  const parsed: AddOptions = {
    global: Boolean(input.global),
    symlink: Boolean(input.symlink),
    yaml: Boolean(input.yaml),
    list: Boolean(input.list),
    all: Boolean(input.all),
    nonInteractive: Boolean(input.nonInteractive),
    trustWellKnown: Boolean(input.trustWellKnown),
    agent: normalizeAgentSelectionInput(input.agent),
    skill: input.selectedNames,
    allowHost: input.allowHost?.map((item) => item.toLowerCase()),
    denyHost: input.denyHost?.map((item) => item.toLowerCase()),
    maxDownloadBytes,
    policyMode: input.policyMode,
    lockFormat: parseAddLockFormatValue(input.lockFormat),
    experimental: input.experimental ?? false,
  };

  if (parsed.agent && parsed.agent.length > 0) {
    parsed.agentFlagProvided = true;
  }
  if (presence.agentProvided) {
    parsed.agentFlagProvided = true;
  }
  if (presence.globalProvided) {
    parsed.globalFlagProvided = true;
  }
  if (presence.symlinkProvided) {
    parsed.symlinkFlagProvided = true;
  }

  if (parsed.all) {
    parsed.skill = ["*"];
    parsed.agent = ["*"];
  }

  return parsed;
}

export function applyForcedAddOptionFlags(
  merged: AddOptions,
  forcedOptions: AddOptions,
): AddOptions {
  const next: AddOptions = { ...merged };
  if (Object.prototype.hasOwnProperty.call(forcedOptions, "global")) {
    next.globalFlagProvided = true;
  }
  if (Object.prototype.hasOwnProperty.call(forcedOptions, "symlink")) {
    next.symlinkFlagProvided = true;
  }
  return next;
}

export function buildNamedAddSelectionRows<T extends NamedAddSelectionItem>(
  items: readonly T[],
): SelectionRow[] {
  return items.map((item) => ({
    id: item.name,
    label: item.name,
    description: item.description,
  }));
}

export function filterNamedAddSelection<T extends NamedAddSelectionItem>(
  items: readonly T[],
  requested?: readonly string[],
): T[] {
  if (!requested || requested.length === 0) {
    return [...items];
  }

  if (requested.includes("*")) {
    return [...items];
  }

  const wanted = new Set(requested.map((item) => item.toLowerCase()));
  return items.filter((item) => wanted.has(item.name.toLowerCase()));
}

type ResolveNamedAddSelectionOptions<T extends NamedAddSelectionItem> = {
  available: readonly T[];
  interactive: boolean;
  listMode?: boolean;
  requested?: readonly string[];
  rows: readonly SelectionRow[];
  keyHints: readonly SelectionKeyHint[];
  view: ManySelectionViewConfig;
  promptTitle: string;
  requiredMessage: string;
  emptyMessage: string;
  multipleInNonInteractiveMessage: string;
  renderClosed: (selectedNames: string[]) => UiSection;
};

export async function resolveNamedAddSelection<T extends NamedAddSelectionItem>(
  options: ResolveNamedAddSelectionOptions<T>,
): Promise<T[]> {
  const {
    available,
    interactive,
    listMode,
    requested,
    rows,
    keyHints,
    view,
    promptTitle,
    requiredMessage,
    emptyMessage,
    multipleInNonInteractiveMessage,
    renderClosed,
  } = options;

  if (listMode) {
    return filterNamedAddSelection(available, requested);
  }

  const prompt = {
    title: promptTitle,
    required: true,
    requiredMessage,
    searchable: true,
    keyHints: [...keyHints],
    view,
  };

  if (requested) {
    const selected = filterNamedAddSelection(available, requested);
    if (selected.length > 0) {
      await runManySelectionStep({
        interactive,
        rows: [...rows],
        selectedIds: selected.map((item) => item.name),
        shouldPrompt: false,
        prompt,
        renderClosed,
      });
    }
    return selected;
  }

  if (available.length === 0) {
    throw new Error(emptyMessage);
  }

  if (available.length === 1) {
    await runManySelectionStep({
      interactive,
      rows: [...rows],
      selectedIds: [available[0].name],
      shouldPrompt: false,
      prompt,
      renderClosed,
    });
    return [...available];
  }

  if (!interactive) {
    throw new Error(multipleInNonInteractiveMessage);
  }

  const selectedNames = await runManySelectionStep({
    interactive,
    rows: [...rows],
    shouldPrompt: true,
    prompt,
    renderClosed,
  });
  const wanted = new Set(selectedNames);
  return available.filter((item) => wanted.has(item.name));
}
