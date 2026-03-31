import { type Command } from "commander";
import picocolors from "picocolors";
import { isAgent } from "@skillspp/core/agents";
import { type CliCommandContext } from "../command-builder";

export function registerAddCommand(
  program: Command,
  context: CliCommandContext,
): void {
  program
    .command("add")
    .description("Add one or more AI agent plugins from a source directory")
    .argument("<source>", "Path to the plugins source directory (e.g. ./plugins)")
    .option("-a, --agent <agent...>", "Agent name(s) to install for (e.g. codex claude-code). Use '*' for all.")
    .option("-g, --global", "Install globally (user home directory)")
    .option("--non-interactive", "Disable all prompts")
    .action(
      context.wrapAction("add", async (source: string, options: { agent?: string[]; global?: boolean; nonInteractive?: boolean }) => {
        const agents = options.agent ?? [];

        if (!agents.includes("*")) {
          for (const name of agents) {
            if (!isAgent(name)) {
              throw new Error(`Unknown agent: ${name}`);
            }
          }
        }

        const { AddPluginService } = await import("@skillspp/core");
        const { createNodeCoreCommandPort } = await import("@skillspp/platform-node");
        const port = createNodeCoreCommandPort();
        const service = new AddPluginService(port);
        const result = await service.execute({
          source,
          agents,
          global: options.global,
          nonInteractive: options.nonInteractive,
        });

        for (const name of result.installedPlugins) {
          process.stdout.write(picocolors.green(`✔ Installed agent: ${name}\n`));
        }
        for (const name of result.skippedPlugins) {
          process.stdout.write(picocolors.yellow(`- Skipped agent (already exists): ${name}\n`));
        }
        for (const { name, reason } of result.failedPlugins) {
          process.stderr.write(picocolors.red(`✖ Failed agent: ${name} — ${reason}\n`));
        }

        if (result.failedPlugins.length > 0) {
          throw new Error(
            `Failed to install ${result.failedPlugins.length} agent(s): ${result.failedPlugins.map((f) => f.name).join(", ")}`,
          );
        }
      }),
    );
}
