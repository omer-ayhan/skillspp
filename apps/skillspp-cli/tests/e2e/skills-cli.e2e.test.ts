import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type RunResult = {
  code: number;
  output: string;
};

function runCommand(cwd: string, args: string[]): Promise<RunResult> {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const tsxPath = path.resolve(appRoot, "node_modules/tsx/dist/cli.mjs");
  const cliEntry = path.resolve(appRoot, "src/cli.ts");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxPath, cliEntry, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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

function assertContains(output: string, expected: string): void {
  expect(output).toContain(expected);
}

function assertNotContains(output: string, expected: string): void {
  expect(output).not.toContain(expected);
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || "git command failed"}`.trim();
    throw new Error(detail);
  }
  return `${result.stdout || ""}`.trim();
}

describe("skills CLI critical workflows @e2e", () => {
  it("covers init/add/list/find/check/update/validate/remove end-to-end @e2e @critical", async () => {
    const workdir = fs.mkdtempSync(path.join(process.cwd(), "tmp-skillspp-cli-"));
    try {
      const projectDir = path.join(workdir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      const sourceRoot = path.join(projectDir, "local-source");
      const skillName = "installer-test-skill";
      const sourceSkillDir = path.join(sourceRoot, skillName);
      fs.mkdirSync(sourceSkillDir, { recursive: true });

      fs.writeFileSync(
        path.join(sourceSkillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: installer integration test fixture\n---\n\n# ${skillName}\n\nUse this fixture for smoke test coverage.\n`,
        "utf8",
      );

      const initOut = await runCommand(projectDir, [
        "init",
        "smoke-skill",
        "--agent",
        "codex",
        "--non-interactive",
      ]);
      assertContains(initOut.output, "Scaffold Summary");
      assertContains(initOut.output, "Choose Agents");
      assertContains(initOut.output, "Initialized skill:");

      const addOut = await runCommand(projectDir, [
        "add",
        sourceRoot,
        "--agent",
        "claude-code",
        "--skill",
        skillName,
        "--non-interactive",
      ]);
      assertContains(addOut.output, "Installed 1 skill");
      expect(
        fs.existsSync(path.join(projectDir, ".claude", "skills", skillName, "skillspp-lock.json")),
      ).toBe(true);
      expect(fs.existsSync(path.join(projectDir, ".agents", "skills", skillName))).toBe(false);

      const listOut = await runCommand(projectDir, [
        "list",
        "--agent",
        "claude-code",
        "--non-interactive",
      ]);
      assertContains(listOut.output, "Installed Skills");

      const findOut = await runCommand(projectDir, ["find", sourceRoot, "installer"]);
      assertContains(findOut.output, "Matching Skills");

      const checkOut = await runCommand(projectDir, ["check"]);
      assertContains(checkOut.output, "drift assessed");

      fs.writeFileSync(
        path.join(sourceSkillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: installer integration test fixture updated\n---\n\n# ${skillName}\n\nUpdated fixture for smoke test coverage.\n`,
        "utf8",
      );

      const updateOut = await runCommand(projectDir, ["update", "--non-interactive"]);
      assertContains(updateOut.output, "Updated 1 skills.");

      const validateOut = await runCommand(projectDir, ["validate", sourceRoot]);
      assertContains(validateOut.output, "Validation Summary");
      assertContains(validateOut.output, "Errors: 0");

      const validateJsonOut = await runCommand(projectDir, ["validate", sourceRoot, "--json"]);
      expect(validateJsonOut.output).toMatch(/"ok"\s*:\s*true/);
      assertNotContains(validateJsonOut.output, "SKILLS · VALIDATE FLOW");

      const removeOut = await runCommand(projectDir, [
        "remove",
        skillName,
        "--agent",
        "claude-code",
        "--non-interactive",
      ]);
      assertContains(removeOut.output, "Total removed: 1");

      const addGooseOut = await runCommand(projectDir, [
        "add",
        sourceRoot,
        "--agent",
        "goose",
        "--skill",
        skillName,
        "--non-interactive",
      ]);
      assertContains(addGooseOut.output, "Installed 1 skill");
      expect(
        fs.existsSync(path.join(projectDir, ".goose", "skills", skillName, "skillspp-lock.json")),
      ).toBe(true);

      const removeGooseOut = await runCommand(projectDir, [
        "remove",
        skillName,
        "--agent",
        "goose",
        "--non-interactive",
      ]);
      assertContains(removeGooseOut.output, ".goose/skills");
      assertNotContains(removeGooseOut.output, ".config/goose/skills");
      assertContains(removeGooseOut.output, "Total removed: 1");
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);

  it("enforces migrate-required check/update flow and allows add reinstall from new source @e2e @critical", async () => {
    const workdir = fs.mkdtempSync(path.join(process.cwd(), "tmp-skillspp-cli-migrate-"));
    try {
      const projectDir = path.join(workdir, "project");
      fs.mkdirSync(projectDir, { recursive: true });

      const sourceA = path.join(projectDir, "source-a");
      const sourceB = path.join(projectDir, "source-b");
      const sourceC = path.join(projectDir, "source-c");
      const skillName = "migrate-skill";

      fs.mkdirSync(path.join(sourceA, skillName), { recursive: true });
      fs.writeFileSync(
        path.join(sourceA, skillName, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: migrate test source a\n---\n\n# ${skillName}\n`,
        "utf8",
      );

      const addOut = await runCommand(projectDir, [
        "add",
        sourceA,
        "--agent",
        "claude-code",
        "--skill",
        skillName,
        "--non-interactive",
      ]);
      assertContains(addOut.output, "Installed 1 skill");

      fs.mkdirSync(path.join(sourceB, skillName), { recursive: true });
      fs.writeFileSync(
        path.join(sourceB, skillName, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: migrate test source b\n---\n\n# ${skillName}\n\nmigrated source\n`,
        "utf8",
      );

      fs.rmSync(sourceA, { recursive: true, force: true });

      const checkOut = await runCommand(projectDir, ["check"]);
      assertContains(checkOut.output, "migrate-required");
      assertContains(checkOut.output, `skillspp update ${skillName} --migrate <new-skill-source>`);

      const migrateOut = await runCommand(projectDir, [
        "update",
        skillName,
        "--migrate",
        sourceB,
        "--non-interactive",
      ]);
      assertContains(migrateOut.output, "Migration complete.");
      assertContains(migrateOut.output, `Updated ${skillName}.`);

      fs.mkdirSync(path.join(sourceC, skillName), { recursive: true });
      fs.writeFileSync(
        path.join(sourceC, skillName, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: migrate test source c\n---\n\n# ${skillName}\n\nthird source\n`,
        "utf8",
      );

      const addReinstall = await runCommand(projectDir, [
        "add",
        sourceC,
        "--agent",
        "claude-code",
        "--skill",
        skillName,
        "--non-interactive",
      ]);
      assertContains(addReinstall.output, "Installed 1 skill");
      const reinstalledSkill = fs.readFileSync(
        path.join(projectDir, ".claude", "skills", skillName, "SKILL.md"),
        "utf8",
      );
      expect(reinstalledSkill).toContain("third source");
      const rewrittenLock = JSON.parse(
        fs.readFileSync(
          path.join(projectDir, ".claude", "skills", skillName, "skillspp-lock.json"),
          "utf8",
        ),
      );
      expect(rewrittenLock.entry?.source?.canonical).toBe(sourceC);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);

  it("detects git remote changes via check/update and refreshes pinnedRef @e2e @critical", async () => {
    const workdir = fs.mkdtempSync(path.join(process.cwd(), "tmp-skillspp-cli-remote-git-"));
    try {
      const projectDir = path.join(workdir, "project");
      const remoteRepo = path.join(workdir, "remote-repo");
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(remoteRepo, { recursive: true });

      runGit(remoteRepo, ["init"]);
      runGit(remoteRepo, ["config", "user.email", "skillspp@example.com"]);
      runGit(remoteRepo, ["config", "user.name", "SkillsPP Test"]);

      const skillName = "remote-git-skill";
      const remoteSkillDir = path.join(remoteRepo, skillName);
      fs.mkdirSync(remoteSkillDir, { recursive: true });
      fs.writeFileSync(
        path.join(remoteSkillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: git remote source v1\n---\n\n# ${skillName}\n\nremote version one\n`,
        "utf8",
      );
      runGit(remoteRepo, ["add", "."]);
      runGit(remoteRepo, ["commit", "-m", "initial skill"]);
      const firstRef = runGit(remoteRepo, ["rev-parse", "HEAD"]);

      const remoteSource = `file://${remoteRepo}`;
      const addOut = await runCommand(projectDir, [
        "add",
        remoteSource,
        "--agent",
        "claude-code",
        "--skill",
        skillName,
        "--non-interactive",
      ]);
      assertContains(addOut.output, "Installed 1 skill");

      const lockPath = path.join(projectDir, ".claude", "skills", skillName, "skillspp-lock.json");
      const firstLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      expect(firstLock.entry?.source?.pinnedRef).toBe(firstRef);

      fs.writeFileSync(
        path.join(remoteSkillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: git remote source v2\n---\n\n# ${skillName}\n\nremote version two\n`,
        "utf8",
      );
      runGit(remoteRepo, ["add", "."]);
      runGit(remoteRepo, ["commit", "-m", "update remote skill"]);
      const secondRef = runGit(remoteRepo, ["rev-parse", "HEAD"]);
      expect(secondRef).not.toBe(firstRef);

      const checkOut = await runCommand(projectDir, ["check"]);
      assertContains(checkOut.output, "changed-source");
      assertNotContains(checkOut.output, "migrate-required");

      const updateOut = await runCommand(projectDir, ["update", "--non-interactive"]);
      assertContains(updateOut.output, "Updated 1 skills.");

      const installedSkillText = fs.readFileSync(
        path.join(projectDir, ".claude", "skills", skillName, "SKILL.md"),
        "utf8",
      );
      expect(installedSkillText).toContain("remote version two");

      const secondLock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      expect(secondLock.entry?.source?.pinnedRef).toBe(secondRef);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);
});
