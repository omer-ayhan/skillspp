import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeBackgroundTask } from "./background-tasks";
import type { PluginUpdateApplyTaskResult } from "./background-task-contracts";
import { hashDirectory } from "./hash";
import { installPlugin } from "./installer";
import { readResourceLockfile, writeResourceLockfile, type LockEntry } from "./lockfile";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writePluginSourceFile(
  repoRoot: string,
  pluginName: string,
  relativePath: string,
  content: string,
): void {
  const filePath = path.join(repoRoot, "plugins", pluginName, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function createPluginSourceRepo(root: string, pluginName: string): string {
  const repoRoot = path.join(root, "plugin-source");
  writePluginSourceFile(
    repoRoot,
    pluginName,
    "agents/codex/plugin.json",
    JSON.stringify({
      name: pluginName,
      description: `${pluginName} plugin`,
    }),
  );
  return repoRoot;
}

function buildPluginLockEntry(options: {
  pluginName: string;
  repoRoot: string;
  pluginPath: string;
  canonicalDir: string;
}): LockEntry {
  return {
    skillName: options.pluginName,
    global: false,
    installMode: "copy",
    agents: ["codex"],
    canonicalDir: options.canonicalDir,
    source: {
      input: options.repoRoot,
      type: "local",
      canonical: options.repoRoot,
      resolvedPath: fs.realpathSync(options.pluginPath),
      isSymlinkSource: false,
      selector: {
        skillName: options.pluginName,
        relativePath: path.relative(options.repoRoot, options.pluginPath) || ".",
      },
    },
    sourceHash: hashDirectory(options.pluginPath),
    installedHash: hashDirectory(options.canonicalDir),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("plugin update background task @unit", () => {
  it("applies changed local plugin sources and refreshes the plugin lockfile @unit", async () => {
    const root = makeTempDir("skillspp-plugin-update-");
    const repoRoot = createPluginSourceRepo(root, "plugin-alpha");
    const pluginPath = path.join(repoRoot, "plugins", "plugin-alpha");
    writePluginSourceFile(repoRoot, "plugin-alpha", "README.md", "alpha v1\n");

    const outcome = installPlugin(
      {
        name: "plugin-alpha",
        description: "plugin-alpha plugin",
        path: pluginPath,
      },
      ["codex"],
      {
        mode: "copy",
        globalInstall: false,
        cwd: root,
      },
    );

    writeResourceLockfile(
      "plugin",
      false,
      root,
      {
        version: 1,
        entries: [
          buildPluginLockEntry({
            pluginName: "plugin-alpha",
            repoRoot,
            pluginPath,
            canonicalDir: outcome.canonicalDir,
          }),
        ],
      },
      "json",
    );

    writePluginSourceFile(repoRoot, "plugin-alpha", "README.md", "alpha v2\n");

    const result = (await executeBackgroundTask(
      {
        kind: "plugin.update.apply",
        payload: {
          cwd: root,
          options: {
            skill: ["plugin-alpha"],
          },
          selectedPluginNames: ["plugin-alpha"],
          lockFormat: "json",
        },
      },
      () => {},
    )) as PluginUpdateApplyTaskResult;

    expect(result.updatedPluginNames).toEqual(["plugin-alpha"]);
    expect(fs.readFileSync(path.join(outcome.canonicalDir, "README.md"), "utf8")).toBe(
      "alpha v2\n",
    );

    const [updatedEntry] = readResourceLockfile("plugin", false, root).entries;
    expect(updatedEntry?.skillName).toBe("plugin-alpha");
    expect(updatedEntry?.sourceHash).toBe(hashDirectory(pluginPath));
    expect(updatedEntry?.installedHash).toBe(hashDirectory(outcome.canonicalDir));
  });
});
