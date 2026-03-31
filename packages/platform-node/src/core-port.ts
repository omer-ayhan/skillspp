import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type AddPluginCommand,
  type AddSkillCommand,
  type CheckSkillCommand,
  type FindSkillCommand,
  type InitSkillCommand,
  type ListSkillCommand,
  type RemoveSkillCommand,
  type UpdateSkillCommand,
  type ValidateSkillCommand,
} from "@skillspp/core/commands";
import {
  type AddPluginResult,
  type AddSkillResult,
  type CheckSkillResult,
  type FindSkillResult,
  type InitSkillResult,
  type ListSkillResult,
  type RemoveSkillResult,
  type UpdateSkillResult,
  type ValidationDiagnostic,
  type ValidationReport,
} from "@skillspp/core/results";
import { CoreError } from "@skillspp/core/errors";
import { type CoreCommandPort } from "@skillspp/core";
import { AGENTS, isAgent } from "@skillspp/core/agents";

function collectSkillMarkdownFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(fullPath);
      }
    }
  }
  return out;
}

function extractFrontmatter(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return "";
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 3 || lines[0] !== "---") {
    return "";
  }
  const end = lines.indexOf("---", 1);
  if (end <= 1) {
    return "";
  }
  return lines.slice(1, end).join("\n");
}

function addDiagnostic(
  diagnostics: ValidationDiagnostic[],
  item: ValidationDiagnostic
): void {
  diagnostics.push(item);
}

async function runValidate(
  command: ValidateSkillCommand
): Promise<ValidationReport> {
  const diagnostics: ValidationDiagnostic[] = [];

  const roots = command.ci
    ? command.roots && command.roots.length > 0
      ? command.roots
      : [process.cwd()]
    : command.source
    ? [command.source]
    : [];

  if (roots.length === 0) {
    throw new CoreError({
      code: "VALIDATION_MISSING_SOURCE",
      message: "validate requires a source unless CI mode is enabled",
    });
  }

  const maxLines = command.maxLines || 500;
  const maxDescriptionChars = command.maxDescriptionChars || 1024;

  for (const rawRoot of roots) {
    const root = path.resolve(rawRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new CoreError({
        code: "SOURCE_NOT_FOUND",
        message: `Local source not found: ${root}`,
      });
    }

    const skillFiles = collectSkillMarkdownFiles(root);
    if (skillFiles.length === 0) {
      addDiagnostic(diagnostics, {
        severity: "error",
        skill: path.basename(root),
        file: root,
        rule: "no-skills-discovered",
        message: "no SKILL.md files discovered",
      });
      continue;
    }

    for (const skillMd of skillFiles) {
      const content = fs.readFileSync(skillMd, "utf8");
      const lines = content.split(/\r?\n/);
      const skillName = path.basename(path.dirname(skillMd));
      const frontmatter = extractFrontmatter(content);

      if (lines.length > maxLines) {
        addDiagnostic(diagnostics, {
          severity: command.strict ? "error" : "warning",
          skill: skillName,
          file: skillMd,
          rule: "line-budget",
          message: `SKILL.md has ${lines.length} lines (limit ${maxLines})`,
        });
      }

      if (!frontmatter) {
        addDiagnostic(diagnostics, {
          severity: "error",
          skill: skillName,
          file: skillMd,
          rule: "invalid-frontmatter",
          message: "SKILL.md frontmatter is required",
        });
        continue;
      }

      const nameLine = frontmatter
        .split(/\r?\n/)
        .find((line) => line.trim().startsWith("name:"));
      const descriptionLine = frontmatter
        .split(/\r?\n/)
        .find((line) => line.trim().startsWith("description:"));

      if (!nameLine) {
        addDiagnostic(diagnostics, {
          severity: "error",
          skill: skillName,
          file: skillMd,
          rule: "missing-name",
          message: "frontmatter field 'name' is required",
        });
      }

      if (!descriptionLine) {
        addDiagnostic(diagnostics, {
          severity: "error",
          skill: skillName,
          file: skillMd,
          rule: "missing-description",
          message: "frontmatter field 'description' is required",
        });
      } else {
        const value = descriptionLine.split(":").slice(1).join(":").trim();
        if (value.length > maxDescriptionChars) {
          addDiagnostic(diagnostics, {
            severity: command.strict ? "error" : "warning",
            skill: skillName,
            file: skillMd,
            rule: "description-budget",
            message: `description has ${value.length} chars (limit ${maxDescriptionChars})`,
          });
        }
      }
    }
  }

  return {
    diagnostics,
  };
}

function notImplemented(name: string): never {
  throw new CoreError({
    code: "INTERNAL_NOT_IMPLEMENTED",
    message: `${name} is not yet implemented in platform-node adapter`,
    details: { method: name },
  });
}

async function runAddPlugin(
  command: AddPluginCommand
): Promise<AddPluginResult> {
  const installedPlugins: string[] = [];
  const skippedPlugins: string[] = [];
  const failedPlugins: { name: string; reason: string }[] = [];

  const sourceDir = path.resolve(command.source);
  if (!fs.existsSync(sourceDir)) {
    throw new CoreError({
      code: "SOURCE_NOT_FOUND",
      message: `Plugins source directory not found: ${sourceDir}`,
    });
  }

  const base = command.global ? os.homedir() : process.cwd();
  const agentList = command.agents ?? [];

  function installAgentDir(agentKey: string, skillsDir: string): void {
    const targetDir = path.join(base, skillsDir);
    if (fs.existsSync(targetDir)) {
      skippedPlugins.push(agentKey);
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      installedPlugins.push(agentKey);
    }
  }

  for (const name of agentList) {
    if (name === "*") {
      for (const agentKey of Object.keys(AGENTS)) {
        const info = AGENTS[agentKey as keyof typeof AGENTS];
        const skillsDir = command.global ? info.globalSkillsDir : info.projectSkillsDir;
        installAgentDir(agentKey, skillsDir);
      }
      continue;
    }

    if (!isAgent(name)) {
      failedPlugins.push({ name, reason: `Unknown agent: ${name}` });
      continue;
    }

    const skillsDir = command.global
      ? AGENTS[name].globalSkillsDir
      : AGENTS[name].projectSkillsDir;
    installAgentDir(name, skillsDir);
  }

  return { installedPlugins, skippedPlugins, failedPlugins };
}

export function createNodeCoreCommandPort(): CoreCommandPort {
  return {
    addSkill(_command: AddSkillCommand): Promise<AddSkillResult> {
      return Promise.resolve(notImplemented("addSkill"));
    },
    updateSkill(_command: UpdateSkillCommand): Promise<UpdateSkillResult> {
      return Promise.resolve(notImplemented("updateSkill"));
    },
    checkSkill(_command: CheckSkillCommand): Promise<CheckSkillResult> {
      return Promise.resolve(notImplemented("checkSkill"));
    },
    validateSkill(command: ValidateSkillCommand): Promise<ValidationReport> {
      return runValidate(command);
    },
    listSkill(_command: ListSkillCommand): Promise<ListSkillResult> {
      return Promise.resolve(notImplemented("listSkill"));
    },
    removeSkill(_command: RemoveSkillCommand): Promise<RemoveSkillResult> {
      return Promise.resolve(notImplemented("removeSkill"));
    },
    findSkill(_command: FindSkillCommand): Promise<FindSkillResult> {
      return Promise.resolve(notImplemented("findSkill"));
    },
    initSkill(_command: InitSkillCommand): Promise<InitSkillResult> {
      return Promise.resolve(notImplemented("initSkill"));
    },
    addPlugin(command: AddPluginCommand): Promise<AddPluginResult> {
      return runAddPlugin(command);
    },
  };
}
