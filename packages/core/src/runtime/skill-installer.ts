import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import {
  type PolicyMode,
  evaluateHookTrustPolicy,
  evaluateInstallerLocalDependencyPolicy,
} from "./policy";
import { type InstallerSecurityViolation } from "./installer-security";

type DependencyObject = {
  source: string;
  path: string;
};

type Dependency = string | DependencyObject;

type InstallerConfig = {
  schemaVersion: 1;
  preInstall: string[];
  dependencies: Dependency[];
  postInstall: string[];
};

export type InstallerRuntimeEvent = {
  level: "info" | "warning";
  message: string;
};

type SkillInstallerRuntimeOptions = {
  sourceType?: "local" | "github" | "git" | "well-known" | "catalog";
  allowHookCommands?: boolean;
  policyMode?: PolicyMode;
  trustWellKnown?: boolean;
};

type LocalPreparedDependency = {
  kind: "local";
  index: number;
  targetPath: string;
  sourcePath: string;
  sourceLabel: string;
};

type RemotePreparedDependency = {
  kind: "remote-bytes";
  index: number;
  targetPath: string;
  remoteBufferPath: string;
  sourceLabel: string;
};

type RepoPreparedDependency = {
  kind: "repo-staged";
  index: number;
  targetPath: string;
  repoStagePath: string;
  sourceLabel: string;
};

type PreparedDependency =
  | LocalPreparedDependency
  | RemotePreparedDependency
  | RepoPreparedDependency;

export class InstallerSecurityError extends Error {
  violation: InstallerSecurityViolation;

  constructor(violation: InstallerSecurityViolation) {
    super(violation.message);
    this.name = "InstallerSecurityError";
    this.violation = violation;
  }
}

export function isInstallerSecurityError(error: unknown): error is InstallerSecurityError {
  return error instanceof InstallerSecurityError;
}

export class InstallerPolicyError extends Error {
  violation: {
    rule: string;
    message: string;
    severity: "error" | "warning";
    blocking: boolean;
  };

  constructor(violation: {
    rule: string;
    message: string;
    severity: "error" | "warning";
    blocking: boolean;
  }) {
    super(violation.message);
    this.name = "InstallerPolicyError";
    this.violation = violation;
  }
}

export function isInstallerPolicyError(error: unknown): error is InstallerPolicyError {
  return error instanceof InstallerPolicyError;
}

export type PreparedInstallerArtifacts = {
  preInstall: string[];
  postInstall: string[];
  preparedDependencies: PreparedDependency[];
  stagingDir: string;
  events: InstallerRuntimeEvent[];
};

const dependencyObjectSchema = z
  .object({
    source: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

const installerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    "pre-install": z.array(z.string().min(1)).optional().default([]),
    dependencies: z
      .array(z.union([z.string().min(1), dependencyObjectSchema]))
      .optional()
      .default([]),
    "post-install": z.array(z.string().min(1)).optional().default([]),
  })
  .strict();

function ensureInsideRoot(rootDir: string, relativeTarget: string): string {
  const resolved = path.resolve(rootDir, relativeTarget);
  const relative = path.relative(rootDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe destination path: ${relativeTarget}`);
  }
  return resolved;
}

function sourceLooksLikeUrl(source: string): boolean {
  try {
    const parsed = new URL(source);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceLooksLikeRepoShorthand(source: string): boolean {
  const trimmed = source.trim().replace(/^https?:\/\//, "");
  return /^(github\.com|gitlab\.com)\/[^/]+\/[^/]+(?:\.git)?\/?$/.test(trimmed);
}

function parseRepoSource(source: string): {
  repoUrl: string;
  repoName: string;
} {
  const withoutProtocol = source
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const match = withoutProtocol.match(/^(github\.com|gitlab\.com)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Unsupported repository dependency source: ${source}`);
  }

  const host = match[1];
  const owner = match[2];
  const repo = match[3];
  return {
    repoUrl: `https://${host}/${owner}/${repo}.git`,
    repoName: repo,
  };
}

function deriveDestinationNameFromSource(source: string): string {
  if (sourceLooksLikeUrl(source)) {
    const parsed = new URL(source);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const leaf = parts[parts.length - 1];
    if (!leaf) {
      throw new Error(`Cannot derive dependency name from URL source: ${source}`);
    }
    return leaf;
  }

  if (sourceLooksLikeRepoShorthand(source)) {
    return parseRepoSource(source).repoName;
  }

  const leaf = path.basename(source);
  if (!leaf || leaf === "." || leaf === path.sep) {
    throw new Error(`Cannot derive dependency name from source: ${source}`);
  }
  return leaf;
}

export function classifyDependencySource(source: string): "url" | "repo" | "local" {
  if (sourceLooksLikeUrl(source)) {
    return "url";
  }
  if (sourceLooksLikeRepoShorthand(source)) {
    return "repo";
  }
  return "local";
}

function parseConfigObject(raw: unknown): InstallerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid skill-installer config: expected an object with top-level keys");
  }

  const parsed = raw as Record<string, unknown>;
  if (typeof parsed["skill-installer"] !== "undefined") {
    throw new Error(
      "Invalid skill-installer config: do not nest under 'skill-installer:'. Use top-level 'pre-install', 'dependencies', and 'post-install'.",
    );
  }

  if (Array.isArray(parsed.dependencies)) {
    const hasLegacyDependency = parsed.dependencies.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      const row = entry as Record<string, unknown>;
      return (
        typeof row.type !== "undefined" ||
        typeof row.url !== "undefined" ||
        typeof row.name !== "undefined"
      );
    });

    if (hasLegacyDependency) {
      throw new Error(
        "Invalid skill-installer config: legacy dependency format detected. Use schemaVersion: 1 and the lean dependencies format from docs/proposed-skill-format.md.",
      );
    }
  }

  const validated = installerConfigSchema.safeParse(parsed);
  if (!validated.success) {
    const reason = validated.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(
      `Invalid skill-installer config: ${reason}. Use docs/proposed-skill-format.md as the source-of-truth for schemaVersion, dependencies, pre-install, and post-install.`,
    );
  }

  const normalized = validated.data;
  return {
    schemaVersion: 1,
    preInstall: normalized["pre-install"],
    dependencies: normalized.dependencies.map((dep) =>
      typeof dep === "string" ? dep : { source: dep.source, path: dep.path },
    ),
    postInstall: normalized["post-install"],
  };
}

function assertNoLegacyInstallerBlock(skillDir: string): void {
  const openAiYamlPath = path.join(skillDir, "agents", "openai.yaml");
  if (!fs.existsSync(openAiYamlPath) || !fs.statSync(openAiYamlPath).isFile()) {
    return;
  }

  const parsed = YAML.parse(fs.readFileSync(openAiYamlPath, "utf8")) as Record<
    string,
    unknown
  > | null;
  if (parsed && typeof parsed === "object" && typeof parsed["skill-installer"] !== "undefined") {
    throw new Error(
      "Legacy skill-installer config detected in agents/openai.yaml. Move it to skill-installer.yaml or skill-installer.json.",
    );
  }
}

export function loadInstallerConfig(skillDir: string): InstallerConfig {
  assertNoLegacyInstallerBlock(skillDir);

  const yamlPath = path.join(skillDir, "skill-installer.yaml");
  const jsonPath = path.join(skillDir, "skill-installer.json");
  const hasYaml = fs.existsSync(yamlPath) && fs.statSync(yamlPath).isFile();
  const hasJson = fs.existsSync(jsonPath) && fs.statSync(jsonPath).isFile();

  if (hasYaml && hasJson) {
    throw new Error(
      "Both skill-installer.yaml and skill-installer.json exist. Keep only one installer config file.",
    );
  }

  if (!hasYaml && !hasJson) {
    return {
      schemaVersion: 1,
      preInstall: [],
      dependencies: [],
      postInstall: [],
    };
  }

  if (hasYaml) {
    const parsed = YAML.parse(fs.readFileSync(yamlPath, "utf8"));
    return parseConfigObject(parsed);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as unknown;
  return parseConfigObject(raw);
}

function runHookPhase(
  phase: "pre-install" | "post-install",
  commands: string[],
  cwd: string,
  events: InstallerRuntimeEvent[],
): void {
  for (const command of commands) {
    events.push({
      level: "info",
      message: `[skills] ${phase}: ${command}`,
    });
    const result = spawnSync("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });

    if (result.status !== 0) {
      const message =
        (result.stderr || result.stdout || "command failed").trim().split(/\r?\n/)[0] ||
        "command failed";
      throw new Error(`${phase} command failed: ${command} (${message})`);
    }
  }
}

function resolveDependencySourceAndTarget(dep: Dependency): {
  source: string;
  targetPath: string;
} {
  if (typeof dep === "string") {
    return {
      source: dep,
      targetPath: deriveDestinationNameFromSource(dep),
    };
  }

  return {
    source: dep.source,
    targetPath: dep.path,
  };
}

function runGitClone(repoUrl: string, targetDir: string): void {
  const result = spawnSync("git", ["clone", "--depth", "1", repoUrl, targetDir], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    const message =
      (result.stderr || result.stdout || "git clone failed").trim().split(/\r?\n/)[0] ||
      "git clone failed";
    throw new Error(`Repository dependency clone failed: ${repoUrl} (${message})`);
  }
}

async function prepareDependency(
  source: string,
  targetPath: string,
  index: number,
  sourceCwd: string,
  stagingDir: string,
  policyMode: PolicyMode,
  events: InstallerRuntimeEvent[],
): Promise<PreparedDependency> {
  const sourceKind = classifyDependencySource(source);

  if (sourceKind === "local") {
    const evaluation = evaluateInstallerLocalDependencyPolicy(
      {
        source,
        sourceRoot: sourceCwd,
      },
      policyMode,
    );
    if (!evaluation.ok) {
      const violation = "violation" in evaluation ? evaluation.violation : undefined;
      if (!violation) {
        throw new Error(`Dependency[${index}] policy evaluation failed for source: ${source}`);
      }
      if (violation.blocking) {
        throw new InstallerSecurityError(violation);
      }
      events.push({
        level: "warning",
        message: `[skills] ${violation.message}`,
      });
    }
    const sourcePath = evaluation.ok ? evaluation.resolvedPath : path.resolve(sourceCwd, source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Dependency[${index}] (local) source not found: ${source}`);
    }
    // Read access preflight; actual copy happens once during apply.
    fs.accessSync(sourcePath, fs.constants.R_OK);
    events.push({
      level: "info",
      message: `[skills] dependency[${index}] preflight-validated: ${source}`,
    });
    return {
      kind: "local",
      index,
      targetPath,
      sourcePath,
      sourceLabel: source,
    };
  }

  if (sourceKind === "repo") {
    const stagePath = ensureInsideRoot(
      stagingDir,
      `repo-${index}-${path.basename(targetPath).replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    );
    const { repoUrl } = parseRepoSource(source);
    runGitClone(repoUrl, stagePath);
    events.push({
      level: "info",
      message: `[skills] dependency[${index}] staged: ${source}`,
    });
    return {
      kind: "repo-staged",
      index,
      targetPath,
      repoStagePath: stagePath,
      sourceLabel: source,
    };
  }

  const target = new URL(source);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Dependency[${index}] (remote) unsupported protocol: ${target.protocol}`);
  }

  const response = await fetch(target.toString());
  if (!response.ok) {
    throw new Error(
      `Dependency[${index}] (remote) download failed: ${response.status} ${response.statusText}`,
    );
  }

  const stagedFilePath = ensureInsideRoot(
    stagingDir,
    `remote-${index}-${path.basename(targetPath)}`,
  );
  fs.mkdirSync(path.dirname(stagedFilePath), { recursive: true });
  fs.writeFileSync(stagedFilePath, Buffer.from(await response.arrayBuffer()));
  events.push({
    level: "info",
    message: `[skills] dependency[${index}] staged: ${source}`,
  });
  return {
    kind: "remote-bytes",
    index,
    targetPath,
    remoteBufferPath: stagedFilePath,
    sourceLabel: source,
  };
}

export async function prepareInstallerArtifacts(
  skillDir: string,
  sourceCwd: string,
  options: SkillInstallerRuntimeOptions = {},
): Promise<PreparedInstallerArtifacts> {
  const config = loadInstallerConfig(skillDir);
  const sourceType = options.sourceType ?? "local";
  const allowHookCommands = options.allowHookCommands;
  const policyMode = options.policyMode ?? "enforce";

  const events: InstallerRuntimeEvent[] = [];
  if (config.preInstall.length > 0 || config.postInstall.length > 0) {
    if (allowHookCommands === false) {
      throw new Error(
        "Blocked skill-installer hook commands by caller policy for pre/post install commands.",
      );
    }
    const trustDecision = evaluateHookTrustPolicy({
      sourceType,
      trustWellKnown: Boolean(options.trustWellKnown),
      mode: policyMode,
    });
    if (!trustDecision.allowed && trustDecision.violation) {
      throw new InstallerPolicyError(trustDecision.violation);
    }
    if (trustDecision.allowed && trustDecision.violation?.severity === "warning") {
      events.push({
        level: "warning",
        message: `[skills] ${trustDecision.violation.message}`,
      });
    }
  }

  if (
    config.preInstall.length === 0 &&
    config.dependencies.length === 0 &&
    config.postInstall.length === 0
  ) {
    return {
      preInstall: [],
      postInstall: [],
      preparedDependencies: [],
      stagingDir: "",
      events,
    };
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "skillspp-installer-stage-"));
  const preparedDependencies: PreparedDependency[] = [];
  const seenTargetPaths = new Set<string>();

  try {
    for (let i = 0; i < config.dependencies.length; i += 1) {
      const dep = config.dependencies[i];
      const { source, targetPath } = resolveDependencySourceAndTarget(dep);

      const normalizedTarget = targetPath.replace(/\\/g, "/");
      if (seenTargetPaths.has(normalizedTarget)) {
        throw new Error(`Dependency[${i}] duplicate target path: ${targetPath}`);
      }
      seenTargetPaths.add(normalizedTarget);

      const destinationInSkill = ensureInsideRoot(skillDir, targetPath);
      if (fs.existsSync(destinationInSkill)) {
        throw new Error(
          `Dependency[${i}] destination already exists: ${path.relative(
            skillDir,
            destinationInSkill,
          )}`,
        );
      }

      const preparedDep = await prepareDependency(
        source,
        targetPath,
        i,
        sourceCwd,
        stagingDir,
        policyMode,
        events,
      );
      preparedDependencies.push(preparedDep);
    }

    return {
      preInstall: config.preInstall,
      postInstall: config.postInstall,
      preparedDependencies,
      stagingDir,
      events,
    };
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupPreparedInstallerArtifacts(prepared: PreparedInstallerArtifacts): void {
  if (prepared.stagingDir) {
    fs.rmSync(prepared.stagingDir, { recursive: true, force: true });
  }
}

export async function applyInstallerArtifacts(
  installedSkillDir: string,
  prepared: PreparedInstallerArtifacts,
): Promise<void> {
  if (
    prepared.preInstall.length === 0 &&
    prepared.postInstall.length === 0 &&
    prepared.preparedDependencies.length === 0
  ) {
    return;
  }

  runHookPhase("pre-install", prepared.preInstall, installedSkillDir, prepared.events);

  for (const dep of prepared.preparedDependencies) {
    const destinationPath = ensureInsideRoot(installedSkillDir, dep.targetPath);
    if (fs.existsSync(destinationPath)) {
      throw new Error(
        `Dependency[${dep.index}] destination already exists: ${path.relative(
          installedSkillDir,
          destinationPath,
        )}`,
      );
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (dep.kind === "local") {
      const stat = fs.statSync(dep.sourcePath);
      if (stat.isDirectory()) {
        fs.cpSync(dep.sourcePath, destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      } else {
        fs.copyFileSync(dep.sourcePath, destinationPath);
      }
    } else if (dep.kind === "remote-bytes") {
      fs.copyFileSync(dep.remoteBufferPath, destinationPath);
    } else {
      try {
        fs.renameSync(dep.repoStagePath, destinationPath);
      } catch (error: unknown) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "";
        if (code !== "EXDEV") {
          throw error;
        }
        fs.cpSync(dep.repoStagePath, destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      }
    }

    prepared.events.push({
      level: "info",
      message: `[skills] dependency[${dep.index}] installed: ${dep.targetPath}`,
    });
  }

  runHookPhase("post-install", prepared.postInstall, installedSkillDir, prepared.events);
}

export async function runSkillInstaller(
  skillDir: string,
  sourceCwd: string,
  options: SkillInstallerRuntimeOptions = {},
): Promise<void> {
  const prepared = await prepareInstallerArtifacts(skillDir, sourceCwd, options);
  try {
    await applyInstallerArtifacts(skillDir, prepared);
  } finally {
    cleanupPreparedInstallerArtifacts(prepared);
  }
}
