import { Command } from "commander";
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
  linesSection,
  panelSection,
  renderStaticScreen,
  showLoader,
  sourceSection,
} from "@skillspp/cli-shared/ui/screens";
import { shortenHomePath } from "@skillspp/cli-shared/ui/format";

export type FindOptions = {
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  experimental?: boolean;
};

type FindCommanderOptions = {
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: string;
};

function toFindOptions(options: FindCommanderOptions): FindOptions {
  const maxDownloadBytes = options.maxDownloadBytes
    ? Number(options.maxDownloadBytes)
    : undefined;
  if (
    typeof maxDownloadBytes === "number" &&
    (!Number.isFinite(maxDownloadBytes) || maxDownloadBytes <= 0)
  ) {
    throw new Error(
      `Invalid --max-download-bytes value: ${options.maxDownloadBytes}`
    );
  }

  return {
    allowHost: options.allowHost?.map((item) => item.toLowerCase()),
    denyHost: options.denyHost?.map((item) => item.toLowerCase()),
    maxDownloadBytes,
    experimental: false,
  };
}

type FindInventoryItem = {
  name: string;
  description: string;
};

function matchesQuery(
  name: string,
  description: string,
  query?: string
): boolean {
  if (!query) {
    return true;
  }

  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }

  return (
    name.toLowerCase().includes(q) || description.toLowerCase().includes(q)
  );
}

function resolveFindSourceTypeLabel(
  sourceType: "local" | "github" | "git" | "well-known" | "catalog"
): string {
  switch (sourceType) {
    case "local":
      return "local directory";
    case "github":
    case "git":
      return "git repository";
    case "well-known":
      return "well-known registry";
    case "catalog":
      return "catalog registry";
    default:
      return "";
  }
}

async function executeFind(
  source: string,
  query: string | undefined,
  options: FindOptions
): Promise<void> {
  try {
    showLoader("loading");
    await flushUiFrame();
    let failedLabel = "failed to fetch skill inventory";
    let inventory;
    try {
      inventory = await runBackgroundTask(
        {
          kind: "find.fetchInventory",
          payload: {
            cwd: process.cwd(),
            sourceInput: source,
            options,
          },
        },
        {
          onProgress: (label) => {
            if (label === "parsing source") {
              failedLabel = "failed to parse source";
            } else {
              failedLabel = "failed to fetch skill inventory";
            }
            showLoader(label);
          },
        }
      );
    } catch (error) {
      hideLoader();
      await renderStaticScreen([failedStepsSection([failedLabel])]);
      throw error;
    }
    hideLoader();

    showLoader("applying query filter");
    await flushUiFrame();
    let filtered: FindInventoryItem[];
    try {
      filtered = inventory.skills
        .filter((item) => matchesQuery(item.name, item.description, query))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      hideLoader();
      await renderStaticScreen([
        failedStepsSection(["failed to apply query filter"]),
      ]);
      throw error;
    }
    hideLoader();

    const flowSections = [
      completedStepsSection([
        "source parsed",
        "skill inventory fetched",
        "query filter applied",
      ]),
      sourceSection(shortenHomePath(inventory.sourceLabel)),
    ];

    const queryTrimmed = query && query.trim().length > 0 ? query : "";

    if (queryTrimmed) {
      flowSections.push(
        panelSection({
          title: "Query",
          lines: [
            `Search term: ${queryTrimmed || "(none)"}`,
            "Match against: skill name + description",
          ],
          style: "square",
          minWidth: 74,
        })
      );
    }

    flowSections.push(
      panelSection({
        title: "Source Context",
        lines: [
          `Type: ${resolveFindSourceTypeLabel(inventory.sourceType)}`,
          "Scope: all discovered SKILL.md entries",
        ],
        style: "square",
        minWidth: 74,
      })
    );

    flowSections.push(
      panelSection({
        title: "Match Summary",
        lines: [
          `Found ${filtered.length} matching skill${
            filtered.length === 1 ? "" : "s"
          }`,
          "Sorted by install name",
        ],
        style: "square",
        minWidth: 74,
      })
    );

    if (filtered.length > 0) {
      const lines: string[] = [];
      for (const item of filtered) {
        lines.push(item.name);
        lines.push(`  ${item.description}`);
        lines.push("");
      }
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      flowSections.push(
        panelSection({
          title: "Matching Skills",
          lines,
          style: "square",
          minWidth: 74,
        })
      );

      const suggestedSkill = filtered[0].name;
      flowSections.push(
        panelSection({
          title: "Suggested Next Step",
          lines: [`  skills add ${source} --skill ${suggestedSkill}`],
          style: "square",
          minWidth: 74,
        })
      );
    }

    const trailingLines: string[] = [
      `  Source: ${source}`,
      `  Found ${filtered.length} skill${filtered.length === 1 ? "" : "s"}`,
      "",
    ];
    if (filtered.length === 0) {
      trailingLines.push("No matching skills found.");
      await renderStaticScreen([...flowSections, linesSection(trailingLines)]);
      return;
    }

    await renderStaticScreen([...flowSections, linesSection(trailingLines)]);
  } finally {
    hideLoader();
  }
}

function configureFindCommand(
  command: Command,
  action: (
    source: string,
    query: string | undefined,
    options: FindCommanderOptions
  ) => Promise<void>
): Command {
  return command
    .description("Find skills in a source by optional query")
    .argument("<source>", "Source path or URL")
    .argument("[query]", "Optional search query")
    .option("--allow-host <hosts...>", "Restrict well-known hosts to allowlist")
    .option("--deny-host <hosts...>", "Block specific well-known hosts")
    .option("--max-download-bytes <n>", "Set well-known download budget")
    .action(action);
}

export function registerFindCommand(
  program: Command,
  ctx: CliCommandContext
): void {
  configureFindCommand(
    program.command("find"),
    ctx.wrapAction(
      "find",
      async (
        source: string,
        query: string | undefined,
        options: FindCommanderOptions
      ) => {
        await executeFind(source, query, {
          ...toFindOptions(options),
          experimental: ctx.experimental,
        });
      }
    )
  );
}

export async function runFind(args: string[]): Promise<void> {
  const command = configureFindCommand(
    new Command().name("find"),
    async (source, query, options) => {
      await executeFind(source, query, toFindOptions(options));
    }
  );
  await parseStandaloneCommand(command, args);
}
