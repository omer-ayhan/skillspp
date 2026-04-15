import { Command } from "commander";
import type { AgentType, ListOptions } from "@skillspp/core/contracts/runtime-types";
import { AGENTS, normalizeAgentSelectionInput } from "@skillspp/core/agents";
import { canUseInteractive } from "@skillspp/cli-shared/interactive";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import { runBackgroundTask } from "../runtime/background-runner";
import {
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  runManySelectionStep,
} from "@skillspp/cli-shared/ui/selection-step";
import {
  flushUiFrame,
  hideLoader,
  manySelectionClosedSection,
  panelSection,
  renderStaticScreen,
  showLoader,
} from "@skillspp/cli-shared/ui/screens";
import type { SelectionRow } from "@skillspp/core/agents";
import { shortenHomePath } from "@skillspp/cli-shared/ui/format";
import { bold, colorToken, dim } from "@skillspp/cli-shared/ui/colors";

type ListCommanderOptions = {
  agent?: string[];
  global?: boolean;
  nonInteractive?: boolean;
};

function toListOptions(options: ListCommanderOptions): ListOptions {
  return {
    global: Boolean(options.global),
    agent: normalizeAgentSelectionInput(options.agent),
    agentFlagProvided: Boolean(options.agent && options.agent.length > 0),
    nonInteractive: Boolean(options.nonInteractive),
  };
}

const AGENT_LABEL_WIDTH = 26;
const AGENT_DESC_WIDTH = 40;

const LIST_AGENTS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "", action: "type to filter" },
  { key: "space", action: "toggle" },
  { key: "enter", action: "confirm" },
];

const LIST_AGENTS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Agents",
  countLine: "installed agents detected",
  instructionLine: "Select agents to list (space to toggle)",
  labelWidth: AGENT_LABEL_WIDTH,
  descWidth: AGENT_DESC_WIDTH,
  minWidth: 74,
  defaultHints: LIST_AGENTS_KEY_HINTS,
};

function buildListAgentSelectionRows(agents: AgentType[]): SelectionRow[] {
  return agents.map((agent) => ({
    id: agent,
    label: AGENTS[agent].displayName,
    description: `~/${AGENTS[agent].globalSkillsDir.replace(/^\/+/, "")}`,
  }));
}

function renderListAgentsPanel(options: { agents: AgentType[]; selectedAgents: AgentType[] }) {
  return manySelectionClosedSection(
    LIST_AGENTS_SELECTION_VIEW,
    buildListAgentSelectionRows(options.agents),
    options.selectedAgents,
  );
}

function renderListScopePanel(options: { globalInstall: boolean; agentFilter: string }) {
  return panelSection({
    title: "List Scope",
    lines: [
      `Scope: ${options.globalInstall ? "global skills" : "project skills"}`,
      `Agent filter: ${options.agentFilter}`,
    ],
    style: "square",
    minWidth: 74,
  });
}

function renderListInventorySummary(skillCount: number) {
  return panelSection({
    title: "Inventory Summary",
    lines: [`${skillCount} unique skills found`, "Grouped by (skill name + resolved path)"],
    style: "square",
    minWidth: 74,
  });
}

function renderListInstalledSkillsPanel(
  rows: Array<{ name: string; resolvedPath: string; agents: string[] }>,
) {
  const sortedRows = [...rows].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }
    return a.resolvedPath.localeCompare(b.resolvedPath);
  });
  const uniqueSkillCount = new Set(sortedRows.map((row) => row.name)).size;
  const targetCount = sortedRows.reduce((count, row) => count + row.agents.length, 0);

  const lines: string[] = [];
  lines.push(
    `${bold("Skills:")} ${dim(uniqueSkillCount.toString())}   ${bold(
      "Entries:",
    )} ${dim(sortedRows.length.toString())}   ${bold("Targets:")} ${dim(targetCount.toString())}`,
  );
  lines.push("");
  lines.push("Targets");

  let activeSkill = "";
  for (const row of sortedRows) {
    if (row.name !== activeSkill) {
      activeSkill = row.name;
      lines.push("");
      lines.push(colorToken(`  ${row.name}`, "primary"));
    }
    const agents = [...row.agents].sort((a, b) => a.localeCompare(b));
    for (const agent of agents) {
      lines.push(`    - ${agent.padEnd(16, " ")} ${dim(shortenHomePath(row.resolvedPath))}`);
    }
  }

  return panelSection({
    title: "Installed Skills",
    lines,
    style: "square",
    minWidth: 74,
  });
}

async function executeList(options: ListOptions): Promise<void> {
  const interactive = canUseInteractive(options.nonInteractive);

  try {
    showLoader("detecting installed agents");
    await flushUiFrame();
    let agents = (
      await runBackgroundTask(
        {
          kind: "list.detectAgents",
          payload: {
            cwd: process.cwd(),
            options,
          },
        },
        {
          onProgress: (label) => {
            showLoader(label);
          },
        },
      )
    ).agents;
    hideLoader();

    if (agents.length === 0) {
      await renderStaticScreen([
        renderListScopePanel({
          globalInstall: Boolean(options.global),
          agentFilter: options.agentFlagProvided
            ? "explicit selection"
            : "auto-detect installed agents",
        }),
        panelSection({
          title: "Installed Skills",
          lines: ["No installed skills found."],
          style: "square",
          minWidth: 74,
        }),
      ]);
      return;
    }

    agents = (await runManySelectionStep({
      interactive,
      rows: buildListAgentSelectionRows(agents),
      selectedIds: agents,
      shouldPrompt: !options.agentFlagProvided && agents.length > 1 && interactive,
      prompt: {
        title: "Choose Agents",
        required: true,
        requiredMessage: "At least one agent must be selected",
        searchable: true,
        keyHints: LIST_AGENTS_KEY_HINTS,
        view: LIST_AGENTS_SELECTION_VIEW,
      },
      renderClosed: (selectedIds) =>
        renderListAgentsPanel({
          agents,
          selectedAgents: selectedIds as typeof agents,
        }),
    })) as typeof agents;

    showLoader("scanning installed skills");
    await flushUiFrame();
    const { rows } = await runBackgroundTask(
      {
        kind: "list.scanInventory",
        payload: {
          cwd: process.cwd(),
          globalInstall: Boolean(options.global),
          agents,
        },
      },
      {
        onProgress: (label) => {
          showLoader(label);
        },
      },
    );
    hideLoader();

    const agentFilter = options.agentFlagProvided
      ? options.agent?.includes("*")
        ? "all agents"
        : agents.map((agent) => AGENTS[agent].displayName).join(", ") || "none"
      : "auto-detect installed agents";

    if (rows.length === 0) {
      await renderStaticScreen([
        renderListScopePanel({
          globalInstall: Boolean(options.global),
          agentFilter,
        }),
        panelSection({
          title: "Installed Skills",
          lines: ["No installed skills found."],
          style: "square",
          minWidth: 74,
        }),
      ]);
      return;
    }

    await renderStaticScreen([
      renderListScopePanel({
        globalInstall: Boolean(options.global),
        agentFilter,
      }),
      renderListInventorySummary(rows.length),
      renderListInstalledSkillsPanel(rows),
    ]);
  } finally {
    hideLoader();
  }
}

function configureListCommand(
  command: Command,
  action: (options: ListCommanderOptions) => Promise<void>,
): Command {
  return command
    .description("List installed skills")
    .option("-a, --agent <agents...>", "Filter by agent(s)")
    .option("-g, --global", "List global installs")
    .option("--non-interactive", "Disable prompts")
    .action(action);
}

export function registerListCommand(program: Command, ctx: CliCommandContext): void {
  configureListCommand(
    program.command("list").alias("ls"),
    ctx.wrapAction("list", async (options: ListCommanderOptions) => {
      await executeList(toListOptions(options));
    }),
  );
}

export async function runList(args: string[]): Promise<void> {
  const command = configureListCommand(new Command().name("list"), async (options) => {
    await executeList(toListOptions(options));
  });
  await parseStandaloneCommand(command, args);
}
