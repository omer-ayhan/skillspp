import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installPlugin } from "./installer";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("installPlugin @unit", () => {
  it("installs plugin payloads into plugin cache directories only @unit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skillspp-plugin-"));
    tempDirs.push(root);

    const sourceDir = path.join(root, "source", "plugin-alpha");
    fs.mkdirSync(path.join(sourceDir, "agents", "codex"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "agents", "codex", "plugin.json"),
      JSON.stringify({
        name: "plugin-alpha",
        description: "plugin fixture",
      }),
      "utf8",
    );

    const outcome = installPlugin(
      {
        name: "plugin-alpha",
        description: "plugin fixture",
        path: sourceDir,
      },
      ["codex", "claude-code"],
      {
        mode: "copy",
        globalInstall: false,
        cwd: root,
      },
    );

    expect(outcome.skillName).toBe("plugin-alpha");
    expect(outcome.installedTo).toHaveLength(2);
    expect(
      fs.existsSync(
        path.join(
          root,
          ".agents",
          "plugins",
          "cache",
          "plugin-alpha",
          "agents",
          "codex",
          "plugin.json",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          root,
          ".claude",
          "plugins",
          "cache",
          "plugin-alpha",
          "agents",
          "codex",
          "plugin.json",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agents", "skills", "plugin-alpha")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(root, ".claude", "skills", "plugin-alpha")),
    ).toBe(false);
  });
});
