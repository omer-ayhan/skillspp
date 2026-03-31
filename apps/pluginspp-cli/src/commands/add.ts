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
    .description("Add one or more AI agent plugins")
    .argument("<plugin...>", "Plugin name(s) to add (e.g. codex, claude-code, gemini-cli, cursor). Use '*' to add all.")
    .option("-g, --global", "Install globally (user home directory)")
    .option("--non-interactive", "Disable all prompts")
    .action(
      context.wrapAction("add", async (plugins: string[], options: { global?: boolean; nonInteractive?: boolean }) => {
        if (!plugins.includes("*")) {
          for (const name of plugins) {
            if (!isAgent(name)) {
              throw new Error(`Unknown plugin: ${name}`);
            }
          }
        }

        const { AddPluginService } = await import("@skillspp/core");
        const { createNodeCoreCommandPort } = await import("@skillspp/platform-node");
        const port = createNodeCoreCommandPort();
        const service = new AddPluginService(port);
        const result = await service.execute({
          plugins,
          global: options.global,
          nonInteractive: options.nonInteractive,
        });

        for (const name of result.installedPlugins) {
          process.stdout.write(picocolors.green(`✔ Installed plugin: ${name}\n`));
        }
        for (const name of result.skippedPlugins) {
          process.stdout.write(picocolors.yellow(`- Skipped plugin (already exists): ${name}\n`));
        }
        for (const { name, reason } of result.failedPlugins) {
          process.stderr.write(picocolors.red(`✖ Failed plugin: ${name} — ${reason}\n`));
        }

        if (result.failedPlugins.length > 0) {
          throw new Error(
            `Failed to install ${result.failedPlugins.length} plugin(s): ${result.failedPlugins.map((f) => f.name).join(", ")}`,
          );
        }
      }),
    );
}
