import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type RunResult = {
  code: number;
  output: string;
};

type PluginFixture = {
  folderName: string;
  manifestName?: string;
  description?: string;
  manifestPath?: string;
  writeManifest?: boolean;
};

function runCli(
  cwd: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
  const appRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const tsxPath = path.resolve(appRoot, "node_modules/tsx/dist/cli.mjs");
  const cliEntry = path.resolve(appRoot, "src/cli.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxPath, cliEntry, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));

    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code: code ?? 1,
        output: `${Buffer.concat(out).toString("utf8")}${Buffer.concat(err).toString("utf8")}`,
      });
    });
  });
}

function createPluginSourceRepo(
  workdir: string,
  fixtures: PluginFixture[],
): { repoRoot: string; pluginsRoot: string } {
  const repoRoot = path.join(workdir, "plugins-source");
  const pluginsRoot = path.join(repoRoot, "plugins");

  for (const fixture of fixtures) {
    const pluginDir = path.join(pluginsRoot, fixture.folderName);
    fs.mkdirSync(pluginDir, { recursive: true });
    if (fixture.writeManifest === false) {
      fs.writeFileSync(
        path.join(pluginDir, "README.md"),
        "placeholder",
        "utf8",
      );
      continue;
    }

    const manifestPath = path.join(
      pluginDir,
      fixture.manifestPath || "agents/codex/plugin.json",
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        name: fixture.manifestName || fixture.folderName,
        description: fixture.description || "",
      }),
      "utf8",
    );
  }

  return { repoRoot, pluginsRoot };
}

describe("pluginspp binary @e2e", () => {
  it("resolves and returns help output in a clean temp directory @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-"),
    );
    try {
      const result = await runCli(workdir, ["--help"]);
      expect(result.code).toBe(0);
      expect(result.output).toContain("pluginspp");
      expect(result.output).toContain("add");
      expect(result.output).toContain("remove");
      expect(result.output).toContain("update");
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("lists plugins without installing them @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-list-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
        { folderName: "plugin-beta", description: "beta plugin" },
      ]);

      const result = await runCli(workdir, [
        "add",
        repoRoot,
        "--list",
        "--non-interactive",
      ]);

      expect(result.code).toBe(0);
      expect(result.output).toContain("plugin-alpha");
      expect(result.output).toContain("plugin-beta");
      expect(
        fs.existsSync(path.join(workdir, ".agents", "plugins", "cache")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(workdir, ".claude", "plugins", "cache")),
      ).toBe(false);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("accepts the plugins directory itself as the source @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-list-dir-"),
    );
    try {
      const { pluginsRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
      ]);

      const result = await runCli(workdir, [
        "add",
        pluginsRoot,
        "--list",
        "--non-interactive",
      ]);

      expect(result.code).toBe(0);
      expect(result.output).toContain("plugin-alpha");
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("installs the selected plugin into plugin cache directories only @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-install-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
        { folderName: "plugin-beta", description: "beta plugin" },
      ]);

      const result = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "claude-code",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(result.code).toBe(0);
      expect(result.output).toContain("Installed 1 plugin across 2 agents.");
      expect(
        fs.existsSync(
          path.join(
            workdir,
            ".agents",
            "plugins",
            "cache",
            "plugin-alpha",
            "skillspp-lock.json",
          ),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            workdir,
            ".claude",
            "plugins",
            "cache",
            "plugin-alpha",
            "skillspp-lock.json",
          ),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(workdir, ".agents", "skills", "plugin-alpha")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(workdir, ".claude", "skills", "plugin-alpha")),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(workdir, ".agents", "plugins", "cache", "plugin-beta"),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("removes an explicit plugin from an explicit agent without touching skills @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-remove-explicit-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
      ]);

      const addResult = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "claude-code",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(addResult.code).toBe(0);

      fs.mkdirSync(path.join(workdir, ".agents", "skills", "plugin-alpha"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workdir, ".agents", "skills", "plugin-alpha", "SKILL.md"),
        "# sentinel\n",
        "utf8",
      );
      fs.mkdirSync(path.join(workdir, ".claude", "skills", "plugin-alpha"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workdir, ".claude", "skills", "plugin-alpha", "SKILL.md"),
        "# sentinel\n",
        "utf8",
      );

      const removeResult = await runCli(workdir, [
        "remove",
        "--plugin",
        "plugin-alpha",
        "--agent",
        "codex",
        "--non-interactive",
      ]);

      expect(removeResult.code).toBe(0);
      expect(removeResult.output).toContain("Plugins (1):");
      expect(removeResult.output).toContain("Total removed: 1");
      expect(
        fs.existsSync(
          path.join(workdir, ".agents", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(workdir, ".claude", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(workdir, ".agents", "skills", "plugin-alpha")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(workdir, ".claude", "skills", "plugin-alpha")),
      ).toBe(true);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("removes the only installed plugin for an explicit agent in non-interactive mode @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-remove-single-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
      ]);

      const addResult = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(addResult.code).toBe(0);

      const removeResult = await runCli(workdir, [
        "remove",
        "--agent",
        "codex",
        "--non-interactive",
      ]);

      expect(removeResult.code).toBe(0);
      expect(removeResult.output).toContain("Total removed: 1");
      expect(
        fs.existsSync(
          path.join(workdir, ".agents", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails in non-interactive mode when installed plugin selection is ambiguous @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-remove-ambiguous-plugin-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
        { folderName: "plugin-beta", description: "beta plugin" },
      ]);

      const addAlpha = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);
      expect(addAlpha.code).toBe(0);

      const addBeta = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "--plugin",
        "plugin-beta",
        "--non-interactive",
      ]);
      expect(addBeta.code).toBe(0);

      const removeResult = await runCli(workdir, [
        "remove",
        "--agent",
        "codex",
        "--non-interactive",
      ]);

      expect(removeResult.code).toBe(1);
      expect(removeResult.output).toContain(
        "Multiple installed plugins found. Use --plugin <name>... or run in TTY without --non-interactive.",
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails in non-interactive mode when one plugin is installed across multiple agents @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-remove-ambiguous-agent-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
      ]);

      const addResult = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "claude-code",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(addResult.code).toBe(0);

      const removeResult = await runCli(workdir, [
        "remove",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(removeResult.code).toBe(1);
      expect(removeResult.output).toContain(
        "Multiple agents found. Use --agent <name>... or run in TTY without --non-interactive.",
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("uses detected agents for wildcard installs in global mode @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-global-"),
    );
    try {
      const homeDir = path.join(workdir, "home");
      fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });
      fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });

      const { pluginsRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
      ]);

      const result = await runCli(
        workdir,
        [
          "add",
          pluginsRoot,
          "--agent",
          "*",
          "--plugin",
          "plugin-alpha",
          "--global",
          "--non-interactive",
        ],
        {
          HOME: homeDir,
        },
      );

      expect(result.code).toBe(0);
      expect(
        fs.existsSync(
          path.join(homeDir, ".claude", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(homeDir, ".codex", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(homeDir, ".cursor", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("removes only global plugin installs when --global is set @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-remove-global-"),
    );
    try {
      const homeDir = path.join(workdir, "home");
      fs.mkdirSync(path.join(homeDir, ".codex"), { recursive: true });

      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
      ]);

      const addResult = await runCli(
        workdir,
        [
          "add",
          repoRoot,
          "--agent",
          "codex",
          "--plugin",
          "plugin-alpha",
          "--global",
          "--non-interactive",
        ],
        {
          HOME: homeDir,
        },
      );

      expect(addResult.code).toBe(0);

      fs.mkdirSync(
        path.join(workdir, ".agents", "plugins", "cache", "plugin-alpha"),
        { recursive: true },
      );
      fs.writeFileSync(
        path.join(
          workdir,
          ".agents",
          "plugins",
          "cache",
          "plugin-alpha",
          "sentinel.txt",
        ),
        "keep local\n",
        "utf8",
      );

      const removeResult = await runCli(
        workdir,
        [
          "remove",
          "--plugin",
          "plugin-alpha",
          "--agent",
          "codex",
          "--global",
          "--non-interactive",
        ],
        {
          HOME: homeDir,
        },
      );

      expect(removeResult.code).toBe(0);
      expect(removeResult.output).toContain("Total removed: 1");
      expect(
        fs.existsSync(
          path.join(homeDir, ".codex", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(false);
      expect(
        fs.existsSync(
          path.join(workdir, ".agents", "plugins", "cache", "plugin-alpha"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails in non-interactive mode when plugin selection is ambiguous @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-noninteractive-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", description: "alpha plugin" },
        { folderName: "plugin-beta", description: "beta plugin" },
      ]);

      const result = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "--non-interactive",
      ]);

      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "Multiple plugins found. Use --plugin <name> or run in TTY without --non-interactive.",
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails when the selected plugin folder has no plugin.json @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-missing-manifest-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        { folderName: "plugin-alpha", writeManifest: false },
      ]);

      const result = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "Plugin 'plugin-alpha' is missing plugin.json",
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails when plugin.json name does not match the plugin folder @e2e", async () => {
    const workdir = fs.mkdtempSync(
      path.join(process.cwd(), "tmp-plugins-cli-name-mismatch-"),
    );
    try {
      const { repoRoot } = createPluginSourceRepo(workdir, [
        {
          folderName: "plugin-alpha",
          manifestName: "plugin-beta",
          description: "wrong plugin name",
        },
      ]);

      const result = await runCli(workdir, [
        "add",
        repoRoot,
        "--agent",
        "codex",
        "--plugin",
        "plugin-alpha",
        "--non-interactive",
      ]);

      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "Plugin 'plugin-alpha' plugin.json name must match plugin folder name",
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 30_000);
});
