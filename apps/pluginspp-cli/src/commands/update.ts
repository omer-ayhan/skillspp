import { Command } from "commander";
import {
  type LockfileFormat,
  readResourceLockfile,
} from "@skillspp/core/lockfile";
import type { SelectionRow } from "@skillspp/core/agents";
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
import {
  formatDriftChips,
  shortenHomePath,
} from "@skillspp/cli-shared/ui/format";

export type UpdateOptions = {
  global?: boolean;
  skill?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  dryRun?: boolean;
  trustWellKnown?: boolean;
  nonInteractive?: boolean;
  policyMode?: "enforce" | "warn";
  lockFormat?: LockfileFormat;
  migrate?: string;
  experimental?: boolean;
};

type UpdateCommanderOptions = {
  global?: boolean;
  plugin?: string[];
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

type UpdateAssessment = {
  entry: {
    skillName: string;
  };
  drift: Array<{
    kind: string;
  }>;
};

function toUpdateOptions(options: UpdateCommanderOptions): UpdateOptions {
  const maxDownloadBytes = options.maxDownloadBytes
    ? Number(options.maxDownloadBytes)
    : undefined;
  if (
    typeof maxDownloadBytes === "number" &&
    (!Number.isFinite(maxDownloadBytes) || maxDownloadBytes <= 0)
  ) {
    throw new Error(
      `Invalid --max-download-bytes value: ${options.maxDownloadBytes}`,
    );
  }

  const lockFormat = options.lockFormat;
  if (lockFormat && lockFormat !== "json" && lockFormat !== "yaml") {
    throw new Error(`Invalid --lock-format value: ${lockFormat}`);
  }

  return {
    global: Boolean(options.global),
    skill: options.plugin,
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

const UPDATE_PLUGINS_KEY_HINTS: SelectionKeyHint[] = [
  { key: "", action: "type to filter" },
  { key: "space", action: "toggle" },
  { key: "ctrl+a", action: "all" },
  { key: "ctrl+l", action: "invert" },
  { key: "enter", action: "confirm" },
];

const UPDATE_PLUGINS_SELECTION_VIEW: ManySelectionViewConfig = {
  title: "Choose Plugins To Update",
  countLine: "candidates",
  instructionLine: "Select plugins (space to toggle)",
  labelWidth: 32,
  descWidth: 28,
  minWidth: 74,
  defaultHints: UPDATE_PLUGINS_KEY_HINTS,
};

function buildUpdateRows(assessments: UpdateAssessment[]): SelectionRow[] {
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

function renderUpdatePluginsClosedPanel(
  rows: SelectionRow[],
  selectedIds: string[],
) {
  return manySelectionClosedSection(
    UPDATE_PLUGINS_SELECTION_VIEW,
    rows,
    selectedIds,
  );
}

export function buildUpdateDriftSummaryLines(options: {
  assessedCount: number;
  requiresUpdateCount: number;
  changedSourceCount: number;
  localModifiedCount: number;
  colorEnabled?: boolean;
}): string[] {
  return [
    `${options.assessedCount} tracked plugin${
      options.assessedCount === 1 ? "" : "s"
    } checked`,
    `${options.requiresUpdateCount} plugin${
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

function mergePluginSelection(
  positionalPlugins: string[] | undefined,
  optionPlugins: string[] | undefined,
): string[] | undefined {
  const merged = [...(optionPlugins || [])];
  for (const plugin of positionalPlugins || []) {
    const trimmed = plugin.trim();
    if (trimmed.length > 0) {
      merged.push(trimmed);
    }
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
  pluginName: string;
}): Promise<void> {
  if (!options.updateOptions.migrate) {
    throw new Error("Missing migrate source.");
  }

  if (options.updateOptions.dryRun) {
    await renderStaticScreen([
      panelSection({
        title: "Migration Summary",
        lines: [
          `Plugin: ${options.pluginName}`,
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

  showLoader("migrating selected plugin");
  await flushUiFrame();
  let failedLabel = `failed to migrate ${options.pluginName}`;
  try {
    await runBackgroundTask(
      {
        kind: "plugin.update.migrate",
        payload: {
          cwd: options.cwd,
          options: options.updateOptions,
          pluginName: options.pluginName,
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
    completedStepsSection([
      `migrated ${options.pluginName}`,
      "lockfile written",
    ]),
    linesSection(["Migration complete.", `Updated ${options.pluginName}.`]),
  ]);
}

async function executeUpdate(
  options: UpdateOptions,
  positionalPlugins?: string[],
): Promise<void> {
  const interactive = canUseInteractive(options.nonInteractive);
  const cwd = process.cwd();
  const mergedPlugins = mergePluginSelection(positionalPlugins, options.skill);
  const effectiveOptions: UpdateOptions = {
    ...options,
    skill: mergedPlugins,
  };

  const requestedPlugins = (effectiveOptions.skill || []).filter(
    (plugin) => plugin !== "*",
  );
  if (effectiveOptions.migrate) {
    if (requestedPlugins.length !== 1) {
      throw new Error(
        "Migration requires exactly one plugin target: pluginspp update <plugin-name> --migrate <new-plugin-source>",
      );
    }
  }
  if (requestedPlugins.length > 0) {
    const lock = readResourceLockfile(
      "plugin",
      Boolean(effectiveOptions.global),
      cwd,
    );
    const known = new Set(lock.entries.map((entry) => entry.skillName));
    const unknown = [...new Set(requestedPlugins)]
      .filter((plugin) => !known.has(plugin))
      .sort((a, b) => a.localeCompare(b));
    if (unknown.length > 0) {
      throw new Error(`Unknown plugin(s) for update: ${unknown.join(", ")}`);
    }
  }

  if (effectiveOptions.migrate) {
    await executeMigrateUpdate({
      cwd,
      lockFormat: effectiveOptions.lockFormat || "json",
      updateOptions: effectiveOptions,
      pluginName: requestedPlugins[0],
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
          kind: "plugin.update.assess",
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
      await renderStaticScreen([
        failedStepsSection(["failed to assess drift"]),
      ]);
      throw error;
    }
    hideLoader();
    const assessments: UpdateAssessment[] = assessed.assessments;

    const candidateAssessments = assessments.filter((assessment) => {
      if (assessment.drift.some((item) => item.kind === "migrate-required")) {
        return false;
      }
      return assessment.drift.some(
        (item) =>
          item.kind === "changed-source" || item.kind === "local-modified",
      );
    });
    const migrateRequired = assessments
      .filter((assessment) =>
        assessment.drift.some((item) => item.kind === "migrate-required"),
      )
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
      sourceSection(shortenHomePath(cwd), "Plugins source"),
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
              (pluginName) =>
                `pluginspp update ${pluginName} --migrate <new-plugin-source>`,
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
    const selectedPluginIds = await runManySelectionStep({
      interactive,
      rows: candidateRows,
      selectedIds: candidateRows.map((row) => row.id),
      shouldPrompt:
        interactive && !effectiveOptions.skill && candidateRows.length > 1,
      prompt: {
        title: "Choose Plugins To Update",
        required: true,
        requiredMessage: "At least one plugin must be selected",
        searchable: true,
        keyHints: UPDATE_PLUGINS_KEY_HINTS,
        view: UPDATE_PLUGINS_SELECTION_VIEW,
      },
      renderClosed: (selectedIds) =>
        renderUpdatePluginsClosedPanel(candidateRows, selectedIds),
    });

    const selectedSet = new Set(selectedPluginIds);
    const selectedAssessments = candidateAssessments.filter((assessment) =>
      selectedSet.has(assessment.entry.skillName),
    );
    if (selectedAssessments.length === 0) {
      throw new Error("No plugins selected for update.");
    }

    const lockFormat = effectiveOptions.lockFormat || "json";

    await renderStaticScreen([
      panelSection({
        title: "Update Summary",
        lines: [
          `Scope: ${effectiveOptions.global ? "global" : "current project"}`,
          `Mode: ${effectiveOptions.dryRun ? "dry-run" : "apply"}`,
          "",
          `Plugins to update (${selectedAssessments.length}):`,
          ...selectedAssessments
            .map((assessment) => `  - ${assessment.entry.skillName}`)
            .sort((a, b) => a.localeCompare(b)),
          "",
          "Safety: automatic rollback on per-plugin failure",
        ],
        style: "rounded",
        minWidth: 74,
      }),
    ]);

    if (effectiveOptions.dryRun) {
      await renderStaticScreen([
        linesSection(["Dry-run mode: no changes applied."]),
      ]);
      return;
    }

    showLoader("updating selected plugins");
    await flushUiFrame();
    let failedLabel = "failed to assess selected plugins";
    let applied;
    try {
      applied = await runBackgroundTask(
        {
          kind: "plugin.update.apply",
          payload: {
            cwd,
            options: effectiveOptions,
            selectedPluginNames: selectedAssessments.map(
              (assessment) => assessment.entry.skillName,
            ),
            lockFormat,
          },
        },
        {
          onProgress: (label) => {
            if (label === "writing lockfile") {
              failedLabel = "failed to write lockfile";
            } else if (label.startsWith("updating ")) {
              failedLabel = `failed to update ${label.slice(
                "updating ".length,
              )}`;
            } else {
              failedLabel = "failed to assess selected plugins";
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
        "selected plugins assessed",
        ...applied.updatedPluginNames.map(
          (pluginName: string) => `updated ${pluginName}`,
        ),
        "lockfile written",
      ]),
      linesSection([
        "Update complete.",
        `Updated ${applied.updatedPluginNames.length} plugins.`,
      ]),
    ]);
  } finally {
    hideLoader();
  }
}

function configureUpdateCommand(
  command: Command,
  action: (
    plugins: string[] | undefined,
    options: UpdateCommanderOptions,
  ) => Promise<void>,
): Command {
  return command
    .description("Update drifted plugins")
    .argument("[plugin...]", "Plugin name target")
    .option("-p, --plugin <plugins...>", "Update only selected plugin(s)")
    .option("-g, --global", "Update global installs")
    .option("--migrate <source>", "Migrate selected plugin to a new source")
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

export function registerUpdateCommand(
  program: Command,
  ctx: CliCommandContext,
): void {
  configureUpdateCommand(
    program.command("update"),
    ctx.wrapAction(
      "update",
      async (
        plugins: string[] | undefined,
        options: UpdateCommanderOptions,
      ) => {
        await executeUpdate(
          {
            ...toUpdateOptions(options),
            experimental: ctx.experimental,
          },
          plugins,
        );
      },
    ),
  );
}

export async function runUpdate(args: string[]): Promise<void> {
  const command = configureUpdateCommand(
    new Command().name("update"),
    async (plugins, options) => {
      await executeUpdate(toUpdateOptions(options), plugins);
    },
  );
  await parseStandaloneCommand(command, args);
}
