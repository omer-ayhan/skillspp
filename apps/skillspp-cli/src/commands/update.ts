import { Command } from "commander";
import { type CheckOptions, type SkillAssessment } from "./check";
import { readLockfile, type LockfileFormat } from "@skillspp/core/lockfile";
import { parsePolicyMode } from "../policy-mode";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import { runBackgroundTask } from "../runtime/background-runner";
import { canUseInteractive } from "@skillspp/cli-shared/interactive";
import {
  type ManySelectionViewConfig,
  type SelectionKeyHint,
  runManySelectionStep,
} from "@skillspp/cli-shared/ui/selection-step";
import {
  completedStepsSection,
  failedStepsSection,
  flushUiFrame,
  hideLoader,
  linesSection,
  manySelectionClosedSection,
  panelSection,
  renderStaticScreen,
  showLoader,
  sourceSection,
} from "@skillspp/cli-shared/ui/screens";
import { formatDriftChips, shortenHomePath } from "@skillspp/cli-shared/ui/format";
import type { SelectionRow } from "@skillspp/core/agents";

export type UpdateOptions = CheckOptions & {
  dryRun?: boolean;
  trustWellKnown?: boolean;
  nonInteractive?: boolean;
  policyMode?: "enforce" | "warn";
  lockFormat?: LockfileFormat;
  migrate?: string;
};

type UpdateCommanderOptions = {
  global?: boolean;
  skill?: string[];
  dryRun?: boolean;
  trustWellKnown?: boolean;
  nonInteractive?: boolean;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: string;
  policyMode?: string;
  lockFormat?: string;
  migrate?: string;
};

function toUpdateOptions(options: UpdateCommanderOptions): UpdateOptions {
  const maxDownloadBytes = options.maxDownloadBytes ? Number(options.maxDownloadBytes) : undefined;
  if (
    typeof maxDownloadBytes === "number" &&
    (!Number.isFinite(maxDownloadBytes) || maxDownloadBytes <= 0)
  ) {
    throw new Error(`Invalid --max-download-bytes value: ${options.maxDownloadBytes}`);
  }

  const lockFormat = options.lockFormat;
  if (lockFormat && lockFormat !== "json" && lockFormat !== "yaml") {
    throw new Error(`Invalid --lock-format value: ${lockFormat}`);
  }

  return {
    global: Boolean(options.global),
    skill: options.skill,
    dryRun: Boolean(options.dryRun),
    trustWellKnown: Boolean(options.trustWellKnown),
    nonInteractive: Boolean(options.nonInteractive),
    allowHost: options.allowHost?.map((item) => item.toLowerCase()),
    denyHost: options.denyHost?.map((item) => item.toLowerCase()),
    maxDownloadBytes,
    policyMode: parsePolicyMode(options.policyMode),
    lockFormat: lockFormat as LockfileFormat | undefined,
    migrate: options.migrate,
    experimental: false,
  };
}

const UPDATE_SKILLS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "", action: "type to filter" },
  { key: "space", action: "toggle" },
  { key: "ctrl+a", action: "all" },
  { key: "ctrl+l", action: "invert" },
  { key: "enter", action: "confirm" },
];

const UPDATE_SKILLS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Skills To Update",
  countLine: "candidates",
  instructionLine: "Select skills (space to toggle)",
  labelWidth: 32,
  descWidth: 28,
  minWidth: 74,
  defaultHints: UPDATE_SKILLS_KEY_HINTS,
};

function buildUpdateRows(assessments: SkillAssessment[]): SelectionRow[] {
  return assessments.map((assessment) => {
    const reason =
      assessment.drift.find((item) => item.kind === "changed-source")?.kind ||
      assessment.drift.find((item) => item.kind === "local-modified")?.kind ||
      "changed-source";
    return {
      id: assessment.entry.skillName,
      label: assessment.entry.skillName,
      description: reason,
    };
  });
}

function renderUpdateSkillsClosedPanel(rows: SelectionRow[], selectedIds: string[]) {
  return manySelectionClosedSection(UPDATE_SKILLS_SELECTION_VIEW, rows, selectedIds);
}

type UpdateAssessment = Pick<SkillAssessment, "entry" | "drift">;

export function buildUpdateDriftSummaryLines(options: {
  assessedCount: number;
  requiresUpdateCount: number;
  changedSourceCount: number;
  localModifiedCount: number;
  colorEnabled?: boolean;
}): string[] {
  return [
    `${options.assessedCount} tracked skill${options.assessedCount === 1 ? "" : "s"} checked`,
    `${options.requiresUpdateCount} skill${
      options.requiresUpdateCount === 1 ? "" : "s"
    } require update`,
    `Drift signal: ${formatDriftChips({
      plusCount: options.changedSourceCount,
      minusCount: options.localModifiedCount,
      colorEnabled: options.colorEnabled,
    })}`,
    "",
    `  - changed-source: ${options.changedSourceCount}`,
    `  - local-modified: ${options.localModifiedCount}`,
  ];
}

function mergeSkillSelection(
  positionalSkill: string | undefined,
  optionSkills: string[] | undefined,
): string[] | undefined {
  const merged = [...(optionSkills || [])];
  if (positionalSkill && positionalSkill.trim().length > 0) {
    merged.push(positionalSkill.trim());
  }
  if (merged.length === 0) {
    return undefined;
  }
  return [...new Set(merged)];
}

async function executeMigrateUpdate(options: {
  cwd: string;
  lockFormat: LockfileFormat;
  updateOptions: UpdateOptions;
  skillName: string;
}): Promise<void> {
  if (!options.updateOptions.migrate) {
    throw new Error("Missing migrate source.");
  }

  if (options.updateOptions.dryRun) {
    await renderStaticScreen([
      panelSection({
        title: "Migration Summary",
        lines: [
          `Skill: ${options.skillName}`,
          `Source: ${options.updateOptions.migrate}`,
          "",
          "Dry-run mode: no changes applied.",
        ],
        style: "square",
        minWidth: 74,
      }),
    ]);
    return;
  }

  showLoader("migrating selected skill");
  await flushUiFrame();
  let failedLabel = `failed to migrate ${options.skillName}`;
  try {
    await runBackgroundTask(
      {
        kind: "update.migrate",
        payload: {
          cwd: options.cwd,
          options: options.updateOptions,
          skillName: options.skillName,
          sourceInput: options.updateOptions.migrate,
          lockFormat: options.lockFormat,
        },
      },
      {
        onProgress: (label) => {
          if (label === "writing lockfile") {
            failedLabel = "failed to write lockfile";
          }
          showLoader(label);
        },
      },
    );
  } catch (error) {
    hideLoader();
    await renderStaticScreen([failedStepsSection([failedLabel])]);
    throw error;
  }
  hideLoader();
  await renderStaticScreen([
    completedStepsSection([`migrated ${options.skillName}`, "lockfile written"]),
    linesSection(["Migration complete.", `Updated ${options.skillName}.`]),
  ]);
}

async function executeUpdate(options: UpdateOptions, positionalSkill?: string): Promise<void> {
  const interactive = canUseInteractive(options.nonInteractive);

  const cwd = process.cwd();
  const mergedSkills = mergeSkillSelection(positionalSkill, options.skill);
  const effectiveOptions: UpdateOptions = {
    ...options,
    skill: mergedSkills,
  };

  const requestedSkills = (effectiveOptions.skill || []).filter((skill) => skill !== "*");
  if (effectiveOptions.migrate) {
    if (requestedSkills.length !== 1) {
      throw new Error(
        "Migration requires exactly one skill target: skillspp update <skill-name> --migrate <new-skill-source>",
      );
    }
  }
  if (requestedSkills.length > 0) {
    const lock = readLockfile(Boolean(effectiveOptions.global), cwd);
    const known = new Set(lock.entries.map((entry) => entry.skillName));
    const unknown = [...new Set(requestedSkills)]
      .filter((skill) => !known.has(skill))
      .sort((a, b) => a.localeCompare(b));
    if (unknown.length > 0) {
      throw new Error(`Unknown skill(s) for update: ${unknown.join(", ")}`);
    }
  }

  if (effectiveOptions.migrate) {
    await executeMigrateUpdate({
      cwd,
      lockFormat: effectiveOptions.lockFormat || "json",
      updateOptions: effectiveOptions,
      skillName: requestedSkills[0],
    });
    return;
  }

  try {
    showLoader("assessing drift");
    await flushUiFrame();
    let assessed;
    try {
      assessed = await runBackgroundTask(
        {
          kind: "update.assess",
          payload: {
            cwd,
            options: effectiveOptions,
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
      await renderStaticScreen([failedStepsSection(["failed to assess drift"])]);
      throw error;
    }
    hideLoader();
    const assessments: UpdateAssessment[] = assessed.assessments;

    const candidateAssessments = assessments.filter((assessment) => {
      if (assessment.drift.some((item) => item.kind === "migrate-required")) {
        return false;
      }
      return assessment.drift.some(
        (item) => item.kind === "changed-source" || item.kind === "local-modified",
      );
    });
    const migrateRequired = assessments
      .filter((assessment) => assessment.drift.some((item) => item.kind === "migrate-required"))
      .map((assessment) => assessment.entry.skillName)
      .sort((a, b) => a.localeCompare(b));
    let changedSourceCount = 0;
    let localModifiedCount = 0;
    for (const assessment of candidateAssessments) {
      for (const drift of assessment.drift) {
        if (drift.kind === "changed-source") {
          changedSourceCount += 1;
        }
        if (drift.kind === "local-modified") {
          localModifiedCount += 1;
        }
      }
    }

    await renderStaticScreen([
      completedStepsSection([
        "drift assessed",
        "update candidates resolved",
        "interactive session ready",
      ]),
      sourceSection(shortenHomePath(cwd)),
      panelSection({
        title: "Drift Summary",
        lines: buildUpdateDriftSummaryLines({
          assessedCount: assessments.length,
          requiresUpdateCount: candidateAssessments.length,
          changedSourceCount,
          localModifiedCount,
          colorEnabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
        }),
        style: "square",
        minWidth: 74,
      }),
    ]);

    if (candidateAssessments.length === 0) {
      if (migrateRequired.length > 0) {
        await renderStaticScreen([
          panelSection({
            title: "Migration Required",
            lines: migrateRequired.map(
              (skillName) => `skillspp update ${skillName} --migrate <new-skill-source>`,
            ),
            style: "square",
            minWidth: 74,
          }),
        ]);
        return;
      }
      await renderStaticScreen([linesSection(["No updates required."])]);
      return;
    }

    const candidateRows = buildUpdateRows(candidateAssessments).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    const selectedSkillIds = await runManySelectionStep({
      interactive,
      rows: candidateRows,
      selectedIds: candidateRows.map((row) => row.id),
      shouldPrompt: interactive && !effectiveOptions.skill && candidateRows.length > 1,
      prompt: {
        title: "Choose Skills To Update",
        required: true,
        requiredMessage: "At least one skill must be selected",
        searchable: true,
        keyHints: UPDATE_SKILLS_KEY_HINTS,
        view: UPDATE_SKILLS_SELECTION_VIEW,
      },
      renderClosed: (selectedIds) => renderUpdateSkillsClosedPanel(candidateRows, selectedIds),
    });

    const selectedSet = new Set(selectedSkillIds);
    const selectedAssessments = candidateAssessments.filter((assessment) =>
      selectedSet.has(assessment.entry.skillName),
    );
    if (selectedAssessments.length === 0) {
      throw new Error("No skills selected for update.");
    }

    let lockFormat: LockfileFormat = options.lockFormat || "json";
    lockFormat = effectiveOptions.lockFormat || "json";

    await renderStaticScreen([
      panelSection({
        title: "Update Summary",
        lines: [
          `Scope: ${effectiveOptions.global ? "global" : "current project"}`,
          `Mode: ${effectiveOptions.dryRun ? "dry-run" : "apply"}`,
          "",
          `Skills to update (${selectedAssessments.length}):`,
          ...selectedAssessments
            .map((assessment) => `  - ${assessment.entry.skillName}`)
            .sort((a, b) => a.localeCompare(b)),
          "",
          "Safety: automatic rollback on per-skill failure",
        ],
        style: "rounded",
        minWidth: 74,
      }),
    ]);

    if (effectiveOptions.dryRun) {
      await renderStaticScreen([linesSection(["Dry-run mode: no changes applied."])]);
      return;
    }

    showLoader("updating selected skills");
    await flushUiFrame();
    let failedLabel = "failed to assess selected skills";
    let applied;
    try {
      applied = await runBackgroundTask(
        {
          kind: "update.apply",
          payload: {
            cwd,
            options: effectiveOptions,
            selectedSkillNames: selectedAssessments.map((assessment) => assessment.entry.skillName),
            lockFormat,
          },
        },
        {
          onProgress: (label) => {
            if (label === "writing lockfile") {
              failedLabel = "failed to write lockfile";
            } else if (label.startsWith("updating ")) {
              failedLabel = `failed to update ${label.slice("updating ".length)}`;
            } else {
              failedLabel = "failed to assess selected skills";
            }
            showLoader(label);
          },
        },
      );
    } catch (error) {
      hideLoader();
      await renderStaticScreen([failedStepsSection([failedLabel])]);
      throw error;
    }
    hideLoader();
    await renderStaticScreen([
      completedStepsSection([
        "selected skills assessed",
        ...applied.updatedSkillNames.map((skillName) => `updated ${skillName}`),
        "lockfile written",
      ]),
      linesSection(["Update complete.", `Updated ${applied.updatedSkillNames.length} skills.`]),
    ]);
  } finally {
    hideLoader();
  }
}

function configureUpdateCommand(
  command: Command,
  action: (skill: string | undefined, options: UpdateCommanderOptions) => Promise<void>,
): Command {
  return command
    .description("Update drifted skills")
    .argument("[skill]", "Single skill name target")
    .option("-g, --global", "Update global installs")
    .option("-s, --skill <skills...>", "Update only selected skill(s)")
    .option("--migrate <source>", "Migrate selected skill to a new source")
    .option("--dry-run", "Show updates without applying")
    .option("--non-interactive", "Disable prompts")
    .option("--trust-well-known", "Allow hook commands for well-known source")
    .option("--allow-host <hosts...>", "Restrict well-known hosts to allowlist")
    .option("--deny-host <hosts...>", "Block specific well-known hosts")
    .option("--max-download-bytes <n>", "Set well-known download budget")
    .option("--policy-mode <mode>", "Policy mode (enforce|warn)")
    .option("--lock-format <format>", "Lockfile format output (json|yaml)")
    .action(action);
}

export function registerUpdateCommand(program: Command, ctx: CliCommandContext): void {
  configureUpdateCommand(
    program.command("update"),
    ctx.wrapAction("update", async (skill: string | undefined, options: UpdateCommanderOptions) => {
      await executeUpdate(
        {
          ...toUpdateOptions(options),
          experimental: ctx.experimental,
        },
        skill,
      );
    }),
  );
}

export async function runUpdate(args: string[]): Promise<void> {
  const command = configureUpdateCommand(new Command().name("update"), async (skill, options) => {
    await executeUpdate(toUpdateOptions(options), skill);
  });
  await parseStandaloneCommand(command, args);
}
