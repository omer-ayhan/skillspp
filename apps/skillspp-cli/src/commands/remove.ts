import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import type { AgentType, RemoveOptions } from "@skillspp/core/contracts/runtime-types";
import {
  AGENTS,
  STANDARD_AGENTS,
  resolveAddAgentSelectionRows,
  resolveAgents,
  getAgentSkillsDir,
  normalizeAgentSelectionInput,
} from "@skillspp/core/agents";
import { canUseInteractive } from "@skillspp/cli-shared/interactive";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import {
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  runManySelectionStep,
  runOneSelectionStep,
  type SingleSelectionViewConfig,
} from "@skillspp/cli-shared/ui/selection-step";
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
} from "@skillspp/cli-shared/ui/screens";
import { shortenHomePath } from "@skillspp/cli-shared/ui/format";
import type { SelectionRow } from "@skillspp/core/agents";

type RemoveCommanderOptions = {
  agent?: string[];
  skill?: string[];
  all?: boolean;
  global?: boolean;
  nonInteractive?: boolean;
};

function toRemoveOptions(options: RemoveCommanderOptions): RemoveOptions {
  const parsed: RemoveOptions = {
    global: Boolean(options.global),
    agent: normalizeAgentSelectionInput(options.agent),
    agentFlagProvided: Boolean(options.agent && options.agent.length > 0),
    skill: options.skill,
    all: Boolean(options.all),
    nonInteractive: Boolean(options.nonInteractive),
  };
  return parsed;
}

const SKILL_NAME_WIDTH = 38;
const SKILL_DESC_WIDTH = 1;
const AGENT_NAME_WIDTH = 26;
const AGENT_DESC_WIDTH = 40;

const REMOVE_SKILLS_KEY_HINTS: SelectionKeyHint[] = [
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

const REMOVE_SKILLS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Skills",
  countLine: "installed",
  instructionLine: "Select skills to uninstall (space to toggle)",
  labelWidth: SKILL_NAME_WIDTH,
  descWidth: SKILL_DESC_WIDTH,
  minWidth: 74,
  defaultHints: REMOVE_SKILLS_KEY_HINTS,
};

const REMOVE_AGENTS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Agents",
  countLine: "detected for selected skills",
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

function buildRemoveSkillSelectionRows(skillNames: string[]): SelectionRow[] {
  return skillNames.map((name) => ({
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

function renderRemoveSkillsPanel(options: { skills: string[]; selectedNames: string[] }) {
  return manySelectionClosedSection(
    REMOVE_SKILLS_SELECTION_VIEW,
    buildRemoveSkillSelectionRows(options.skills),
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
  skillNames: string[];
  agentDisplayNames: string[];
}) {
  return uninstallSummarySection({
    globalInstall: options.globalInstall,
    itemNames: options.skillNames,
    itemLabel: "Skills",
    agentDisplayNames: options.agentDisplayNames,
  });
}

type InstallIndex = {
  agentsBySkill: Map<string, Set<AgentType>>;
  skillsByAgent: Map<AgentType, Set<string>>;
};

function isSkillEntry(entry: fs.Dirent): boolean {
  return entry.isDirectory() || entry.isSymbolicLink();
}

function buildInstallIndex(globalInstall: boolean, cwd: string): InstallIndex {
  const agentsBySkill = new Map<string, Set<AgentType>>();
  const skillsByAgent = new Map<AgentType, Set<string>>();
  const allAgents = Object.keys(AGENTS) as AgentType[];

  for (const agent of allAgents) {
    const dir = getAgentSkillsDir(agent, globalInstall, cwd);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }

    const names = new Set<string>();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!isSkillEntry(entry)) {
        continue;
      }
      names.add(entry.name);
      const owners = agentsBySkill.get(entry.name) ?? new Set<AgentType>();
      owners.add(agent);
      agentsBySkill.set(entry.name, owners);
    }

    if (names.size > 0) {
      skillsByAgent.set(agent, names);
    }
  }

  return { agentsBySkill, skillsByAgent };
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

function resolveCandidateAgentsForSkills(skillNames: string[], index: InstallIndex): AgentType[] {
  return orderAgentsForDisplay(
    skillNames.flatMap((name) => Array.from(index.agentsBySkill.get(name) ?? [])),
  );
}

async function executeRemove(positional: string[], options: RemoveOptions): Promise<void> {
  const interactive = canUseInteractive(options.nonInteractive);
  await renderRemoveFlowHeader();
  const cwd = process.cwd();
  const globalInstall = Boolean(options.global);
  let index: InstallIndex;
  try {
    index = buildInstallIndex(globalInstall, cwd);
  } catch (error) {
    await renderStaticScreen([failedStepsSection(["failed to index installed skills"])]);
    throw error;
  }
  if (index.agentsBySkill.size === 0) {
    throw new Error("No installed skills found to remove.");
  }

  const allSkillCandidates = uniqueSorted(index.agentsBySkill.keys());
  if (allSkillCandidates.length === 0) {
    throw new Error("No installed skills found to remove.");
  }
  const scope = globalInstall ? "global" : "local";
  const scopedAgentRows = resolveAddAgentSelectionRows(scope);
  const scopedAgentRowsById = new Map<AgentType, SelectionRow>(
    scopedAgentRows.map((row) => [row.id as AgentType, row]),
  );
  const scopeAllowedAgents = new Set<AgentType>(
    scope === "global"
      ? (Object.keys(AGENTS) as AgentType[])
      : (Object.keys(STANDARD_AGENTS) as AgentType[]),
  );

  const explicitSkills = [...(options.skill || []), ...positional];
  let finalSkills = uniqueSorted(explicitSkills);
  let requiresInteractiveSkillSelection = false;
  if (!options.all && finalSkills.length === 0) {
    if (allSkillCandidates.length === 1) {
      finalSkills = [allSkillCandidates[0]];
    } else if (interactive) {
      requiresInteractiveSkillSelection = true;
    } else {
      throw new Error(
        "Multiple installed skills found. Use --skill <name>... or run in TTY without --non-interactive.",
      );
    }
  }

  let agents: AgentType[] = [];
  let candidateAgents: AgentType[] = [];
  try {
    if (options.agent && options.agent.length > 0) {
      if (options.agent.includes("*")) {
        candidateAgents = orderAgentsForDisplay(Array.from(index.skillsByAgent.keys()));
        agents = candidateAgents;
      } else {
        const resolved = resolveAgents(options.agent);
        const outOfScopeAgents = resolved.filter((agent) => !scopeAllowedAgents.has(agent));
        if (outOfScopeAgents.length > 0) {
          throw new Error(
            `Agent(s) not available in ${scope} scope: ${outOfScopeAgents.join(", ")}`,
          );
        }
        candidateAgents = resolved;
        agents = candidateAgents;
      }
    } else {
      candidateAgents = options.all
        ? orderAgentsForDisplay(Array.from(index.skillsByAgent.keys()))
        : finalSkills.length > 0
          ? resolveCandidateAgentsForSkills(finalSkills, index)
          : [];

      if (candidateAgents.length === 0 && !requiresInteractiveSkillSelection) {
        throw new Error("No installed skills found to remove.");
      }
      if (candidateAgents.length === 1) {
        agents = candidateAgents;
      } else if (candidateAgents.length > 1 && !interactive) {
        throw new Error(
          "Multiple agents found. Use --agent <name>... or run in TTY without --non-interactive.",
        );
      }
    }
    candidateAgents = candidateAgents.filter((agent) => scopeAllowedAgents.has(agent));
    agents = agents.filter((agent) => scopeAllowedAgents.has(agent));
    candidateAgents = orderAgentsForDisplay(candidateAgents);
    agents = orderAgentsForDisplay(agents);
  } catch (error) {
    await renderStaticScreen([failedStepsSection(["failed to resolve target candidates"])]);
    throw error;
  }

  await renderStaticScreen([
    completedStepsSection([
      "installed skills indexed",
      "target candidates resolved",
      "interactive session ready",
    ]),
    sourceSection(shortenHomePath(cwd)),
  ]);

  let renderedSkillsPanel = false;
  if (!options.all) {
    finalSkills = await runManySelectionStep({
      interactive,
      rows: buildRemoveSkillSelectionRows(allSkillCandidates),
      selectedIds: finalSkills,
      shouldPrompt: requiresInteractiveSkillSelection,
      prompt: {
        title: "Choose Skills",
        required: true,
        requiredMessage: "At least one skill must be selected",
        searchable: true,
        keyHints: REMOVE_SKILLS_KEY_HINTS,
        view: REMOVE_SKILLS_SELECTION_VIEW,
      },
      renderClosed: (selectedIds) =>
        renderRemoveSkillsPanel({
          skills: allSkillCandidates,
          selectedNames: selectedIds,
        }),
    });
    renderedSkillsPanel = true;
  }

  if (!options.agent || options.agent.length === 0) {
    if (!options.all) {
      candidateAgents = resolveCandidateAgentsForSkills(finalSkills, index);
      candidateAgents = candidateAgents.filter((agent) => scopeAllowedAgents.has(agent));
      candidateAgents = orderAgentsForDisplay(candidateAgents);
    }

    if (candidateAgents.length === 0) {
      throw new Error("No installed skills found to remove.");
    }

    if (agents.length === 0) {
      if (candidateAgents.length === 1) {
        agents = candidateAgents;
      }
    }
  }

  const shouldPromptAgents = interactive && (!options.agent || options.agent.length === 0);
  const visibleCandidateAgents = candidateAgents.filter((agent) => scopeAllowedAgents.has(agent));
  const selectedAgentIds = await runManySelectionStep({
    interactive,
    rows: buildRemoveAgentSelectionRows(visibleCandidateAgents, scopedAgentRowsById),
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
  agents = visibleCandidateAgents.filter((agent) => selectedAgentSet.has(agent));

  if (options.all) {
    const all = new Set<string>();
    for (const agent of agents) {
      for (const name of index.skillsByAgent.get(agent) ?? []) {
        all.add(name);
      }
    }
    finalSkills = uniqueSorted(all);
  }

  if (!renderedSkillsPanel) {
    finalSkills = await runManySelectionStep({
      interactive,
      rows: buildRemoveSkillSelectionRows(allSkillCandidates),
      selectedIds: finalSkills,
      shouldPrompt: false,
      prompt: {
        title: "Choose Skills",
        required: true,
        requiredMessage: "At least one skill must be selected",
        searchable: true,
        keyHints: REMOVE_SKILLS_KEY_HINTS,
        view: REMOVE_SKILLS_SELECTION_VIEW,
      },
      renderClosed: (selectedIds) =>
        renderRemoveSkillsPanel({
          skills: allSkillCandidates,
          selectedNames: selectedIds,
        }),
    });
  }

  if (finalSkills.length === 0) {
    throw new Error("No installed skills found to remove.");
  }

  const targetSkillNames = new Set<string>();
  const requestedSkills = new Set(finalSkills);
  for (const agent of agents) {
    for (const name of index.skillsByAgent.get(agent) ?? []) {
      if (requestedSkills.has(name)) {
        targetSkillNames.add(name);
      }
    }
  }
  if (targetSkillNames.size === 0) {
    throw new Error("No installed skills found to remove.");
  }

  const targetSkillList = uniqueSorted(targetSkillNames);

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
        instructionLine: `Are you sure you want to uninstall ${targetSkillList.length} skill(s)?`,
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
      skillNames: targetSkillList,
      agentDisplayNames: agents.map((agent) => AGENTS[agent].displayName),
    }),
  ]);

  const selectedSkillSet = targetSkillNames;
  let removedCount = 0;
  const completedRemovalSteps: string[] = [];
  let failedLabel = "failed to remove selected skills";

  try {
    for (const agent of agents) {
      const dir = getAgentSkillsDir(agent, globalInstall, cwd);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        continue;
      }

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }

        if (!selectedSkillSet.has(entry.name)) {
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
  action: (skills: string[], options: RemoveCommanderOptions) => Promise<void>,
): Command {
  return command
    .description("Remove installed skills")
    .argument("[skills...]", "Skill names")
    .option("-a, --agent <agents...>", "Target agent(s)")
    .option("-s, --skill <skills...>", "Explicit skill names")
    .option("--all", "Remove all skills from selected agents")
    .option("-g, --global", "Remove global installs")
    .option("--non-interactive", "Disable prompts")
    .action(action);
}

export function registerRemoveCommand(program: Command, ctx: CliCommandContext): void {
  configureRemoveCommand(
    program.command("remove").alias("rm"),
    ctx.wrapAction("remove", async (skills: string[], options: RemoveCommanderOptions) => {
      await executeRemove(skills, toRemoveOptions(options));
    }),
  );
}

export async function runRemove(args: string[]): Promise<void> {
  const command = configureRemoveCommand(new Command().name("remove"), async (skills, options) => {
    await executeRemove(skills, toRemoveOptions(options));
  });
  await parseStandaloneCommand(command, args);
}
