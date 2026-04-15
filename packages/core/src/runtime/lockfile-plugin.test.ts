import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCanonicalResourceDirs,
  readResourceLockfile,
  writeResourceLockfile,
  type LockEntry,
} from "./lockfile";

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

function makeEntry(name: string, canonicalDir: string): LockEntry {
  return {
    skillName: name,
    global: false,
    installMode: "copy",
    agents: ["codex"],
    canonicalDir,
    source: {
      input: canonicalDir,
      type: "local",
      canonical: canonicalDir,
      resolvedPath: canonicalDir,
      isSymlinkSource: false,
      selector: {
        skillName: name,
        relativePath: ".",
      },
    },
    sourceHash: `${name}-source`,
    installedHash: `${name}-installed`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("plugin lockfile discovery @unit", () => {
  it("reads plugin lockfiles from plugin cache directories only @unit", () => {
    const root = makeTempDir("skillspp-plugin-lockfile-");
    const pluginDir = path.join(root, ".agents", "plugins", "cache", "plugin-alpha");
    fs.mkdirSync(pluginDir, { recursive: true });
    writeResourceLockfile(
      "plugin",
      false,
      root,
      {
        version: 1,
        entries: [makeEntry("plugin-alpha", pluginDir)],
      },
      "json",
    );

    const skillDir = path.join(root, ".agents", "skills", "skill-shadow");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "skillspp-lock.json"),
      JSON.stringify(
        {
          version: 1,
          entry: makeEntry("skill-shadow", skillDir),
        },
        null,
        2,
      ),
      "utf8",
    );

    const lock = readResourceLockfile("plugin", false, root);

    expect(lock.entries.map((entry) => entry.skillName)).toEqual(["plugin-alpha"]);
    expect(listCanonicalResourceDirs("plugin", false, root)).toEqual(["plugin-alpha"]);
  });
});
