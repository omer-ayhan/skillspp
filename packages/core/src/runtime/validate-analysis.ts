import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import matter from "gray-matter";
import { parseSource } from "../sources/source-parser";
import { prepareSourceDir } from "../sources/git";
import {
  discoverSkills,
  stageRemoteSkillFilesToTempDir,
} from "../sources/skills";
import {
  classifyDependencySource,
  cleanupPreparedInstallerArtifacts,
  isInstallerPolicyError,
  isInstallerSecurityError,
  loadInstallerConfig,
  prepareInstallerArtifacts,
} from "./skill-installer";
import {
  evaluateInstallerLocalDependencyPolicy,
  type PolicyMode,
} from "./policy";
import {
  resolveCatalogSkills,
  resolveWellKnownSkills,
} from "../sources/source-resolution";
import type { AddOptions } from "../contracts/runtime-types";
import { CoreError } from "../contracts/errors/core-error";

type Severity = "error" | "warning";

export type ValidateDiagnostic = {
  severity: Severity;
  skill: string;
  file: string;
  rule: string;
  message: string;
};

export type ValidateOptions = {
  source?: string;
  json?: boolean;
  strict?: boolean;
  ci?: boolean;
  roots?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  maxLines?: number;
  maxDescriptionChars?: number;
  policyMode?: PolicyMode;
  experimental?: boolean;
};

type ValidateThresholds = {
  maxLines: number;
  maxDescriptionChars: number;
};

export type ValidateRunResult = {
  diagnostics: ValidateDiagnostic[];
};

type TypeRule = {
  id: string;
  when: (frontmatter: Record<string, unknown>) => boolean;
  validate: (ctx: {
    skillDir: string;
    skillName: string;
    diagnostics: ValidateDiagnostic[];
  }) => void;
};

const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_DESCRIPTION = 1024;

function resolveThresholds(options: ValidateOptions): ValidateThresholds {
  return {
    maxLines: options.maxLines || DEFAULT_MAX_LINES,
    maxDescriptionChars: options.maxDescriptionChars || DEFAULT_MAX_DESCRIPTION,
  };
}

function addDiagnostic(
  list: ValidateDiagnostic[],
  diagnostic: ValidateDiagnostic,
): void {
  list.push(diagnostic);
}

function discoverMarkdownReferences(content: string): string[] {
  const refs = new Set<string>();

  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(content)) !== null) {
    const value = match[1].trim();
    if (
      !value ||
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("#")
    ) {
      continue;
    }
    refs.add(value);
  }

  return [...refs];
}

const typeRules: TypeRule[] = [
  {
    id: "framework-references-dir",
    when: (frontmatter) => frontmatter.type === "framework",
    validate: ({ skillDir, skillName, diagnostics }) => {
      const referencesDir = path.join(skillDir, "references");
      if (
        !fs.existsSync(referencesDir) ||
        !fs.statSync(referencesDir).isDirectory()
      ) {
        addDiagnostic(diagnostics, {
          severity: "error",
          skill: skillName,
          file: referencesDir,
          rule: "framework-references-required",
          message: "framework skills must contain a references directory",
        });
      }
    },
  },
];

async function validateInstallerDependencies(
  skillDir: string,
  sourceRoot: string,
  diagnostics: ValidateDiagnostic[],
  skillName: string,
): Promise<void> {
  const installerConfigPath = fs.existsSync(
    path.join(skillDir, "skill-installer.yaml"),
  )
    ? path.join(skillDir, "skill-installer.yaml")
    : path.join(skillDir, "skill-installer.json");

  try {
    const installer = loadInstallerConfig(skillDir);
    const fallbackRoots = Array.from(
      new Set([path.resolve(sourceRoot), path.resolve(process.cwd())]),
    );
    let hasSecurityViolation = false;

    for (const dep of installer.dependencies) {
      const source = typeof dep === "string" ? dep : dep.source;
      const kind = classifyDependencySource(source);
      if (kind !== "local") {
        continue;
      }

      let accepted = false;
      let securityViolation:
        | {
            rule: string;
            message: string;
            severity: "error" | "warning";
            blocking: boolean;
          }
        | undefined;
      for (const root of fallbackRoots) {
        const evaluated = evaluateInstallerLocalDependencyPolicy(
          {
            source,
            sourceRoot: root,
          },
          "enforce",
        );
        if (evaluated.ok) {
          accepted = true;
          break;
        } else {
          securityViolation =
            "violation" in evaluated ? evaluated.violation : undefined;
        }
      }

      if (!accepted && securityViolation) {
        hasSecurityViolation = true;
        addDiagnostic(diagnostics, {
          severity: securityViolation.severity,
          skill: skillName,
          file: installerConfigPath,
          rule: securityViolation.rule,
          message: securityViolation.message,
        });
      }
    }

    if (hasSecurityViolation) {
      return;
    }

    const tempSkillDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "skillspp-validate-installer-"),
    );
    try {
      const filesToCopy = [
        "SKILL.md",
        "skill-installer.yaml",
        "skill-installer.json",
      ];
      for (const fileName of filesToCopy) {
        const src = path.join(skillDir, fileName);
        if (fs.existsSync(src) && fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(tempSkillDir, fileName));
        }
      }

      const agentsDir = path.join(skillDir, "agents");
      if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
        fs.cpSync(agentsDir, path.join(tempSkillDir, "agents"), {
          recursive: true,
          force: true,
        });
      }

      let preparedSuccess = false;
      let lastMissingSourceError: unknown;
      let securityError: unknown;

      for (const root of fallbackRoots) {
        try {
          const prepared = await prepareInstallerArtifacts(tempSkillDir, root, {
            sourceType: "local",
            allowHookCommands: false,
            policyMode: "enforce",
          });
          cleanupPreparedInstallerArtifacts(prepared);
          preparedSuccess = true;
          break;
        } catch (error) {
          if (isInstallerSecurityError(error)) {
            securityError = error;
            break;
          }
          if (isInstallerPolicyError(error)) {
            securityError = error;
            break;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          if (message.includes("(local) source not found")) {
            lastMissingSourceError = error;
            continue;
          }
          throw error;
        }
      }

      if (!preparedSuccess && securityError) {
        throw securityError;
      }
      if (!preparedSuccess && lastMissingSourceError) {
        throw lastMissingSourceError;
      }
    } finally {
      fs.rmSync(tempSkillDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (isInstallerSecurityError(error)) {
      addDiagnostic(diagnostics, {
        severity: error.violation.severity,
        skill: skillName,
        file: installerConfigPath,
        rule: error.violation.rule,
        message: error.violation.message,
      });
      return;
    }
    if (isInstallerPolicyError(error)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        skill: skillName,
        file: installerConfigPath,
        rule: error.violation.rule,
        message: error.violation.message,
      });
      return;
    }

    addDiagnostic(diagnostics, {
      severity: "warning",
      skill: skillName,
      file: installerConfigPath,
      rule: "missing-installer-local-dependency",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function validateSkillDir(
  skillDir: string,
  sourceRoot: string,
  diagnostics: ValidateDiagnostic[],
  strict: boolean,
  thresholds: ValidateThresholds,
): Promise<void> {
  const skillMd = path.join(skillDir, "SKILL.md");
  const skillName = path.basename(skillDir);

  if (!fs.existsSync(skillMd)) {
    addDiagnostic(diagnostics, {
      severity: "error",
      skill: skillName,
      file: skillMd,
      rule: "missing-skill-md",
      message: "SKILL.md is required",
    });
    return;
  }

  const content = fs.readFileSync(skillMd, "utf8");
  const lines = content.split(/\r?\n/);

  if (lines.length > thresholds.maxLines) {
    addDiagnostic(diagnostics, {
      severity: strict ? "error" : "warning",
      skill: skillName,
      file: skillMd,
      rule: "line-budget",
      message: `SKILL.md has ${lines.length} lines (limit ${thresholds.maxLines})`,
    });
  }

  let parsed;
  try {
    parsed = matter(content);
  } catch (error) {
    addDiagnostic(diagnostics, {
      severity: "error",
      skill: skillName,
      file: skillMd,
      rule: "invalid-frontmatter",
      message:
        error instanceof Error ? error.message : "frontmatter parsing failed",
    });
    return;
  }

  const data = (parsed.data || {}) as Record<string, unknown>;
  const name = data.name;
  const description = data.description;

  if (typeof name !== "string" || !name.trim()) {
    addDiagnostic(diagnostics, {
      severity: "error",
      skill: skillName,
      file: skillMd,
      rule: "missing-name",
      message: "frontmatter field 'name' is required",
    });
  }

  if (typeof description !== "string" || !description.trim()) {
    addDiagnostic(diagnostics, {
      severity: "error",
      skill: skillName,
      file: skillMd,
      rule: "missing-description",
      message: "frontmatter field 'description' is required",
    });
  } else if (description.length > thresholds.maxDescriptionChars) {
    addDiagnostic(diagnostics, {
      severity: strict ? "error" : "warning",
      skill: skillName,
      file: skillMd,
      rule: "description-budget",
      message: `description has ${description.length} chars (limit ${thresholds.maxDescriptionChars})`,
    });
  }

  if (typeof name === "string" && name.trim()) {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "");
    if (normalized && normalized !== skillName.toLowerCase()) {
      addDiagnostic(diagnostics, {
        severity: "error",
        skill: skillName,
        file: skillMd,
        rule: "name-path-mismatch",
        message: `frontmatter name '${name}' does not match directory '${skillName}'`,
      });
    }
  }

  for (const ref of discoverMarkdownReferences(content)) {
    const resolved = path.resolve(skillDir, ref);
    const rel = path.relative(skillDir, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      continue;
    }
    if (!fs.existsSync(resolved)) {
      addDiagnostic(diagnostics, {
        severity: "error",
        skill: skillName,
        file: skillMd,
        rule: "missing-reference",
        message: `referenced path not found: ${ref}`,
      });
    }
  }

  for (const rule of typeRules) {
    if (rule.when(data)) {
      rule.validate({ skillDir, skillName, diagnostics });
    }
  }

  await validateInstallerDependencies(
    skillDir,
    sourceRoot,
    diagnostics,
    skillName,
  );
}

async function stageAndValidateLocalRoot(
  rootPath: string,
  dependencyRoot: string,
  seenSkillPaths: Set<string>,
  diagnostics: ValidateDiagnostic[],
  strict: boolean,
  thresholds: ValidateThresholds,
  emitProgress?: (label: string) => Promise<void> | void,
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  if (
    !fs.existsSync(resolvedRoot) ||
    !fs.statSync(resolvedRoot).isDirectory()
  ) {
    addDiagnostic(diagnostics, {
      severity: "error",
      skill: path.basename(resolvedRoot),
      file: resolvedRoot,
      rule: "missing-root",
      message: "validation root does not exist",
    });
    return;
  }

  await emitProgress?.("discovering candidate skills");
  const skills = discoverSkills(resolvedRoot);
  if (skills.length === 0) {
    addDiagnostic(diagnostics, {
      severity: "error",
      skill: path.basename(resolvedRoot),
      file: resolvedRoot,
      rule: "no-skills-discovered",
      message: "no SKILL.md files discovered",
    });
    return;
  }

  for (const skill of skills) {
    const resolvedSkillPath = path.resolve(skill.path);
    if (seenSkillPaths.has(resolvedSkillPath)) {
      continue;
    }
    seenSkillPaths.add(resolvedSkillPath);
    await emitProgress?.(`validating ${skill.name}`);
    await validateSkillDir(
      skill.path,
      dependencyRoot,
      diagnostics,
      strict,
      thresholds,
    );
  }
}

async function stageAndValidateSource(
  options: ValidateOptions,
  diagnostics: ValidateDiagnostic[],
  thresholds: ValidateThresholds,
  emitProgress?: (label: string) => Promise<void> | void,
): Promise<void> {
  if (!options.source) {
    throw new CoreError({
      code: "VALIDATION_MISSING_SOURCE",
      message: "validate requires a source unless CI mode is enabled",
    });
  }

  await emitProgress?.("parsing source");
  const parsed = parseSource(options.source);
  if (parsed.type === "well-known" || parsed.type === "catalog") {
    await emitProgress?.("discovering candidate skills");
    const remote =
      parsed.type === "well-known"
        ? await resolveWellKnownSkills(parsed.url, {
            allowHost: options.allowHost,
            denyHost: options.denyHost,
            maxDownloadBytes: options.maxDownloadBytes,
            experimental: options.experimental,
          } as AddOptions)
        : await resolveCatalogSkills(parsed.url, {
            allowHost: options.allowHost,
            denyHost: options.denyHost,
            maxDownloadBytes: options.maxDownloadBytes,
            experimental: options.experimental,
          } as AddOptions);

    if (remote.length === 0) {
      addDiagnostic(diagnostics, {
        severity: "error",
        skill: parsed.url,
        file: parsed.url,
        rule: "no-skills-discovered",
        message: "no SKILL.md files discovered",
      });
      return;
    }

    const stagedRoots: Array<{ path: string; cleanup: () => void }> = [];
    try {
      for (const remoteSkill of remote) {
        const staged = stageRemoteSkillFilesToTempDir(remoteSkill.files, {
          prefix: "skillspp-validate-",
        });
        stagedRoots.push(staged);

        await emitProgress?.(`validating ${remoteSkill.installName}`);
        await validateSkillDir(
          staged.path,
          staged.path,
          diagnostics,
          Boolean(options.strict),
          thresholds,
        );
      }
    } finally {
      for (const staged of stagedRoots) {
        staged.cleanup();
      }
    }

    return;
  }

  const staged = prepareSourceDir(parsed);
  try {
    await emitProgress?.("staging source");
    await stageAndValidateLocalRoot(
      staged.basePath,
      staged.basePath,
      new Set<string>(),
      diagnostics,
      Boolean(options.strict),
      thresholds,
      emitProgress,
    );
  } finally {
    if (staged.cleanup) {
      staged.cleanup();
    }
  }
}

export async function runValidateAnalysis(
  options: ValidateOptions,
  emitProgress?: (label: string) => Promise<void> | void,
): Promise<ValidateRunResult> {
  const diagnostics: ValidateDiagnostic[] = [];
  const thresholds = resolveThresholds(options);
  const seenSkillPaths = new Set<string>();

  if (options.ci) {
    await emitProgress?.("staging source");
    const roots =
      options.roots && options.roots.length > 0
        ? options.roots
        : [process.cwd()];
    if (roots.length === 0) {
      throw new Error("No CI roots found to validate");
    }

    await emitProgress?.("discovering candidate skills");
    for (const root of roots) {
      await stageAndValidateLocalRoot(
        root,
        process.cwd(),
        seenSkillPaths,
        diagnostics,
        Boolean(options.strict),
        thresholds,
        emitProgress,
      );
    }
  } else {
    await stageAndValidateSource(
      options,
      diagnostics,
      thresholds,
      emitProgress,
    );
  }

  await emitProgress?.("collecting diagnostics");

  return { diagnostics };
}
