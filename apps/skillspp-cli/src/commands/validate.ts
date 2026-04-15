import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import matter from "gray-matter";
import { parseSource } from "@skillspp/core/source-parser";
import { prepareSourceDir } from "@skillspp/core/sources/git";
import { discoverSkills } from "@skillspp/core/skills";
import {
  classifyDependencySource,
  cleanupPreparedInstallerArtifacts,
  isInstallerPolicyError,
  isInstallerSecurityError,
  loadInstallerConfig,
  prepareInstallerArtifacts,
} from "@skillspp/core/runtime/skill-installer";
import {
  evaluateInstallerLocalDependencyPolicy,
  type PolicyMode,
} from "@skillspp/core/policy";
import {
  resolveCatalogSkills,
  resolveWellKnownSkills,
} from "@skillspp/core/source-resolution";
import type { AddOptions } from "@skillspp/core/contracts/runtime-types";
import { parsePolicyMode } from "../policy-mode";
import {
  parseStandaloneCommand,
  type CliCommandContext,
} from "@skillspp/cli-shared/command-builder";
import { runBackgroundTask } from "../runtime/background-runner";
import {
  completedStepsSection,
  failedStepsSection,
  flushUiFrame,
  hideLoader,
  linesSection,
  panelSection,
  renderStaticScreen,
  showLoader,
} from "@skillspp/cli-shared/ui/screens";
import { bold, colorToken } from "@skillspp/cli-shared/ui/colors";

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

type RepoValidateConfig = {
  ciRoots?: string[];
  maxLines?: number;
  maxDescriptionChars?: number;
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

type ValidateCommanderOptions = {
  ci?: boolean;
  root?: string[];
  strict?: boolean;
  json?: boolean;
  maxLines?: string;
  maxDescriptionChars?: string;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: string;
  policyMode?: string;
};

function toValidateOptions(
  source: string | undefined,
  options: ValidateCommanderOptions,
): ValidateOptions {
  const maxLines = options.maxLines ? Number(options.maxLines) : undefined;
  if (
    typeof maxLines === "number" &&
    (!Number.isFinite(maxLines) || maxLines <= 0)
  ) {
    throw new Error(`Invalid --max-lines value: ${options.maxLines}`);
  }

  const maxDescriptionChars = options.maxDescriptionChars
    ? Number(options.maxDescriptionChars)
    : undefined;
  if (
    typeof maxDescriptionChars === "number" &&
    (!Number.isFinite(maxDescriptionChars) || maxDescriptionChars <= 0)
  ) {
    throw new Error(
      `Invalid --max-description-chars value: ${options.maxDescriptionChars}`,
    );
  }

  const maxDownloadBytes = options.maxDownloadBytes
    ? Number(options.maxDownloadBytes)
    : undefined;
  if (
    typeof maxDownloadBytes === "number" &&
    (!Number.isFinite(maxDownloadBytes) || maxDownloadBytes <= 0)
  ) {
    throw new Error(
      `Invalid --max-download-bytes value: ${options.maxDownloadBytes}`,
    );
  }

  return {
    source,
    json: Boolean(options.json),
    strict: Boolean(options.strict),
    ci: Boolean(options.ci),
    roots: options.root,
    allowHost: options.allowHost?.map((item) => item.toLowerCase()),
    denyHost: options.denyHost?.map((item) => item.toLowerCase()),
    maxDownloadBytes,
    maxLines,
    maxDescriptionChars,
    policyMode: parsePolicyMode(options.policyMode),
    experimental: false,
  };
}

function loadRepoValidateConfig(cwd: string): RepoValidateConfig {
  const configPath = path.join(cwd, ".skillspp-cli.json");
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    return {};
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    validate?: RepoValidateConfig;
  };

  return parsed.validate || {};
}

function resolveThresholds(
  options: ValidateOptions,
  cwd: string,
): ValidateThresholds {
  const config = loadRepoValidateConfig(cwd);
  return {
    maxLines: options.maxLines || config.maxLines || DEFAULT_MAX_LINES,
    maxDescriptionChars:
      options.maxDescriptionChars ||
      config.maxDescriptionChars ||
      DEFAULT_MAX_DESCRIPTION,
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

function discoverFallbackRoots(cwd: string): string[] {
  const candidates = [cwd, path.join(cwd, "skills")];
  const packagesDir = path.join(cwd, "packages");
  if (fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory()) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      candidates.push(path.join(packagesDir, entry.name, "skills"));
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of candidates) {
    if (!fs.existsSync(item)) {
      continue;
    }
    const resolved = path.resolve(item);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    out.push(item);
  }

  return out;
}

function discoverCiRoots(cwd: string): string[] {
  const config = loadRepoValidateConfig(cwd);
  if (config.ciRoots && config.ciRoots.length > 0) {
    const roots = config.ciRoots
      .map((item) => path.resolve(cwd, item))
      .filter((item) => fs.existsSync(item) && fs.statSync(item).isDirectory());
    if (roots.length > 0) {
      return roots;
    }
  }

  return discoverFallbackRoots(cwd);
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
    throw new Error("validate requires <source> unless --ci is used");
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

    const tempRoots: string[] = [];
    try {
      for (const remoteSkill of remote) {
        const tmp = fs.mkdtempSync(
          path.join(os.tmpdir(), "skillspp-validate-"),
        );
        tempRoots.push(tmp);

        for (const [relativePath, content] of remoteSkill.files.entries()) {
          const target = path.join(tmp, relativePath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, "utf8");
        }

        await emitProgress?.(`validating ${remoteSkill.installName}`);
        await validateSkillDir(
          tmp,
          tmp,
          diagnostics,
          Boolean(options.strict),
          thresholds,
        );
      }
    } finally {
      for (const tmp of tempRoots) {
        fs.rmSync(tmp, { recursive: true, force: true });
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
  const thresholds = resolveThresholds(options, process.cwd());
  const seenSkillPaths = new Set<string>();

  if (options.ci) {
    await emitProgress?.("staging source");
    const roots =
      options.roots && options.roots.length > 0
        ? options.roots
        : discoverCiRoots(process.cwd());
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

function resolveValidateTargetLabel(options: ValidateOptions): string {
  if (!options.ci) {
    return options.source || "(none)";
  }
  if (options.roots && options.roots.length > 0) {
    return `CI roots (${options.roots.length})`;
  }
  return "CI roots (auto-discovered)";
}

function validateModeLabel(options: ValidateOptions): string {
  return options.ci ? "CI roots" : "Single source";
}

function validateSeverityLabel(options: ValidateOptions): string {
  return options.strict ? "Strict" : "Standard";
}

function formatDiagnosticLine(row: ValidateDiagnostic): string {
  return `${row.skill} · ${row.rule}: ${row.message}`;
}

function buildDiagnosticsPanelLines(
  diagnostics: ValidateDiagnostic[],
): string[] {
  if (diagnostics.length === 0) {
    return [colorToken("No diagnostics found.", "success")];
  }

  const sorted = [...diagnostics].sort((a, b) =>
    `${a.severity}:${a.skill}:${a.rule}`.localeCompare(
      `${b.severity}:${b.skill}:${b.rule}`,
    ),
  );

  return sorted.map((row) => {
    const marker =
      row.severity === "error"
        ? colorToken("[error]", "danger")
        : colorToken("[warning]", "warning");
    return `${marker} ${formatDiagnosticLine(row)}`;
  });
}

async function executeValidate(options: ValidateOptions): Promise<void> {
  const thresholds = resolveThresholds(options, process.cwd());
  if (options.json) {
    const { diagnostics } = await runValidateAnalysis(options);
    const errors = diagnostics.filter((item) => item.severity === "error");
    const warnings = diagnostics.filter((item) => item.severity === "warning");

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: errors.length === 0,
          errors,
          warnings,
        },
        null,
        2,
      )}\n`,
    );

    if (errors.length > 0) {
      throw new Error(`Validation failed with ${errors.length} error(s)`);
    }
    return;
  }

  showLoader("loading");
  await flushUiFrame();
  let failedLabel = "failed to run validation";
  const runtimeSteps = new Set<string>();
  let result: ValidateRunResult;
  try {
    result = await runBackgroundTask(
      {
        kind: "validate.run",
        payload: {
          cwd: process.cwd(),
          options,
        },
      },
      {
        onProgress: (label) => {
          if (label === "parsing source") {
            failedLabel = "failed to parse source";
          } else if (label === "discovering candidate skills") {
            failedLabel = "failed to discover candidate skills";
          } else {
            failedLabel = "failed to run validation";
          }
          if (label === "staging source" || label.startsWith("validating ")) {
            runtimeSteps.add(label);
          }
          showLoader(label);
        },
      },
    );
  } catch (error) {
    hideLoader();
    await renderStaticScreen([failedStepsSection([failedLabel])]);
    throw error;
  } finally {
    hideLoader();
  }

  const diagnostics = result.diagnostics;

  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");

  const validatingSteps = [...runtimeSteps]
    .filter((step) => step.startsWith("validating "))
    .sort((a, b) => a.localeCompare(b));
  const runStepLines = [
    "staging source",
    ...validatingSteps,
    "collecting diagnostics",
  ];

  await renderStaticScreen([
    completedStepsSection([
      "source parsed",
      "candidate skills discovered",
      "validation session ready",
    ]),
    linesSection([
      `  Validation target: ${resolveValidateTargetLabel(options)}`,
    ]),
    panelSection({
      title: "Checks Included",
      lines: [
        `  ${colorToken(
          "●",
          "primary",
        )} SKILL.md exists + frontmatter parseability`,
        `  ${colorToken("●", "primary")} required fields: name, description`,
        `  ${colorToken("●", "primary")} name ↔ directory consistency`,
        `  ${colorToken("●", "primary")} markdown reference existence`,
        `  ${colorToken(
          "●",
          "primary",
        )} type-specific rules (framework references dir)`,
        `  ${colorToken(
          "●",
          "primary",
        )} installer dependency security + preflight`,
        `  ${colorToken("●", "primary")} line/description budget thresholds`,
      ],
      style: "square",
      minWidth: 74,
    }),
    panelSection({
      title: "Validation Summary",
      lines: [
        `${bold("Validate Mode:")} ${validateModeLabel(options)}`,
        `${bold("Severity Profile:")} ${validateSeverityLabel(options)}`,
        `${bold("Scope:")} ${validateModeLabel(options).toLowerCase()}`,
        `${bold("Profile:")} ${validateSeverityLabel(options).toLowerCase()}`,
        `${bold("Output:")} human-readable`,
        colorToken(`${bold("Errors:")} ${errors.length}`, "danger"),
        colorToken(`${bold("Warnings:")} ${warnings.length}`, "warning"),
        "",
        bold("Diagnostics:"),
        ...buildDiagnosticsPanelLines(diagnostics),
        "",
        bold("Thresholds:"),
        `  - max lines: ${thresholds.maxLines}`,
        `  - max description chars: ${thresholds.maxDescriptionChars}`,
      ],
      style: "rounded",
      minWidth: 74,
    }),
    completedStepsSection(runStepLines),
  ]);

  if (errors.length > 0) {
    throw new Error(`Validation failed with ${errors.length} error(s)`);
  }
}

function configureValidateCommand(
  command: Command,
  action: (
    source: string | undefined,
    options: ValidateCommanderOptions,
  ) => Promise<void>,
): Command {
  return command
    .description("Validate skill source structure and references")
    .argument("[source]", "Source path or URL")
    .option("--ci", "Validate multiple local roots for CI")
    .option("--root <paths...>", "Root paths for CI mode")
    .option("--strict", "Escalate warnings to errors")
    .option("--json", "Emit JSON output")
    .option("--max-lines <n>", "SKILL.md line budget threshold")
    .option(
      "--max-description-chars <n>",
      "Description length budget threshold",
    )
    .option("--allow-host <hosts...>", "Restrict well-known hosts to allowlist")
    .option("--deny-host <hosts...>", "Block specific well-known hosts")
    .option("--max-download-bytes <n>", "Set well-known download budget")
    .option("--policy-mode <mode>", "Policy mode (enforce|warn)")
    .action(action);
}

export function registerValidateCommand(
  program: Command,
  ctx: CliCommandContext,
): void {
  configureValidateCommand(
    program.command("validate"),
    ctx.wrapAction(
      "validate",
      async (source: string | undefined, options: ValidateCommanderOptions) => {
        await executeValidate({
          ...toValidateOptions(source, options),
          experimental: ctx.experimental,
        });
      },
    ),
  );
}

export async function runValidate(args: string[]): Promise<void> {
  const command = configureValidateCommand(
    new Command().name("validate"),
    async (source, options) => {
      await executeValidate(toValidateOptions(source, options));
    },
  );
  await parseStandaloneCommand(command, args);
}
