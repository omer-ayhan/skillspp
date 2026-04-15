import path from "node:path";
import { Command } from "commander";
import type { AddOptions, AgentType, ParsedSource } from "@skillspp/core/contracts/runtime-types";
import { parseSource } from "@skillspp/core/source-parser";
import { resolveSourceLabel } from "@skillspp/core/skills";
import {
  AGENTS,
  getAgentSkillsDir,
  resolveAddAgentSelectionRows,
  type SelectionRow,
} from "@skillspp/core/agents";
import {
  applyForcedAddOptionFlags,
  buildBaseAddOptions,
  type AddOptionPresence,
  buildNamedAddSelectionRows,
  resolveNamedAddSelection,
} from "@skillspp/cli-shared/add-command";
import { sanitizeSkillName } from "@skillspp/core/runtime/installer";
import {
  completedStepsSection,
  completionSummarySection,
  failedStepsSection,
  flushUiFrame,
  installationSummarySection,
  manySelectionClosedSection,
  renderStaticScreen,
  hideLoader,
  showLoader,
  sourceSection,
  singleSelectionClosedSection,
} from "@skillspp/cli-shared/ui/screens";
import {
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  runManySelectionStep,
  runOneSelectionStep,
  type SingleSelectionViewConfig,
} from "@skillspp/cli-shared/ui/selection-step";
import { canUseInteractive } from "@skillspp/cli-shared/interactive";
import { parsePolicyMode } from "../policy-mode";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import { runBackgroundTask } from "../runtime/background-runner";
import { shortenHomePath } from "@skillspp/cli-shared/ui/format";

const SKILL_NAME_WIDTH = 32;
const SKILL_DESC_WIDTH = 40;
const AGENT_NAME_WIDTH = 26;
const AGENT_DESC_WIDTH = 40;

const ADD_SCOPE_KEY_HINTS: SelectionKeyHint[] = [
  { key: "↑↓", action: "navigate" },
  { key: "enter", action: "confirm" },
];

const ADD_SKILLS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "space", action: "toggle" },
  { key: "ctrl+a", action: "all" },
  { key: "ctrl+l", action: "invert" },
  { key: "enter", action: "confirm" },
];

const ADD_AGENTS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "type", action: "filter" },
  { key: "space", action: "toggle" },
  { key: "enter", action: "confirm" },
];

const ADD_SKILLS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Skills",
  countLine: "available",
  instructionLine: "Select skills (space to toggle)",
  labelWidth: SKILL_NAME_WIDTH,
  descWidth: SKILL_DESC_WIDTH,
  minWidth: 74,
  defaultHints: ADD_SKILLS_KEY_HINTS,
};

const ADD_AGENTS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Agents",
  countLine: "available",
  instructionLine: "Select agents (space to toggle)",
  labelWidth: AGENT_NAME_WIDTH,
  descWidth: AGENT_DESC_WIDTH,
  minWidth: 74,
  defaultHints: ADD_AGENTS_KEY_HINTS,
};

const ADD_SCOPE_SELECTION_VIEW: SingleSelectionViewConfig = {
  title: "Install Scope",
  instructionLine: "Choose installation scope",
  minWidth: 74,
};

const ADD_SCOPE_SELECTION_ROWS: SelectionRow[] = [
  {
    id: "local",
    label: "Local (project)",
    description: "Install into project skills directories",
  },
  {
    id: "global",
    label: "Global",
    description: "Install into home-directory skills directories",
  },
];

type InstallationSummaryRow = {
  skillName: string;
  agentDisplayName: string;
  destinationPath: string;
  mode: "copy" | "symlink";
};

function renderAddSkillsSection(options: {
  skills: Array<{ name: string; description: string }>;
  selectedNames: string[];
}) {
  return manySelectionClosedSection(
    ADD_SKILLS_SELECTION_VIEW,
    buildNamedAddSelectionRows(options.skills),
    options.selectedNames,
  );
}

function renderAddAgentsSection(options: { rows: SelectionRow[]; selectedAgents: AgentType[] }) {
  return manySelectionClosedSection(
    ADD_AGENTS_SELECTION_VIEW,
    options.rows,
    options.selectedAgents,
  );
}

function buildInstallationSummaryRows(options: {
  skillNames: string[];
  agents: AgentType[];
  mode: "copy" | "symlink";
  globalInstall: boolean;
  cwd: string;
}): InstallationSummaryRow[] {
  const rows: InstallationSummaryRow[] = [];
  const canonicalAgent = options.agents[0];
  if (!canonicalAgent) {
    return rows;
  }
  const canonicalBase = getAgentSkillsDir(canonicalAgent, options.globalInstall, options.cwd);

  for (const rawSkillName of options.skillNames) {
    const skillName = sanitizeSkillName(rawSkillName);
    const canonicalDir = path.join(canonicalBase, skillName);
    for (const agent of options.agents) {
      const agentDir = path.join(
        getAgentSkillsDir(agent, options.globalInstall, options.cwd),
        skillName,
      );
      const destinationPath =
        path.resolve(agentDir) === path.resolve(canonicalDir) ? canonicalDir : agentDir;
      rows.push({
        skillName,
        agentDisplayName: AGENTS[agent].displayName,
        destinationPath,
        mode: options.mode,
      });
    }
  }

  return rows.sort((a, b) => {
    const bySkill = a.skillName.localeCompare(b.skillName);
    if (bySkill !== 0) {
      return bySkill;
    }
    const byAgent = a.agentDisplayName.localeCompare(b.agentDisplayName);
    if (byAgent !== 0) {
      return byAgent;
    }
    return a.destinationPath.localeCompare(b.destinationPath);
  });
}

async function printInstallationSummary(options: {
  skillNames: string[];
  agents: AgentType[];
  mode: "copy" | "symlink";
  globalInstall: boolean;
  cwd: string;
}): Promise<void> {
  const rows = buildInstallationSummaryRows(options);
  if (rows.length === 0) {
    return;
  }
  await renderStaticScreen([
    installationSummarySection({
      mode: options.mode,
      scope: options.globalInstall ? "global" : "current project",
      skillCount: options.skillNames.length,
      agentCount: options.agents.length,
      targetCount: rows.length,
      targets: rows,
    }),
  ]);
}

async function printAddListScreen(options: {
  sourceLabel: string;
  skills: Array<{ name: string; description: string }>;
}): Promise<void> {
  await renderStaticScreen([
    sourceSection(shortenHomePath(options.sourceLabel)),
    renderAddSkillsSection({
      skills: options.skills,
      selectedNames: options.skills.map((skill) => skill.name),
    }),
  ]);
}

async function resolveAddSkills<T extends { name: string; description: string }>(
  available: T[],
  merged: AddOptions,
  interactive: boolean,
): Promise<T[]> {
  const skillRows = buildNamedAddSelectionRows(
    available.map((item) => ({
      name: item.name,
      description: item.description,
    })),
  );
  const renderClosed = (selectedNames: string[]) =>
    renderAddSkillsSection({
      skills: available.map((item) => ({
        name: item.name,
        description: item.description,
      })),
      selectedNames,
    });

  return resolveNamedAddSelection({
    available,
    interactive,
    listMode: merged.list,
    requested: merged.skill,
    rows: skillRows,
    keyHints: ADD_SKILLS_KEY_HINTS,
    view: ADD_SKILLS_SELECTION_VIEW,
    promptTitle: "Choose Skills",
    requiredMessage: "At least one skill must be selected",
    emptyMessage: "No skills available",
    multipleInNonInteractiveMessage:
      "Multiple skills found. Use --skill <name> or run in TTY without --non-interactive.",
    renderClosed,
  });
}

async function resolveAddAgents(
  merged: AddOptions,
  globalInstall: boolean,
  interactive: boolean,
): Promise<AgentType[]> {
  const rows = resolveAddAgentSelectionRows(globalInstall ? "global" : "local");
  const allForScope = rows.map((row) => row.id as AgentType);
  const allowed = new Set(allForScope);
  const renderClosed = (selectedIds: string[]) =>
    renderAddAgentsSection({
      rows,
      selectedAgents: selectedIds as AgentType[],
    });

  const parseScopedAgents = (values: string[]): AgentType[] => {
    if (values.includes("*")) {
      return allForScope;
    }

    const out: AgentType[] = [];
    for (const value of values) {
      if (!allowed.has(value as AgentType)) {
        throw new Error(
          `Unknown or unsupported agent for ${globalInstall ? "global" : "local"} scope: ${value}`,
        );
      }
      const typed = value as AgentType;
      if (!out.includes(typed)) {
        out.push(typed);
      }
    }
    return out;
  };

  if (merged.agent && merged.agent.length > 0) {
    const selectedAgents = parseScopedAgents(merged.agent);
    await runManySelectionStep({
      interactive,
      rows,
      selectedIds: selectedAgents,
      shouldPrompt: false,
      prompt: {
        title: "Choose Agents",
        required: true,
        requiredMessage: "At least one agent must be selected",
        searchable: true,
        keyHints: ADD_AGENTS_KEY_HINTS,
        view: ADD_AGENTS_SELECTION_VIEW,
      },
      renderClosed,
    });
    return selectedAgents;
  }

  if (!interactive) {
    throw new Error("Missing --agent in non-interactive mode. Provide at least one agent.");
  }

  if (allForScope.length === 1) {
    await runManySelectionStep({
      interactive,
      rows,
      selectedIds: allForScope,
      shouldPrompt: false,
      prompt: {
        title: "Choose Agents",
        required: true,
        requiredMessage: "At least one agent must be selected",
        searchable: true,
        keyHints: ADD_AGENTS_KEY_HINTS,
        view: ADD_AGENTS_SELECTION_VIEW,
      },
      renderClosed,
    });
    return allForScope;
  }

  const selected = await runManySelectionStep({
    interactive,
    rows,
    shouldPrompt: true,
    prompt: {
      title: "Choose Agents",
      required: true,
      requiredMessage: "At least one agent must be selected",
      searchable: true,
      keyHints: ADD_AGENTS_KEY_HINTS,
      view: ADD_AGENTS_SELECTION_VIEW,
    },
    renderClosed,
  });
  const wanted = new Set(selected);
  return allForScope.filter((agent) => wanted.has(agent));
}

async function resolveAddGlobalInstall(merged: AddOptions, interactive: boolean): Promise<boolean> {
  if (merged.globalFlagProvided) {
    return Boolean(merged.global);
  }

  if (!interactive) {
    return false;
  }

  const selected = await runOneSelectionStep({
    interactive,
    rows: ADD_SCOPE_SELECTION_ROWS,
    selectedId: "local",
    shouldPrompt: true,
    prompt: {
      title: "Install Scope",
      required: true,
      requiredMessage: "Choose local or global scope",
      searchable: false,
      keyHints: ADD_SCOPE_KEY_HINTS,
      view: ADD_SCOPE_SELECTION_VIEW,
      initialSelectedId: "local",
    },
    renderClosed: (selectedId) =>
      singleSelectionClosedSection(
        ADD_SCOPE_SELECTION_VIEW,
        selectedId === "global" ? "Global" : "Local (project)",
      ),
  });

  return selected === "global";
}

function resolveAddInstallMode(merged: AddOptions): "copy" | "symlink" {
  if (merged.symlinkFlagProvided) {
    return "symlink";
  }
  return "copy";
}

type AddCommanderOptions = {
  agent?: string[];
  skill?: string[];
  list?: boolean;
  symlink?: boolean;
  yaml?: boolean;
  global?: boolean;
  trustWellKnown?: boolean;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: string;
  policyMode?: string;
  lockFormat?: string;
  nonInteractive?: boolean;
  all?: boolean;
};

function toAddOptions(options: AddCommanderOptions, presence: AddOptionPresence = {}): AddOptions {
  return buildBaseAddOptions(
    {
      global: options.global,
      symlink: options.symlink,
      yaml: options.yaml,
      list: options.list,
      all: options.all,
      nonInteractive: options.nonInteractive,
      trustWellKnown: options.trustWellKnown,
      agent: options.agent,
      selectedNames: options.skill,
      allowHost: options.allowHost,
      denyHost: options.denyHost,
      maxDownloadBytes: options.maxDownloadBytes,
      policyMode: parsePolicyMode(options.policyMode),
      lockFormat: options.lockFormat,
      experimental: false,
    },
    presence,
  );
}

async function executeAdd(sourceInput: string, merged: AddOptions): Promise<void> {
  const interactive = canUseInteractive(merged.nonInteractive);
  try {
    showLoader("loading");
    let parsedSource: ParsedSource;
    let sourceLabel: string;
    try {
      parsedSource = parseSource(sourceInput);
      sourceLabel = resolveSourceLabel(parsedSource);
    } catch (error) {
      hideLoader();
      await renderStaticScreen([failedStepsSection(["failed to parse source"])]);
      throw error;
    }
    hideLoader();
    await renderStaticScreen([completedStepsSection(["source parsed"])]);
    showLoader("loading");
    await flushUiFrame();
    let discovered;
    try {
      discovered = await runBackgroundTask(
        {
          kind: "add.fetchOrDiscover",
          payload: {
            cwd: process.cwd(),
            sourceInput,
            options: merged,
          },
        },
        {
          onProgress: (label) => {
            showLoader(label);
          },
        },
      );
    } catch (error) {
      hideLoader();
      await renderStaticScreen([failedStepsSection(["failed to fetch skill index"])]);
      throw error;
    }
    hideLoader();
    await renderStaticScreen([
      completedStepsSection(["skill index fetched", "interactive session ready"]),
    ]);

    if (!merged.list) {
      await renderStaticScreen([sourceSection(shortenHomePath(sourceLabel))]);
    }

    const selected = await resolveAddSkills(discovered.skills, merged, interactive);

    if (selected.length === 0) {
      if (parsedSource.type === "well-known" || parsedSource.type === "catalog") {
        throw new Error("No matching well-known skills found in source");
      }
      throw new Error("No matching skills found in source");
    }

    if (merged.list) {
      await printAddListScreen({
        sourceLabel,
        skills: selected.map((skill) => ({
          name: skill.name,
          description: skill.description,
        })),
      });
      return;
    }

    const globalInstall = await resolveAddGlobalInstall(merged, interactive);
    const installOptions: AddOptions = {
      ...merged,
      global: globalInstall,
      globalFlagProvided: true,
    };
    const agents = await resolveAddAgents(installOptions, globalInstall, interactive);
    const mode = resolveAddInstallMode(merged);

    await printInstallationSummary({
      skillNames: selected.map((item) => item.name),
      agents,
      mode,
      globalInstall,
      cwd: process.cwd(),
    });

    showLoader("installing skills");
    await flushUiFrame();
    let installed;
    try {
      installed = await runBackgroundTask(
        {
          kind: "add.install",
          payload: {
            cwd: process.cwd(),
            sourceInput,
            options: installOptions,
            selectedSkillNames: selected.map((skill) => skill.name),
            agents,
          },
        },
        {
          onProgress: (label) => {
            showLoader(label);
          },
        },
      );
    } catch (error) {
      hideLoader();
      await renderStaticScreen([failedStepsSection(["failed to install skills"])]);
      throw error;
    }
    hideLoader();
    await renderStaticScreen([
      completedStepsSection([
        "preparing installer artifacts",
        "validating dependencies",
        "applying hooks",
        "writing lock entries",
      ]),
      completionSummarySection({
        skillCount: installed.installedSkillNames.length,
        agentCount: installed.agentCount,
      }),
    ]);
  } finally {
    hideLoader();
  }
}

function configureAddCommand(
  command: Command,
  action: (source: string, options: AddCommanderOptions, command: Command) => Promise<void>,
): Command {
  return command
    .description("Install skills from local path or git source")
    .argument("<source>", "Source path or URL")
    .option("-a, --agent <agents...>", "Target agent(s) for installation")
    .option("-s, --skill <skills...>", "Install only selected skill(s)")
    .option("-l, --list", "List skills from source without installing")
    .option("--symlink", "Install by symlinking files to all agents")
    .option("--yaml", "Create skill-installer.yaml when scaffolding missing installer config")
    .option("-g, --global", "Install globally")
    .option("--trust-well-known", "Allow hook commands for well-known source")
    .option("--allow-host <hosts...>", "Restrict well-known hosts to allowlist")
    .option("--deny-host <hosts...>", "Block specific well-known hosts")
    .option("--max-download-bytes <n>", "Set well-known download budget")
    .option("--policy-mode <mode>", "Policy mode (enforce|warn)")
    .option("--lock-format <format>", "Lockfile format output (json|yaml)")
    .option("--non-interactive", "Disable prompts and require explicit selection")
    .option("--all", "Install all skills and known agents")
    .action(action);
}

export function registerAddCommand(program: Command, ctx: CliCommandContext): void {
  configureAddCommand(
    program.command("add"),
    ctx.wrapAction(
      "add",
      async (source: string, options: AddCommanderOptions, command: Command) => {
        const presence: AddOptionPresence = {
          agentProvided: command.getOptionValueSource("agent") === "cli",
          globalProvided: command.getOptionValueSource("global") === "cli",
          symlinkProvided: command.getOptionValueSource("symlink") === "cli",
        };
        await executeAdd(source, {
          ...toAddOptions(options, presence),
          experimental: ctx.experimental,
        });
      },
    ),
  );
}

export async function runAdd(args: string[], forcedOptions: AddOptions = {}): Promise<void> {
  const command = configureAddCommand(new Command().name("add"), async (source, options, cmd) => {
    const presence: AddOptionPresence = {
      agentProvided: cmd.getOptionValueSource("agent") === "cli",
      globalProvided: cmd.getOptionValueSource("global") === "cli",
      symlinkProvided: cmd.getOptionValueSource("symlink") === "cli",
    };
    const merged: AddOptions = {
      ...toAddOptions(options, presence),
      ...forcedOptions,
    };
    await executeAdd(source, applyForcedAddOptionFlags(merged, forcedOptions));
  });
  await parseStandaloneCommand(command, args);
}
