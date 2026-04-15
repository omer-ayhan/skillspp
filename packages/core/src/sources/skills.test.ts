import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSourceLabel, stageRemoteSkillFilesToTempDir } from "./skills";

describe("source label resolver @unit", () => {
  it("returns source labels for each parsed source type @unit", () => {
    expect(resolveSourceLabel({ type: "local", localPath: "/tmp/skills" })).toBe("/tmp/skills");
    expect(
      resolveSourceLabel({
        type: "github",
        repoUrl: "https://github.com/acme/repo.git",
      }),
    ).toBe("https://github.com/acme/repo.git");
    expect(resolveSourceLabel({ type: "git", repoUrl: "https://gitlab.com/acme/repo.git" })).toBe(
      "https://gitlab.com/acme/repo.git",
    );
    expect(resolveSourceLabel({ type: "well-known", url: "https://example.com/skills" })).toBe(
      "https://example.com/skills",
    );
    expect(resolveSourceLabel({ type: "catalog", url: "https://catalog.example.com" })).toBe(
      "https://catalog.example.com",
    );
  });
});

describe("remote staging helper @unit", () => {
  it("stages valid remote files with UTF-8 content @unit", () => {
    const staged = stageRemoteSkillFilesToTempDir(
      new Map([
        ["SKILL.md", "# Skill\ncontent"],
        ["references/setup.md", "setup docs"],
      ]),
    );

    try {
      expect(fs.readFileSync(path.join(staged.path, "SKILL.md"), "utf8")).toBe("# Skill\ncontent");
      expect(fs.readFileSync(path.join(staged.path, "references/setup.md"), "utf8")).toBe(
        "setup docs",
      );
    } finally {
      staged.cleanup();
    }
  });

  it("rejects unsafe traversal paths @unit", () => {
    expect(() =>
      stageRemoteSkillFilesToTempDir(
        new Map([
          ["../outside.md", "nope"],
          ["SKILL.md", "ok"],
        ]),
      ),
    ).toThrow("Unsafe remote skill file path");
  });

  it("cleans up staged temp directories @unit", () => {
    const staged = stageRemoteSkillFilesToTempDir(new Map([["SKILL.md", "cleanup"]]));
    expect(fs.existsSync(staged.path)).toBe(true);

    staged.cleanup();

    expect(fs.existsSync(staged.path)).toBe(false);
  });
});
