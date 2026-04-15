import { Command } from "commander";
import type { DriftRecord } from "@skillspp/core/contracts/results";
import {
  assessLockEntries as assessLockEntriesCore,
  collectDrift as collectDriftCore,
  type CheckOptions,
  type SkillAssessment,
} from "@skillspp/core/runtime/check-analysis";
import { parsePolicyMode } from "../policy-mode";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import { runBackgroundTask } from "../runtime/background-runner";
import {
  completedStepsSection,
  failedStepsSection,
  flushUiFrame,
  hideLoader,
  panelSection,
  renderStaticScreen,
  showLoader,
  sourceSection,
} from "@skillspp/cli-shared/ui/screens";
import { formatDriftChips, shortenHomePath } from "@skillspp/cli-shared/ui/format";

export type { DriftRecord, CheckOptions, SkillAssessment };
export type DriftKind = DriftRecord["kind"];

const DRIFT_KIND_ORDER: DriftKind[] = [
  "migrate-required",
  "changed-source",
  "local-modified",
  "missing-source",
  "lock-missing",
];

export function buildCheckDriftSummaryLines(options: {
  checked: number;
  driftCount: number;
  grouped: Map<DriftKind, DriftRecord[]>;
  colorEnabled?: boolean;
}): string[] {
  const plusCount = options.grouped.get("changed-source")?.length ?? 0;
  const minusCount = options.grouped.get("local-modified")?.length ?? 0;
  const summaryLines = [
    `${options.checked} tracked skill${options.checked === 1 ? "" : "s"} checked`,
    `${options.driftCount} drift case${options.driftCount === 1 ? "" : "s"} detected`,
    `Drift signal: ${formatDriftChips({
      plusCount,
      minusCount,
      colorEnabled: options.colorEnabled,
    })}`,
  ];

  for (const kind of DRIFT_KIND_ORDER) {
    const rows = options.grouped.get(kind);
    if (!rows || rows.length === 0) {
      continue;
    }
    summaryLines.push("");
    summaryLines.push(`  - ${kind}: ${rows.length}`);
  }
  return summaryLines;
}

type CheckCommanderOptions = {
  global?: boolean;
  skill?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: string;
  policyMode?: string;
};

function toCheckOptions(options: CheckCommanderOptions): CheckOptions {
  const maxDownloadBytes = options.maxDownloadBytes ? Number(options.maxDownloadBytes) : undefined;
  if (
    typeof maxDownloadBytes === "number" &&
    (!Number.isFinite(maxDownloadBytes) || maxDownloadBytes <= 0)
  ) {
    throw new Error(`Invalid --max-download-bytes value: ${options.maxDownloadBytes}`);
  }

  return {
    global: Boolean(options.global),
    skill: options.skill,
    allowHost: options.allowHost?.map((item) => item.toLowerCase()),
    denyHost: options.denyHost?.map((item) => item.toLowerCase()),
    maxDownloadBytes,
    policyMode: parsePolicyMode(options.policyMode),
    experimental: false,
  };
}

export async function assessLockEntries(
  options: CheckOptions,
  cwd: string,
  behavior: { keepResolved: boolean } = { keepResolved: false },
): Promise<{
  drift: DriftRecord[];
  checked: number;
  assessments: SkillAssessment[];
}> {
  return assessLockEntriesCore(options, cwd, behavior);
}

export async function collectDrift(
  options: CheckOptions,
  cwd: string,
): Promise<{ drift: DriftRecord[]; checked: number }> {
  return collectDriftCore(options, cwd);
}

async function executeCheck(options: CheckOptions): Promise<void> {
  const cwd = process.cwd();
  let failedLabel = "failed to assess drift";
  showLoader("checking drift");
  await flushUiFrame();
  try {
    const { drift, checked, conflicts, transitiveConflicts } = await runBackgroundTask(
      {
        kind: "check.scan",
        payload: {
          cwd,
          options,
        },
      },
      {
        onProgress: (label) => {
          if (label === "checking local/global conflicts") {
            failedLabel = "failed to scan local/global conflicts";
          } else if (label === "checking transitive conflicts") {
            failedLabel = "failed to scan transitive conflicts";
          } else {
            failedLabel = "failed to assess drift";
          }
          showLoader(label);
        },
      },
    );
    hideLoader();
    const grouped = new Map<DriftKind, DriftRecord[]>();
    for (const item of drift) {
      const list = grouped.get(item.kind) || [];
      list.push(item);
      grouped.set(item.kind, list);
    }
    const sections = [
      completedStepsSection([
        "drift assessed",
        "local/global conflicts scanned",
        "transitive conflicts scanned",
      ]),
      sourceSection(shortenHomePath(cwd)),
      panelSection({
        title: "Check Scope",
        lines: [
          `Scope: ${options.global ? "global" : "current project"}`,
          `Skill filter: ${
            !options.skill || options.skill.length === 0 || options.skill.includes("*")
              ? "all tracked skills"
              : [...new Set(options.skill)].sort((a, b) => a.localeCompare(b)).join(", ")
          }`,
        ],
        style: "square",
        minWidth: 74,
      }),
    ];

    const cleanState =
      drift.length === 0 && conflicts.length === 0 && transitiveConflicts.length === 0;

    if (cleanState) {
      sections.push(
        panelSection({
          title: "Check Summary",
          lines: [
            `${checked} tracked skill${checked === 1 ? "" : "s"} checked`,
            "No drift detected",
            "No conflicts detected",
          ],
          style: "square",
          minWidth: 74,
        }),
      );
      await renderStaticScreen(sections);
      return;
    }

    if (drift.length > 0) {
      const summaryLines = buildCheckDriftSummaryLines({
        checked,
        driftCount: drift.length,
        grouped,
        colorEnabled: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
      });
      sections.push(
        panelSection({
          title: "Drift Summary",
          lines: summaryLines,
          style: "square",
          minWidth: 74,
        }),
      );

      const detailLines: string[] = [];
      for (const kind of DRIFT_KIND_ORDER) {
        const rows = grouped.get(kind);
        if (!rows || rows.length === 0) {
          continue;
        }
        if (detailLines.length > 0) {
          detailLines.push("");
        }
        detailLines.push(`  ${kind}`);
        for (const row of [...rows].sort((a, b) => a.skillName.localeCompare(b.skillName))) {
          detailLines.push(`    ${row.skillName}: ${row.detail}`);
        }
      }
      sections.push(
        panelSection({
          title: "Drift Details",
          lines: detailLines,
          style: "square",
          minWidth: 74,
        }),
      );
    }

    if (conflicts.length > 0 || transitiveConflicts.length > 0) {
      const conflictLines: string[] = [];
      if (conflicts.length > 0) {
        conflictLines.push("Local/global conflicts (local preferred):");
        for (const conflict of conflicts) {
          conflictLines.push(`  ${conflict.skillName}: winner=${conflict.winner}`);
        }
      }
      if (transitiveConflicts.length > 0) {
        if (conflictLines.length > 0) {
          conflictLines.push("");
        }
        conflictLines.push("Transitive skill conflicts:");
        for (const conflict of transitiveConflicts) {
          conflictLines.push(
            `  ${conflict.skillName}: winner=${conflict.winner.packageName}@${conflict.winner.packageVersion} depth=${conflict.winner.depth}`,
          );
          for (const loser of conflict.losers) {
            conflictLines.push(
              `    - loser=${loser.packageName}@${loser.packageVersion} depth=${loser.depth}`,
            );
          }
        }
      }
      sections.push(
        panelSection({
          title: "Conflict Scan",
          lines: conflictLines,
          style: "square",
          minWidth: 74,
        }),
      );
    }

    const updateSkillNames = [
      ...new Set(
        drift
          .filter((item) => item.kind === "changed-source" || item.kind === "local-modified")
          .map((item) => item.skillName),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const migrateSkillNames = [
      ...new Set(
        drift.filter((item) => item.kind === "migrate-required").map((item) => item.skillName),
      ),
    ].sort((a, b) => a.localeCompare(b));

    if (migrateSkillNames.length > 0 || updateSkillNames.length > 0) {
      const lines: string[] = [];
      if (migrateSkillNames.length > 0) {
        lines.push("Migration required:");
        for (const skillName of migrateSkillNames) {
          lines.push(`skillspp update ${skillName} --migrate <new-skill-source>`);
        }
      }
      if (updateSkillNames.length > 0) {
        if (lines.length > 0) {
          lines.push("");
        }
        lines.push(
          `skillspp update${
            options.global ? " --global" : ""
          } --skill ${updateSkillNames.join(" ")}`,
        );
      }
      sections.push(
        panelSection({
          title: "Suggested Next Step",
          lines,
          style: "square",
          minWidth: 74,
        }),
      );
    }

    await renderStaticScreen(sections);
  } catch (error) {
    hideLoader();
    await renderStaticScreen([failedStepsSection([failedLabel])]);
    throw error;
  } finally {
    hideLoader();
  }
}

function configureCheckCommand(
  command: Command,
  action: (options: CheckCommanderOptions) => Promise<void>,
): Command {
  return command
    .description("Detect source/install drift from lockfile")
    .option("-g, --global", "Check global installs")
    .option("-s, --skill <skills...>", "Check only selected skill(s)")
    .option("--allow-host <hosts...>", "Restrict well-known hosts to allowlist")
    .option("--deny-host <hosts...>", "Block specific well-known hosts")
    .option("--max-download-bytes <n>", "Set well-known download budget")
    .option("--policy-mode <mode>", "Policy mode (enforce|warn)")
    .action(action);
}

export function registerCheckCommand(program: Command, ctx: CliCommandContext): void {
  configureCheckCommand(
    program.command("check"),
    ctx.wrapAction("check", async (options: CheckCommanderOptions) => {
      await executeCheck({
        ...toCheckOptions(options),
        experimental: ctx.experimental,
      });
    }),
  );
}

export async function runCheck(args: string[]): Promise<void> {
  const command = configureCheckCommand(new Command().name("check"), async (options) => {
    await executeCheck(toCheckOptions(options));
  });
  await parseStandaloneCommand(command, args);
}
