import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  AGENTS,
  ALL_AGENTS,
  normalizeAgentSelectionInput,
  resolveAgents,
} from "@skillspp/core/agents";
import {
  askText,
  canUseInteractive,
} from "@skillspp/cli-shared/interactive";
import { buildAgentConfigScaffoldPlan } from "@skillspp/core/runtime/agent-config-mapper";
import type { InstallerScaffoldFormat } from "@skillspp/core/runtime/installer-scaffold";
import { scaffoldInstallerConfigFile } from "@skillspp/core/runtime/installer-scaffold";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import type { AgentType } from "@skillspp/core/contracts/runtime-types";
import {
  completedStepsSection,
  failedStepsSection,
  linesSection,
  manySelectionClosedSection,
  panelSection,
  renderStaticScreen,
  singleSelectionClosedSection,
} from "@skillspp/cli-shared/ui/screens";
import { shortenHomePath } from "@skillspp/cli-shared/ui/format";
import {
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  runManySelectionStep,
  runOneSelectionStep,
  type SingleSelectionViewConfig,
} from "@skillspp/cli-shared/ui/selection-step";
import type { SelectionRow } from "@skillspp/core/agents";

type InitTemplate = "general" | "framework" | "automation";

type InitAnswers = {
  installerFormat: InstallerScaffoldFormat;
  name: string;
  description: string;
  template: InitTemplate;
};

type InitQuestion<T extends keyof InitAnswers> = {
  id: T;
  when: (interactive: boolean) => boolean;
  ask: (defaults: InitAnswers) => Promise<InitAnswers[T]>;
  normalize: (value: InitAnswers[T], defaults: InitAnswers) => InitAnswers[T];
};

type InitOptions = {
  nonInteractive?: boolean;
  nameArg?: string;
  yaml?: boolean;
  agent?: string[];
};

type InitExecutionHooks = {
  emitCommandEvent?: (event: {
    eventType: string;
    reason: string;
    status: "start" | "ok" | "error" | "warn";
    error?: string;
    metadata?: Record<string, unknown>;
  }) => void;
};

const INIT_ONE_KEY_HINTS: SelectionKeyHint[] = [
  { key: "↑↓", action: "navigate" },
  { key: "enter", action: "confirm" },
];

const INIT_AGENTS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "", action: "type to filter" },
  { key: "space", action: "toggle" },
  { key: "enter", action: "confirm" },
];

const INIT_AGENTS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Agents",
  countLine: "available agents",
  instructionLine: "Select agents (space to toggle)",
  labelWidth: 30,
  descWidth: 40,
  minWidth: 74,
  defaultHints: INIT_AGENTS_KEY_HINTS,
};

const INIT_ONE_SELECTION_VIEW: SingleSelectionViewConfig = {
  title: "Select Option",
  instructionLine: "Choose one option",
  minWidth: 74,
};

function buildInitAgentRows(agents: AgentType[]): SelectionRow[] {
  return agents.map((agent) => ({
    id: agent,
    label: AGENTS[agent].displayName,
    description: `~/${AGENTS[agent].globalSkillsDir.replace(/^\/+/, "")}`,
  }));
}

function buildInitChoiceRows(
  choices: Array<{ id: string; label: string; description?: string }>,
): SelectionRow[] {
  return choices.map((choice) => ({
    id: choice.id,
    label: choice.label,
    description: choice.description,
  }));
}

function renderInitAgentsClosedPanel(selectedIds: string[]) {
  return manySelectionClosedSection(
    INIT_AGENTS_SELECTION_VIEW,
    buildInitAgentRows(ALL_AGENTS),
    selectedIds,
  );
}

function defaultAnswers(cwd: string, options: InitOptions): InitAnswers {
  const nameArg = options.nameArg;
  const name = (nameArg || path.basename(cwd)).trim();
  return {
    installerFormat: options.yaml ? "yaml" : "json",
    name,
    description: "A brief description of what this skill does",
    template: "general",
  };
}

async function chooseInitOne<T extends string>(options: {
  title: string;
  instruction: string;
  choices: Array<{ value: T; label: string; description?: string }>;
  defaultValue?: T;
}): Promise<T> {
  const rows = buildInitChoiceRows(
    options.choices.map((choice) => ({
      id: choice.value,
      label: choice.label,
      description: choice.description,
    })),
  );

  const labelByValue = new Map(
    options.choices.map((choice) => [choice.value, choice.label]),
  );
  const selected = await runOneSelectionStep({
    interactive: true,
    rows,
    selectedId: options.defaultValue,
    shouldPrompt: true,
    prompt: {
      title: options.title,
      required: true,
      searchable: false,
      keyHints: INIT_ONE_KEY_HINTS,
      initialSelectedId: options.defaultValue,
      view: {
        ...INIT_ONE_SELECTION_VIEW,
        title: options.title,
        instructionLine: options.instruction,
      },
    },
    renderClosed: (selectedId) =>
      singleSelectionClosedSection(
        {
          ...INIT_ONE_SELECTION_VIEW,
          title: options.title,
        },
        labelByValue.get(selectedId as T) || selectedId,
      ),
  });

  return selected as T;
}

const initQuestions: Array<InitQuestion<keyof InitAnswers>> = [
  {
    id: "installerFormat",
    when: (interactive) => interactive,
    ask: (defaults) =>
      chooseInitOne<InstallerScaffoldFormat>({
        title: "Skill Installer Format",
        instruction: "Choose skill-installer config format",
        choices: [
          {
            label: "JSON (skill-installer.json)",
            value: "json",
          },
          {
            label: "YAML (skill-installer.yaml)",
            value: "yaml",
          },
        ],
        defaultValue: defaults.installerFormat,
      }),
    normalize: (value) => (value || "json") as InstallerScaffoldFormat,
  },
  {
    id: "name",
    when: (interactive) => interactive,
    ask: (defaults) => askText("Skill name", defaults.name),
    normalize: (value) => String(value || "").trim(),
  },
  {
    id: "description",
    when: (interactive) => interactive,
    ask: (defaults) => askText("Short description", defaults.description),
    normalize: (value, defaults) => {
      const out = String(value || "").trim();
      return out || defaults.description;
    },
  },
  {
    id: "template",
    when: (interactive) => interactive,
    ask: (defaults) =>
      chooseInitOne<InitTemplate>({
        title: "Template",
        instruction: "Select starter template",
        choices: [
          { label: "General", value: "general" },
          { label: "Framework", value: "framework" },
          { label: "Automation", value: "automation" },
        ],
        defaultValue: defaults.template,
      }),
    normalize: (value) => (value || "general") as InitTemplate,
  },
];

function setAnswer<K extends keyof InitAnswers>(
  answers: InitAnswers,
  key: K,
  value: InitAnswers[K],
): void {
  answers[key] = value;
}

async function collectAnswers(options: InitOptions): Promise<InitAnswers> {
  const cwd = process.cwd();
  const defaults = defaultAnswers(cwd, options);
  const interactive = canUseInteractive(options.nonInteractive);

  const answers: InitAnswers = { ...defaults };
  for (const question of initQuestions) {
    if (!question.when(interactive)) {
      setAnswer(
        answers,
        question.id,
        question.normalize(answers[question.id], defaults),
      );
      continue;
    }

    const value = await question.ask(defaults);
    setAnswer(answers, question.id, question.normalize(value, defaults));
  }

  if (!answers.name) {
    throw new Error("Skill name cannot be empty");
  }

  return answers;
}

async function resolveInitAgents(options: InitOptions): Promise<AgentType[]> {
  const interactive = canUseInteractive(options.nonInteractive);
  const rows = buildInitAgentRows(ALL_AGENTS);
  const normalized = normalizeAgentSelectionInput(options.agent);
  if (normalized && normalized.length > 0) {
    const selected = normalized.includes("*")
      ? ALL_AGENTS
      : resolveAgents(normalized);
    const selectedIds = await runManySelectionStep({
      interactive,
      rows,
      selectedIds: selected,
      shouldPrompt: false,
      prompt: {
        title: "Choose Agents",
        required: true,
        searchable: true,
        keyHints: INIT_AGENTS_KEY_HINTS,
        view: INIT_AGENTS_SELECTION_VIEW,
      },
      renderClosed: (selectedRowIds) =>
        renderInitAgentsClosedPanel(selectedRowIds),
    });
    return selectedIds as AgentType[];
  }

  if (!interactive) {
    throw new Error(
      "Missing --agent in non-interactive mode. Provide at least one agent.",
    );
  }

  const selected = await runManySelectionStep({
    interactive,
    rows,
    selectedIds: ALL_AGENTS,
    shouldPrompt: true,
    prompt: {
      title: "Choose Agents",
      required: true,
      searchable: true,
      keyHints: INIT_AGENTS_KEY_HINTS,
      initialSelectedIds: ALL_AGENTS,
      view: INIT_AGENTS_SELECTION_VIEW,
    },
    renderClosed: (selectedRowIds) =>
      renderInitAgentsClosedPanel(selectedRowIds),
  });
  if (selected.length === 0) {
    throw new Error("At least one agent must be selected");
  }
  return selected as AgentType[];
}

function buildTemplateBody(template: InitTemplate): string {
  switch (template) {
    case "framework":
      return `## When to use\n\nUse this skill for framework-specific implementation and conventions.\n\n## Steps\n\n1. Confirm framework constraints and versions\n2. Apply framework-safe patterns\n3. Validate behavior with framework-focused checks\n`;
    case "automation":
      return `## When to use\n\nUse this skill when automation, scripts, or repeatable operational tasks are needed.\n\n## Steps\n\n1. Confirm prerequisites and environment\n2. Execute deterministic automation steps\n3. Validate outputs and error handling\n`;
    case "general":
    default:
      return `## When to use\n\nDescribe when this skill should be used.\n\n## Steps\n\n1. First step\n2. Second step\n3. Additional steps as needed\n`;
  }
}

function renderSkillContent(answers: InitAnswers): string {
  return `---\nname: ${answers.name}\ndescription: ${
    answers.description
  }\n---\n\n# ${
    answers.name
  }\n\nInstructions for the agent to follow when this skill is activated.\n\n${buildTemplateBody(
    answers.template,
  )}`;
}

function ensureInsideSkillDir(skillDir: string, relativePath: string): string {
  const destination = path.resolve(skillDir, relativePath);
  const relative = path.relative(skillDir, destination);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe agent config path: ${relativePath}`);
  }
  return destination;
}

export async function runInit(args: string[]): Promise<void> {
  const command = configureInitCommand(
    new Command().name("init"),
    async (name, options) => {
      await executeInit({
        nameArg: name,
        nonInteractive: Boolean(options.nonInteractive),
        yaml: Boolean(options.yaml),
        agent: options.agent,
      });
    },
  );
  await parseStandaloneCommand(command, args);
}

async function executeInit(
  options: InitOptions,
  hooks?: InitExecutionHooks,
): Promise<void> {
  const answers = await collectAnswers(options);
  const agents = await resolveInitAgents(options);
  const agentConfigPlan = buildAgentConfigScaffoldPlan(agents, {
    skillName: answers.name,
    description: answers.description,
  });

  const cwd = process.cwd();
  const requestedName = options.nameArg;
  const skillDir = requestedName ? path.join(cwd, answers.name) : cwd;
  const skillFile = path.join(skillDir, "SKILL.md");
  const summaryLines = [
    `Target directory: ${shortenHomePath(skillDir)}`,
    `Output file: ${shortenHomePath(skillFile)}`,
    `Installer format: ${answers.installerFormat.toUpperCase()}`,
    `Template: ${answers.template
      .charAt(0)
      .toUpperCase()}${answers.template.slice(1)}`,
    `Mapped agent configs: ${agentConfigPlan.mapped.length}`,
  ];
  if (agentConfigPlan.unmapped.length > 0) {
    summaryLines.push(
      `Unmapped agents (skipped): ${agentConfigPlan.unmapped.join(
        ", ",
      )} (no scaffold mapping)`,
    );
  }
  summaryLines.push("");
  summaryLines.push(`name: ${answers.name}`);
  summaryLines.push(`description: ${answers.description}`);

  await renderStaticScreen([
    panelSection({
      title: "Scaffold Summary",
      lines: summaryLines,
      style: "rounded",
      minWidth: 74,
    }),
  ]);
  if (agentConfigPlan.unmapped.length > 0) {
    hooks?.emitCommandEvent?.({
      eventType: "init_agent_scaffold_warning",
      reason: "unmapped_agent_scaffold",
      status: "warn",
      metadata: {
        unmappedAgents: agentConfigPlan.unmapped,
        selectedAgentCount: agents.length,
        mappedConfigCount: agentConfigPlan.mapped.length,
      },
    });
  }

  const completedSteps: string[] = [];
  let failedLabel = "failed to create directory";

  try {
    const createDirectory = !fs.existsSync(skillDir);
    fs.mkdirSync(skillDir, { recursive: true });
    if (createDirectory) {
      completedSteps.push("directory created");
    }

    failedLabel = "failed to write SKILL.md";
    if (fs.existsSync(skillFile)) {
      throw new Error(`SKILL.md already exists at: ${skillFile}`);
    }
    fs.writeFileSync(skillFile, `${renderSkillContent(answers)}\n`, "utf8");
    completedSteps.push("SKILL.md written");

    failedLabel = "failed to scaffold installer config";
    scaffoldInstallerConfigFile(skillDir, answers.installerFormat);
    completedSteps.push("installer config scaffolded");

    failedLabel = "failed to scaffold agent config";
    for (const row of agentConfigPlan.mapped) {
      const destination = ensureInsideSkillDir(skillDir, row.path);
      if (fs.existsSync(destination)) {
        throw new Error(`Agent config already exists at: ${destination}`);
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, row.content, "utf8");
    }
    if (agentConfigPlan.mapped.length > 0) {
      completedSteps.push("agent configs scaffolded");
    }
  } catch (error) {
    await renderStaticScreen([failedStepsSection([failedLabel])]);
    throw error;
  }

  const sections = [];
  if (completedSteps.length > 0) {
    sections.push(completedStepsSection(completedSteps));
  }
  sections.push(linesSection([`Initialized skill: ${skillFile}`]));
  await renderStaticScreen(sections);
}

type InitCommanderOptions = {
  nonInteractive?: boolean;
  yaml?: boolean;
  agent?: string[];
};

function configureInitCommand(
  command: Command,
  action: (
    name: string | undefined,
    options: InitCommanderOptions,
  ) => Promise<void>,
): Command {
  return command
    .description("Create a new SKILL.md template")
    .argument("[name]", "Optional skill directory/name")
    .option("-a, --agent <agents...>", "Target agent(s) for config scaffolding")
    .option(
      "--yaml",
      "Create skill-installer.yaml when scaffolding installer config",
    )
    .option("--non-interactive", "Disable prompts")
    .action(action);
}

export function registerInitCommand(
  program: Command,
  ctx: CliCommandContext,
): void {
  configureInitCommand(
    program.command("init"),
    ctx.wrapAction(
      "init",
      async (name: string | undefined, options: InitCommanderOptions) => {
        await executeInit({
          nameArg: name,
          nonInteractive: Boolean(options.nonInteractive),
          yaml: Boolean(options.yaml),
          agent: options.agent,
        }, {
          emitCommandEvent: (event) => ctx.emitCommandEvent("init", event),
        });
      },
    ),
  );
}
