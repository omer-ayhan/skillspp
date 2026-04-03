import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import type {
  AgentType,
  RemoveOptions,
} from "@skillspp/core/contracts/runtime-types";
import {
  AGENTS,
  getAgentPluginsDir,
  normalizeAgentSelectionInput,
  resolveAddPluginAgentSelectionRows,
  resolveAgents,
  type SelectionRow,
} from "@skillspp/core/agents";
import { canUseInteractive } from "../interactive";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "../command-builder";
import {
  completedStepsSection,
  failedStepsSection,
  linesSection,
  manySelectionClosedSection,
  removeCompletionSummarySection,
  renderStaticScreen,
  singleSelectionClosedSection,
  sourceSection,
  uninstallSummarySection,
} from "../ui/screens";
import {
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  runManySelectionStep,
  runOneSelectionStep,
  type SingleSelectionViewConfig,
} from "../ui/selection-step";
import { shortenHomePath } from "../ui/format";

type RemoveCommanderOptions = {
  agent?: string[];
  plugin?: string[];
  global?: boolean;
  nonInteractive?: boolean;
};

function toRemoveOptions(options: RemoveCommanderOptions): RemoveOptions {
  return {
    global: Boolean(options.global),
    agent: normalizeAgentSelectionInput(options.agent),
    agentFlagProvided: Boolean(options.agent && options.agent.length > 0),
    skill: options.plugin,
    nonInteractive: Boolean(options.nonInteractive),
  };
}

const PLUGIN_NAME_WIDTH = 38;
const PLUGIN_DESC_WIDTH = 1;
const AGENT_NAME_WIDTH = 26;
const AGENT_DESC_WIDTH = 40;

const REMOVE_PLUGINS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "", action: "type to search" },
  { key: "space", action: "toggle" },
  { key: "ctrl+a", action: "all" },
  { key: "ctrl+l", action: "invert" },
  { key: "enter", action: "confirm" },
];

const REMOVE_AGENTS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "", action: "type to search" },
  { key: "space", action: "toggle" },
  { key: "ctrl+a", action: "all" },
  { key: "ctrl+l", action: "invert" },
  { key: "enter", action: "confirm" },
];

const REMOVE_CONFIRM_KEY_HINTS: SelectionKeyHint[] = [
  { key: "↑↓", action: "navigate" },
  { key: "enter", action: "confirm" },
];

const REMOVE_PLUGINS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Plugins",
  countLine: "installed",
  instructionLine: "Select plugins to uninstall (space to toggle)",
  labelWidth: PLUGIN_NAME_WIDTH,
  descWidth: PLUGIN_DESC_WIDTH,
  minWidth: 74,
  defaultHints: REMOVE_PLUGINS_KEY_HINTS,
};

const REMOVE_AGENTS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Agents",
  countLine: "detected for selected plugins",
  instructionLine: "Select agents to remove from (space to toggle)",
  labelWidth: AGENT_NAME_WIDTH,
  descWidth: AGENT_DESC_WIDTH,
  minWidth: 74,
  defaultHints: REMOVE_AGENTS_KEY_HINTS,
};

const REMOVE_CONFIRM_SELECTION_VIEW: SingleSelectionViewConfig = {
  title: "Confirm Uninstall",
  instructionLine: "Confirm uninstall operation",
  minWidth: 74,
};

async function renderRemoveFlowHeader(): Promise<void> {}

function buildRemovePluginSelectionRows(pluginNames: string[]): SelectionRow[] {
  return pluginNames.map((name) => ({
    id: name,
    label: name,
  }));
}

function buildRemoveAgentSelectionRows(
  agents: AgentType[],
  scopedAgentRowsById: Map<AgentType, SelectionRow>,
): SelectionRow[] {
  return agents.map((agent) => ({
    id: agent,
    label: scopedAgentRowsById.get(agent)?.label ?? AGENTS[agent].displayName,
    description: scopedAgentRowsById.get(agent)?.description,
  }));
}

function buildRemoveConfirmSelectionRows(): SelectionRow[] {
  return [
    { id: "yes", label: "Yes" },
    { id: "no", label: "No" },
  ];
}

function renderRemovePluginsPanel(options: {
  plugins: string[];
  selectedNames: string[];
}) {
  return manySelectionClosedSection(
    REMOVE_PLUGINS_SELECTION_VIEW,
    buildRemovePluginSelectionRows(options.plugins),
    options.selectedNames,
  );
}

function renderRemoveAgentsPanel(options: {
  agents: AgentType[];
  selectedAgents: AgentType[];
  scopedAgentRowsById: Map<AgentType, SelectionRow>;
}) {
  return manySelectionClosedSection(
    REMOVE_AGENTS_SELECTION_VIEW,
    buildRemoveAgentSelectionRows(options.agents, options.scopedAgentRowsById),
    options.selectedAgents,
  );
}

function renderRemoveConfirmPanel(options: { selectedId: string }) {
  return singleSelectionClosedSection(
    REMOVE_CONFIRM_SELECTION_VIEW,
    options.selectedId === "no" ? "No" : "Yes",
  );
}

function renderRemoveUninstallSummaryBox(options: {
  globalInstall: boolean;
  pluginNames: string[];
  agentDisplayNames: string[];
}) {
  return uninstallSummarySection({
    globalInstall: options.globalInstall,
    itemNames: options.pluginNames,
    itemLabel: "Plugins",
    agentDisplayNames: options.agentDisplayNames,
  });
}

type InstallIndex = {
  agentsByPlugin: Map<string, Set<AgentType>>;
  pluginsByAgent: Map<AgentType, Set<string>>;
};

function isPluginEntry(entry: fs.Dirent): boolean {
  return entry.isDirectory() || entry.isSymbolicLink();
}

function buildInstallIndex(globalInstall: boolean, cwd: string): InstallIndex {
  const agentsByPlugin = new Map<string, Set<AgentType>>();
  const pluginsByAgent = new Map<AgentType, Set<string>>();
  const allAgents = Object.keys(AGENTS) as AgentType[];

  for (const agent of allAgents) {
    const dir = getAgentPluginsDir(agent, globalInstall, cwd);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }

    const names = new Set<string>();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!isPluginEntry(entry)) {
        continue;
      }
      names.add(entry.name);
      const owners = agentsByPlugin.get(entry.name) ?? new Set<AgentType>();
      owners.add(agent);
      agentsByPlugin.set(entry.name, owners);
    }

    if (names.size > 0) {
      pluginsByAgent.set(agent, names);
    }
  }

  return { agentsByPlugin, pluginsByAgent };
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function orderAgentsForDisplay(agents: AgentType[]): AgentType[] {
  return Array.from(new Set(agents)).sort((a, b) => {
    if (a === "universal" && b !== "universal") {
      return -1;
    }
    if (b === "universal" && a !== "universal") {
      return 1;
    }
    return a.localeCompare(b);
  });
}

function resolveCandidateAgentsForPlugins(
  pluginNames: string[],
  index: InstallIndex,
): AgentType[] {
  return orderAgentsForDisplay(
    pluginNames.flatMap((name) =>
      Array.from(index.agentsByPlugin.get(name) ?? []),
    ),
  );
}

async function executeRemove(
  positional: string[],
  options: RemoveOptions,
): Promise<void> {
  const interactive = canUseInteractive(options.nonInteractive);
  await renderRemoveFlowHeader();
  const cwd = process.cwd();
  const globalInstall = Boolean(options.global);
  let index: InstallIndex;

  try {
    index = buildInstallIndex(globalInstall, cwd);
  } catch (error) {
    await renderStaticScreen([
      failedStepsSection(["failed to index installed plugins"]),
    ]);
    throw error;
  }

  if (index.agentsByPlugin.size === 0) {
    throw new Error("No installed plugins found to remove.");
  }

  const allPluginCandidates = uniqueSorted(index.agentsByPlugin.keys());
  if (allPluginCandidates.length === 0) {
    throw new Error("No installed plugins found to remove.");
  }

  const scope = globalInstall ? "global" : "local";
  const scopedAgentRows = resolveAddPluginAgentSelectionRows(scope);
  const scopedAgentRowsById = new Map<AgentType, SelectionRow>(
    scopedAgentRows.map((row) => [row.id as AgentType, row]),
  );
  const scopeAllowedAgents = new Set<AgentType>(
    scopedAgentRows.map((row) => row.id as AgentType),
  );

  const explicitPlugins = [...(options.skill || []), ...positional];
  let finalPlugins = uniqueSorted(explicitPlugins);
  let requiresInteractivePluginSelection = false;
  if (finalPlugins.length === 0) {
    if (allPluginCandidates.length === 1) {
      finalPlugins = [allPluginCandidates[0]];
    } else if (interactive) {
      requiresInteractivePluginSelection = true;
    } else {
      throw new Error(
        "Multiple installed plugins found. Use --plugin <name>... or run in TTY without --non-interactive.",
      );
    }
  }

  let agents: AgentType[] = [];
  let candidateAgents: AgentType[] = [];
  try {
    if (options.agent && options.agent.length > 0) {
      if (options.agent.includes("*")) {
        candidateAgents = orderAgentsForDisplay(
          Array.from(index.pluginsByAgent.keys()),
        );
        agents = candidateAgents;
      } else {
        candidateAgents = resolveAgents(options.agent).filter((agent) =>
          scopeAllowedAgents.has(agent),
        );
        agents = candidateAgents;
      }
    } else {
      candidateAgents =
        finalPlugins.length > 0
          ? resolveCandidateAgentsForPlugins(finalPlugins, index)
          : [];

      if (candidateAgents.length === 0 && !requiresInteractivePluginSelection) {
        throw new Error("No installed plugins found to remove.");
      }
      if (candidateAgents.length === 1) {
        agents = candidateAgents;
      } else if (candidateAgents.length > 1 && !interactive) {
        throw new Error(
          "Multiple agents found. Use --agent <name>... or run in TTY without --non-interactive.",
        );
      }
    }

    candidateAgents = candidateAgents.filter((agent) =>
      scopeAllowedAgents.has(agent),
    );
    agents = agents.filter((agent) => scopeAllowedAgents.has(agent));
    candidateAgents = orderAgentsForDisplay(candidateAgents);
    agents = orderAgentsForDisplay(agents);
  } catch (error) {
    await renderStaticScreen([
      failedStepsSection(["failed to resolve target candidates"]),
    ]);
    throw error;
  }

  await renderStaticScreen([
    completedStepsSection([
      "installed plugins indexed",
      "target candidates resolved",
      "interactive session ready",
    ]),
    sourceSection(shortenHomePath(cwd), "Plugins source"),
  ]);

  let renderedPluginsPanel = false;
  finalPlugins = await runManySelectionStep({
    interactive,
    rows: buildRemovePluginSelectionRows(allPluginCandidates),
    selectedIds: finalPlugins,
    shouldPrompt: requiresInteractivePluginSelection,
    prompt: {
      title: "Choose Plugins",
      required: true,
      requiredMessage: "At least one plugin must be selected",
      searchable: true,
      keyHints: REMOVE_PLUGINS_KEY_HINTS,
      view: REMOVE_PLUGINS_SELECTION_VIEW,
    },
    renderClosed: (selectedIds) =>
      renderRemovePluginsPanel({
        plugins: allPluginCandidates,
        selectedNames: selectedIds,
      }),
  });
  renderedPluginsPanel = true;

  if (!options.agent || options.agent.length === 0) {
    candidateAgents = resolveCandidateAgentsForPlugins(finalPlugins, index);
    candidateAgents = candidateAgents.filter((agent) =>
      scopeAllowedAgents.has(agent),
    );
    candidateAgents = orderAgentsForDisplay(candidateAgents);

    if (candidateAgents.length === 0) {
      throw new Error("No installed plugins found to remove.");
    }

    if (agents.length === 0 && candidateAgents.length === 1) {
      agents = candidateAgents;
    }
  }

  const shouldPromptAgents =
    interactive && (!options.agent || options.agent.length === 0);
  const visibleCandidateAgents = candidateAgents.filter((agent) =>
    scopeAllowedAgents.has(agent),
  );
  const selectedAgentIds = await runManySelectionStep({
    interactive,
    rows: buildRemoveAgentSelectionRows(
      visibleCandidateAgents,
      scopedAgentRowsById,
    ),
    selectedIds: agents,
    shouldPrompt: shouldPromptAgents,
    prompt: {
      title: "Choose Agents",
      required: true,
      requiredMessage: "At least one agent must be selected",
      searchable: true,
      keyHints: REMOVE_AGENTS_KEY_HINTS,
      view: REMOVE_AGENTS_SELECTION_VIEW,
    },
    renderClosed: (selectedIds) =>
      renderRemoveAgentsPanel({
        agents: visibleCandidateAgents,
        selectedAgents: selectedIds as AgentType[],
        scopedAgentRowsById,
      }),
  });
  const selectedAgentSet = new Set(selectedAgentIds);
  agents = visibleCandidateAgents.filter((agent) =>
    selectedAgentSet.has(agent),
  );

  if (!renderedPluginsPanel) {
    finalPlugins = await runManySelectionStep({
      interactive,
      rows: buildRemovePluginSelectionRows(allPluginCandidates),
      selectedIds: finalPlugins,
      shouldPrompt: false,
      prompt: {
        title: "Choose Plugins",
        required: true,
        requiredMessage: "At least one plugin must be selected",
        searchable: true,
        keyHints: REMOVE_PLUGINS_KEY_HINTS,
        view: REMOVE_PLUGINS_SELECTION_VIEW,
      },
      renderClosed: (selectedIds) =>
        renderRemovePluginsPanel({
          plugins: allPluginCandidates,
          selectedNames: selectedIds,
        }),
    });
  }

  if (finalPlugins.length === 0) {
    throw new Error("No installed plugins found to remove.");
  }

  const targetPluginNames = new Set<string>();
  const requestedPlugins = new Set(finalPlugins);
  for (const agent of agents) {
    for (const name of index.pluginsByAgent.get(agent) ?? []) {
      if (requestedPlugins.has(name)) {
        targetPluginNames.add(name);
      }
    }
  }
  if (targetPluginNames.size === 0) {
    throw new Error("No installed plugins found to remove.");
  }

  const targetPluginList = uniqueSorted(targetPluginNames);

  const confirmSelection = await runOneSelectionStep({
    interactive,
    rows: buildRemoveConfirmSelectionRows(),
    selectedId: "yes",
    shouldPrompt: interactive,
    prompt: {
      title: "Confirm Uninstall",
      required: true,
      requiredMessage: "Select Yes or No",
      searchable: false,
      keyHints: REMOVE_CONFIRM_KEY_HINTS,
      view: {
        ...REMOVE_CONFIRM_SELECTION_VIEW,
        instructionLine: `Are you sure you want to uninstall ${targetPluginList.length} plugin(s)?`,
      },
      initialSelectedId: "yes",
    },
    renderClosed: (selectedId) =>
      renderRemoveConfirmPanel({
        selectedId,
      }),
  });
  const confirmed = confirmSelection === "yes";

  if (!confirmed) {
    await renderStaticScreen([linesSection(["Uninstall cancelled."])]);
    return;
  }

  await renderStaticScreen([
    renderRemoveUninstallSummaryBox({
      globalInstall,
      pluginNames: targetPluginList,
      agentDisplayNames: agents.map((agent) => AGENTS[agent].displayName),
    }),
  ]);

  let removedCount = 0;
  const completedRemovalSteps: string[] = [];
  let failedLabel = "failed to remove selected plugins";

  try {
    for (const agent of agents) {
      const dir = getAgentPluginsDir(agent, globalInstall, cwd);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        continue;
      }

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }

        if (!targetPluginNames.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        failedLabel = `failed to remove ${entry.name} from ${agent}`;
        fs.rmSync(fullPath, { recursive: true, force: true });
        removedCount += 1;
        completedRemovalSteps.push(`removed ${entry.name} from ${agent}`);
      }
    }
  } catch (error) {
    await renderStaticScreen([failedStepsSection([failedLabel])]);
    throw error;
  }

  const completionSections = [];
  if (completedRemovalSteps.length > 0) {
    completionSections.push(completedStepsSection(completedRemovalSteps));
  }
  completionSections.push(removeCompletionSummarySection(removedCount));
  await renderStaticScreen(completionSections);
}

function configureRemoveCommand(
  command: Command,
  action: (plugins: string[], options: RemoveCommanderOptions) => Promise<void>,
): Command {
  return command
    .description("Remove installed plugins")
    .argument("[plugins...]", "Plugin names")
    .option("-a, --agent <agents...>", "Target agent(s)")
    .option("-p, --plugin <plugins...>", "Explicit plugin names")
    .option("-g, --global", "Remove global installs")
    .option("--non-interactive", "Disable prompts")
    .action(action);
}

export function registerRemoveCommand(
  program: Command,
  ctx: CliCommandContext,
): void {
  configureRemoveCommand(
    program.command("remove").alias("rm"),
    ctx.wrapAction(
      "remove",
      async (plugins: string[], options: RemoveCommanderOptions) => {
        await executeRemove(plugins, toRemoveOptions(options));
      },
    ),
  );
}

export async function runRemove(args: string[]): Promise<void> {
  const command = configureRemoveCommand(
    new Command().name("remove"),
    async (plugins, options) => {
      await executeRemove(plugins, toRemoveOptions(options));
    },
  );
  await parseStandaloneCommand(command, args);
}
