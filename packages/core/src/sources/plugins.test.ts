import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverPlugins,
  resolvePluginsRoot,
  stageRemotePluginFilesToTempDir,
} from "./plugins";

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

function writePluginManifest(
  repoRoot: string,
  pluginName: string,
  relativePath: string,
  manifest: Record<string, unknown>,
): void {
  const manifestPath = path.join(repoRoot, "plugins", pluginName, relativePath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

describe("plugin discovery @unit", () => {
  it("resolves repo roots and direct plugins directories @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugins-root-");
    const pluginsRoot = path.join(repoRoot, "plugins");
    fs.mkdirSync(pluginsRoot, { recursive: true });

    expect(resolvePluginsRoot(repoRoot)).toBe(pluginsRoot);
    expect(resolvePluginsRoot(pluginsRoot)).toBe(pluginsRoot);
  });

  it("discovers plugins by nested plugin.json and returns the top-level folder @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugin-discover-");
    writePluginManifest(repoRoot, "plugin-alpha", "codex/plugin.json", {
      name: "plugin-alpha",
      description: "alpha plugin",
    });

    const plugins = discoverPlugins(repoRoot);

    expect(plugins).toEqual([
      {
        name: "plugin-alpha",
        description: "alpha plugin",
        path: path.join(repoRoot, "plugins", "plugin-alpha"),
      },
    ]);
  });

  it("ignores invalid plugin folders until they are requested explicitly @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugin-invalid-ignore-");
    writePluginManifest(repoRoot, "plugin-alpha", "codex/plugin.json", {
      name: "plugin-alpha",
      description: "alpha plugin",
    });
    fs.mkdirSync(path.join(repoRoot, "plugins", "plugin-bad"), {
      recursive: true,
    });

    expect(discoverPlugins(repoRoot)).toHaveLength(1);
    expect(() => discoverPlugins(repoRoot, ["plugin-bad"])).toThrow(
      "Plugin 'plugin-bad' is missing plugin.json",
    );
  });

  it("fails when plugin.json contains invalid JSON @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugin-invalid-json-");
    const manifestPath = path.join(
      repoRoot,
      "plugins",
      "plugin-alpha",
      "codex",
      "plugin.json",
    );
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, "{ invalid", "utf8");

    expect(() => discoverPlugins(repoRoot, ["plugin-alpha"])).toThrow(
      "Plugin 'plugin-alpha' has invalid plugin.json",
    );
  });

  it("fails when plugin.json name does not match the plugin folder @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugin-name-mismatch-");
    writePluginManifest(repoRoot, "plugin-alpha", "claude/plugin.json", {
      name: "plugin-beta",
      description: "wrong plugin name",
    });

    expect(() => discoverPlugins(repoRoot, ["plugin-alpha"])).toThrow(
      "Plugin 'plugin-alpha' plugin.json name must match plugin folder name",
    );
  });

  it("chooses the shallowest manifest description deterministically @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugin-description-");
    writePluginManifest(repoRoot, "plugin-alpha", "b/plugin.json", {
      name: "plugin-alpha",
      description: "from-b",
    });
    writePluginManifest(repoRoot, "plugin-alpha", "a/plugin.json", {
      name: "plugin-alpha",
      description: "from-a",
    });
    writePluginManifest(repoRoot, "plugin-alpha", "nested/deeper/plugin.json", {
      name: "plugin-alpha",
      description: "from-deeper",
    });

    const [plugin] = discoverPlugins(repoRoot, ["plugin-alpha"]);
    expect(plugin?.description).toBe("from-a");
  });

  it("does not read skill directories or SKILL.md files during plugin discovery @unit", () => {
    const repoRoot = makeTempDir("skillspp-plugin-regression-");
    fs.mkdirSync(path.join(repoRoot, "skills", "skill-alpha"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, ".agents", "skills", "skill-beta"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(repoRoot, "skills", "skill-alpha", "SKILL.md"),
      "---\nname: skill-alpha\ndescription: skill alpha\n---\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(repoRoot, ".agents", "skills", "skill-beta", "SKILL.md"),
      "---\nname: skill-beta\ndescription: skill beta\n---\n",
      "utf8",
    );
    writePluginManifest(repoRoot, "plugin-alpha", "agents/codex/plugin.json", {
      name: "plugin-alpha",
      description: "plugin alpha",
    });

    const plugins = discoverPlugins(repoRoot);

    expect(plugins.map((plugin) => plugin.name)).toEqual(["plugin-alpha"]);
  });
});

describe("remote plugin staging @unit", () => {
  it("stages remote plugin files under plugins/<name> @unit", () => {
    const staged = stageRemotePluginFilesToTempDir(
      "plugin-alpha",
      new Map([
        ["codex/plugin.json", '{"name":"plugin-alpha"}'],
        ["README.md", "docs"],
      ]),
    );

    try {
      expect(
        fs.readFileSync(
          path.join(staged.path, "plugins", "plugin-alpha", "codex", "plugin.json"),
          "utf8",
        ),
      ).toContain('"name":"plugin-alpha"');
      expect(
        fs.readFileSync(
          path.join(staged.path, "plugins", "plugin-alpha", "README.md"),
          "utf8",
        ),
      ).toBe("docs");
    } finally {
      staged.cleanup();
    }
  });
});
