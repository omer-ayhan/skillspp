import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENTS,
  detectInstalledAgents,
  filterInstalledAgents,
  getAgentSkillsDir,
  getAgentPluginsDir,
  resolveAgents,
} from "./agents";
import {
  assessLockEntries,
  type CheckOptions,
  type SkillAssessment,
} from "./check-analysis";
import { runValidateAnalysis } from "./validate-analysis";
import type {
  AddOptions,
  AgentType,
  InstallMode,
  ParsedSource,
  Skill,
} from "../contracts/runtime-types";
import { installSkill, installPlugin } from "./installer";
import {
  applyInstallerArtifacts,
  cleanupPreparedInstallerArtifacts,
  prepareInstallerArtifacts,
} from "./skill-installer";
import { hashDirectory, hashDirectoryAsync } from "./hash";
import {
  readLockfile,
  upsertLockEntry,
  writeLockfile,
  type LockEntry,
  type LockfileFormat,
} from "./lockfile";
import {
  detectLocalGlobalConflicts,
  detectTransitiveSkillConflicts,
  discoverTransitiveSkillCandidates,
} from "../sources/scanner";
import { parseSource } from "../sources/source-parser";
import { prepareSourceDirAsync, resolveGitHeadRefAsync } from "../sources/git";
import {
  discoverSkillsAsync,
  resolveSourceLabel,
  stageRemoteSkillFilesToTempDir,
} from "../sources/skills";
import {
  resolveCatalogSkills,
  resolveWellKnownSkills,
} from "../sources/source-resolution";
import {
  listSkillsMissingInstallerConfig,
  scaffoldInstallerConfigForSkills,
  type InstallerScaffoldFormat,
} from "./installer-scaffold";
import { assertExperimentalFeatureEnabled } from "../application/experimental";
import type {
  AddFetchOrDiscoverTaskResult,
  AddInstallTaskResult,
  BackgroundTaskRequest,
  BackgroundTaskResult,
  CheckScanTaskResult,
  FindInventoryTaskResult,
  ListDetectAgentsTaskResult,
  ListInventoryRow,
  ListScanInventoryTaskResult,
  UpdateApplyTaskResult,
  UpdateAssessTaskResult,
  UpdateMigrateTaskResult,
  ValidateRunTaskResult,
} from "./background-task-contracts";

type ProgressReporter = (label: string) => Promise<void> | void;

function serializeAssessments(
  assessments: SkillAssessment[],
): UpdateAssessTaskResult["assessments"] {
  return assessments.map((assessment) => ({
    entry: assessment.entry,
    drift: assessment.drift,
  }));
}

function resolveAddGlobalInstall(options: AddOptions): boolean {
  if (options.globalFlagProvided) {
    return Boolean(options.global);
  }
  return false;
}

function resolveAddInstallMode(options: AddOptions): InstallMode {
  if (options.symlinkFlagProvided) {
    return "symlink";
  }
  return "copy";
}

function resolveAddInstallerScaffoldFormat(
  options: AddOptions,
  missingCount: number,
): InstallerScaffoldFormat | undefined {
  if (missingCount === 0) {
    return undefined;
  }
  return options.yaml ? "yaml" : "json";
}

function sourceHashForInstalledSkill(options: {
  parsedSource: ParsedSource;
  skillPath: string;
  beforeHash?: string;
}): string {
  if (options.parsedSource.type === "local") {
    return hashDirectory(options.skillPath);
  }
  return options.beforeHash || hashDirectory(options.skillPath);
}

function canonicalSourceIdentity(options: {
  parsedSource: ParsedSource;
  wellKnownSourceUrl?: string;
}): string {
  if (options.parsedSource.type === "local") {
    return options.parsedSource.localPath;
  }
  if (options.parsedSource.type === "well-known") {
    return options.wellKnownSourceUrl || options.parsedSource.url;
  }
  if (options.parsedSource.type === "catalog") {
    return options.wellKnownSourceUrl || options.parsedSource.url;
  }
  if (options.parsedSource.type === "github") {
    const suffix = options.parsedSource.subpath
      ? `#${options.parsedSource.subpath}`
      : "";
    return `${options.parsedSource.repoUrl}${suffix}`;
  }
  return options.parsedSource.repoUrl;
}

function resolveSafeRealPath(inputPath: string): string {
  try {
    return fs.realpathSync(inputPath);
  } catch {
    return path.resolve(inputPath);
  }
}

function isLocalSymlinkSource(localPath: string): boolean {
  try {
    if (!fs.existsSync(localPath)) {
      return false;
    }
    return fs.lstatSync(localPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function lockfileNameForFormat(format: LockfileFormat): string {
  return format === "yaml" ? "skillspp-lock.yaml" : "skillspp-lock.json";
}

function staleLockfileNameForFormat(format: LockfileFormat): string {
  return format === "yaml" ? "skillspp-lock.json" : "skillspp-lock.yaml";
}

function propagateLockfileVisibility(options: {
  canonicalDir: string;
  targetDirs: string[];
  lockFormat: LockfileFormat;
}): void {
  const lockName = lockfileNameForFormat(options.lockFormat);
  const staleLockName = staleLockfileNameForFormat(options.lockFormat);
  const canonicalLockPath = path.join(options.canonicalDir, lockName);
  const canonicalRealPath = fs.existsSync(options.canonicalDir)
    ? fs.realpathSync(options.canonicalDir)
    : path.resolve(options.canonicalDir);

  for (const targetDir of options.targetDirs) {
    const targetRealPath = fs.existsSync(targetDir)
      ? fs.realpathSync(targetDir)
      : path.resolve(targetDir);
    if (targetRealPath === canonicalRealPath) {
      continue;
    }

    const targetLockPath = path.join(targetDir, lockName);
    const staleTargetPath = path.join(targetDir, staleLockName);
    fs.copyFileSync(canonicalLockPath, targetLockPath);
    if (fs.existsSync(staleTargetPath)) {
      fs.rmSync(staleTargetPath, { force: true });
    }
  }
}

function writeLockEntryAfterInstall(options: {
  globalInstall: boolean;
  cwd: string;
  sourceInput: string;
  sourceType: ParsedSource["type"];
  sourceCanonical?: string;
  sourcePinnedRef?: string;
  sourceResolvedPath?: string;
  sourceIsSymlink?: boolean;
  sourceSkillName: string;
  sourceSkillPath?: string;
  wellKnownSourceUrl?: string;
  sourceHash: string;
  outcome: {
    skillName: string;
    canonicalDir: string;
    installedTo: Array<{
      agent: AgentType;
      path: string;
      mode: InstallMode;
    }>;
  };
  mode: InstallMode;
  lockFormat?: LockfileFormat;
}): void {
  const installedHash = hashDirectory(options.outcome.canonicalDir);
  const lock = readLockfile(options.globalInstall, options.cwd);
  const entry = {
    skillName: options.outcome.skillName,
    global: options.globalInstall,
    installMode: options.mode,
    agents: options.outcome.installedTo.map((row) => row.agent),
    canonicalDir: options.outcome.canonicalDir,
    source: {
      input: options.sourceInput,
      type: options.sourceType,
      canonical: options.sourceCanonical,
      pinnedRef: options.sourcePinnedRef,
      resolvedPath: options.sourceResolvedPath,
      isSymlinkSource: options.sourceIsSymlink,
      selector: {
        skillName: options.sourceSkillName,
        relativePath: options.sourceSkillPath,
        wellKnownSourceUrl: options.wellKnownSourceUrl,
      },
    },
    sourceHash: options.sourceHash,
    installedHash,
    updatedAt: new Date().toISOString(),
  };

  const next = upsertLockEntry(lock, entry);
  writeLockfile(
    options.globalInstall,
    options.cwd,
    next,
    options.lockFormat || "json",
  );

  const selectedFormat = options.lockFormat || "json";
  propagateLockfileVisibility({
    canonicalDir: options.outcome.canonicalDir,
    targetDirs: options.outcome.installedTo.map((destination) => destination.path),
    lockFormat: selectedFormat,
  });

  const staleLockPath = path.join(
    options.outcome.canonicalDir,
    staleLockfileNameForFormat(selectedFormat),
  );
  if (fs.existsSync(staleLockPath)) {
    fs.rmSync(staleLockPath, { force: true });
  }
}

type StagedRemoteSkill = {
  skill: Skill;
  cleanup: () => void;
};

function buildRemoteSkill(remote: {
  installName: string;
  description: string;
  files: Map<string, string>;
}): StagedRemoteSkill {
  const staged = stageRemoteSkillFilesToTempDir(remote.files);
  return {
    skill: {
      name: remote.installName,
      description: remote.description,
      path: staged.path,
    },
    cleanup: staged.cleanup,
  };
}

async function runCheckScanTask(
  cwd: string,
  options: CheckOptions,
  emitProgress: ProgressReporter,
): Promise<CheckScanTaskResult> {
  await emitProgress("checking drift");
  const assessed = await assessLockEntries(options, cwd, {
    keepResolved: false,
  });

  await emitProgress("checking local/global conflicts");
  const conflicts = detectLocalGlobalConflicts(cwd);

  await emitProgress("checking transitive conflicts");
  const transitiveCandidates = discoverTransitiveSkillCandidates(cwd);
  const transitiveConflicts =
    detectTransitiveSkillConflicts(transitiveCandidates);

  return {
    drift: assessed.drift,
    checked: assessed.checked,
    conflicts,
    transitiveConflicts,
  };
}

async function runUpdateAssessTask(
  cwd: string,
  options: CheckOptions,
  emitProgress: ProgressReporter,
): Promise<UpdateAssessTaskResult> {
  await emitProgress("assessing drift");
  const assessed = await assessLockEntries(options, cwd, {
    keepResolved: false,
  });
  return {
    assessments: serializeAssessments(assessed.assessments),
  };
}

function createBackupDir(skillName: string, sourceDir: string): string {
  const backupRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "skillspp-update-backup-"),
  );
  const backupDir = path.join(backupRoot, skillName);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.cpSync(sourceDir, backupDir, { recursive: true, force: true });
  return backupDir;
}

async function applyEntryUpdate(
  assessment: SkillAssessment,
  options: BackgroundTaskRequest<"update.apply">["payload"]["options"],
  cwd: string,
): Promise<LockEntry> {
  const { entry } = assessment;
  if (!assessment.resolved || !assessment.sourceHash) {
    throw new Error(`No resolved source available for ${entry.skillName}`);
  }

  const resolved = assessment.resolved;
  const sourceHash = assessment.sourceHash;
  const backupDir = createBackupDir(entry.skillName, entry.canonicalDir);

  try {
    const preparedInstaller = await prepareInstallerArtifacts(
      resolved.skill.path,
      cwd,
      {
        sourceType: entry.source.type,
        policyMode: options.policyMode || "enforce",
        trustWellKnown: Boolean(options.trustWellKnown),
      },
    );

    const outcome = installSkill(resolved.skill, entry.agents as AgentType[], {
      mode: entry.installMode,
      globalInstall: entry.global,
      cwd,
    });

    try {
      await applyInstallerArtifacts(outcome.canonicalDir, preparedInstaller);
    } finally {
      cleanupPreparedInstallerArtifacts(preparedInstaller);
    }

    const installedHash = await hashDirectoryAsync(outcome.canonicalDir);

    return {
      ...entry,
      source: {
        ...entry.source,
        canonical:
          assessment.refreshedSource?.canonical ?? entry.source.canonical,
        pinnedRef:
          assessment.refreshedSource?.pinnedRef ?? entry.source.pinnedRef,
        resolvedPath:
          assessment.refreshedSource?.resolvedPath ?? entry.source.resolvedPath,
        isSymlinkSource:
          assessment.refreshedSource?.isSymlinkSource ??
          entry.source.isSymlinkSource,
        selector: {
          ...entry.source.selector,
          relativePath:
            assessment.refreshedSource?.sourceSkillPath ??
            entry.source.selector.relativePath,
          wellKnownSourceUrl:
            assessment.refreshedSource?.wellKnownSourceUrl ??
            entry.source.selector.wellKnownSourceUrl,
        },
      },
      sourceHash,
      installedHash,
      canonicalDir: outcome.canonicalDir,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const rollbackSkill = {
      name: entry.skillName,
      description: `Rollback for ${entry.skillName}`,
      path: backupDir,
    };

    installSkill(rollbackSkill, entry.agents as AgentType[], {
      mode: entry.installMode,
      globalInstall: entry.global,
      cwd,
    });

    throw error;
  } finally {
    fs.rmSync(path.dirname(backupDir), { recursive: true, force: true });
    if (resolved.cleanup) {
      resolved.cleanup();
    }
  }
}

async function runUpdateApplyTask(
  payload: BackgroundTaskRequest<"update.apply">["payload"],
  emitProgress: ProgressReporter,
): Promise<UpdateApplyTaskResult> {
  const selectedOptions = {
    ...payload.options,
    skill: payload.selectedSkillNames,
  };

  await emitProgress("assessing selected skills");
  const assessed = await assessLockEntries(selectedOptions, payload.cwd, {
    keepResolved: true,
  });

  const candidateAssessments = assessed.assessments.filter((assessment) =>
    !assessment.drift.some((item) => item.kind === "migrate-required") &&
    assessment.drift.some(
      (item) =>
        item.kind === "changed-source" || item.kind === "local-modified",
    ),
  );

  let nextLock = readLockfile(Boolean(payload.options.global), payload.cwd);
  const updatedEntries: LockEntry[] = [];
  const ordered = [...candidateAssessments].sort((a, b) =>
    a.entry.skillName.localeCompare(b.entry.skillName),
  );

  try {
    for (const assessment of ordered) {
      await emitProgress(`updating ${assessment.entry.skillName}`);
      const updated = await applyEntryUpdate(
        assessment,
        payload.options,
        payload.cwd,
      );
      updatedEntries.push(updated);
      nextLock = upsertLockEntry(nextLock, updated);
    }

    await emitProgress("writing lockfile");
    writeLockfile(
      Boolean(payload.options.global),
      payload.cwd,
      nextLock,
      payload.lockFormat,
    );
    for (const updated of updatedEntries) {
      const targetDirs = Array.from(
        new Set(
          updated.agents.map((agent) =>
            path.join(
              getAgentSkillsDir(agent, updated.global, payload.cwd),
              updated.skillName,
            ),
          ),
        ),
      );
      propagateLockfileVisibility({
        canonicalDir: updated.canonicalDir,
        targetDirs,
        lockFormat: payload.lockFormat,
      });
    }

    return {
      updatedSkillNames: ordered.map(
        (assessment) => assessment.entry.skillName,
      ),
    };
  } finally {
    for (const assessment of assessed.assessments) {
      if (assessment.resolved?.cleanup) {
        assessment.resolved.cleanup();
      }
    }
  }
}

type ResolvedMigrationSource = {
  parsedSource: ParsedSource;
  skill: Skill;
  sourceSkillPath?: string;
  wellKnownSourceUrl?: string;
  sourceHash: string;
  sourceCanonical: string;
  sourcePinnedRef?: string;
  sourceResolvedPath?: string;
  sourceIsSymlink?: boolean;
  cleanup?: () => void;
};

async function resolveMigrationSource(options: {
  sourceInput: string;
  skillName: string;
  addOptions: AddOptions;
}): Promise<ResolvedMigrationSource> {
  const parsedSource = parseSource(options.sourceInput);

  if (parsedSource.type === "well-known" || parsedSource.type === "catalog") {
    const remoteSkills =
      parsedSource.type === "well-known"
        ? await resolveWellKnownSkills(parsedSource.url, options.addOptions)
        : await resolveCatalogSkills(parsedSource.url, options.addOptions);
    const remote = remoteSkills.find(
      (item) => item.installName === options.skillName,
    );
    if (!remote) {
      throw new Error(`Skill '${options.skillName}' not found in migration source`);
    }
    const staged = buildRemoteSkill(remote);
    const sourceHash = hashDirectory(staged.skill.path);
    return {
      parsedSource,
      skill: staged.skill,
      sourceHash,
      sourceCanonical: canonicalSourceIdentity({
        parsedSource,
        wellKnownSourceUrl: remote.sourceUrl,
      }),
      sourcePinnedRef: sourceHash,
      wellKnownSourceUrl: remote.sourceUrl,
      cleanup: staged.cleanup,
    };
  }

  const prepared = await prepareSourceDirAsync(
    parsedSource as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );
  try {
    const skills = await discoverSkillsAsync(prepared.basePath);
    const skill = skills.find((item) => item.name === options.skillName);
    if (!skill) {
      throw new Error(`Skill '${options.skillName}' not found in migration source`);
    }
    const sourceHash = sourceHashForInstalledSkill({
      parsedSource,
      skillPath: skill.path,
    });
    const sourcePinnedRef =
      parsedSource.type === "github" || parsedSource.type === "git"
        ? await resolveGitHeadRefAsync(prepared.basePath)
        : undefined;
    return {
      parsedSource,
      skill,
      sourceSkillPath: path.relative(prepared.basePath, skill.path) || ".",
      sourceHash,
      sourceCanonical: canonicalSourceIdentity({ parsedSource }),
      sourcePinnedRef,
      sourceResolvedPath:
        parsedSource.type === "local" ? resolveSafeRealPath(skill.path) : undefined,
      sourceIsSymlink:
        parsedSource.type === "local"
          ? isLocalSymlinkSource(parsedSource.localPath)
          : undefined,
      cleanup: prepared.cleanup,
    };
  } catch (error) {
    if (prepared.cleanup) {
      prepared.cleanup();
    }
    throw error;
  }
}

async function runUpdateMigrateTask(
  payload: BackgroundTaskRequest<"update.migrate">["payload"],
  emitProgress: ProgressReporter,
): Promise<UpdateMigrateTaskResult> {
  await emitProgress("resolving migration source");
  const lock = readLockfile(Boolean(payload.options.global), payload.cwd);
  const entry = lock.entries.find((item) => item.skillName === payload.skillName);
  if (!entry) {
    throw new Error(`Unknown skill for migration: ${payload.skillName}`);
  }

  const source = await resolveMigrationSource({
    sourceInput: payload.sourceInput,
    skillName: payload.skillName,
    addOptions: payload.options,
  });
  const backupDir = createBackupDir(entry.skillName, entry.canonicalDir);

  try {
    await emitProgress(`migrating ${entry.skillName}`);
    const preparedInstaller = await prepareInstallerArtifacts(
      source.skill.path,
      payload.cwd,
      {
        sourceType: source.parsedSource.type,
        policyMode: payload.options.policyMode || "enforce",
        trustWellKnown: Boolean(payload.options.trustWellKnown),
      },
    );
    const outcome = installSkill(source.skill, entry.agents as AgentType[], {
      mode: entry.installMode,
      globalInstall: entry.global,
      cwd: payload.cwd,
    });

    try {
      await applyInstallerArtifacts(outcome.canonicalDir, preparedInstaller);
      await emitProgress("writing lockfile");
      writeLockEntryAfterInstall({
        globalInstall: entry.global,
        cwd: payload.cwd,
        sourceInput: payload.sourceInput,
        sourceType: source.parsedSource.type,
        sourceCanonical: source.sourceCanonical,
        sourcePinnedRef: source.sourcePinnedRef,
        sourceResolvedPath: source.sourceResolvedPath,
        sourceIsSymlink: source.sourceIsSymlink,
        sourceSkillName: source.skill.name,
        sourceSkillPath: source.sourceSkillPath,
        wellKnownSourceUrl: source.wellKnownSourceUrl,
        sourceHash: source.sourceHash,
        outcome,
        mode: entry.installMode,
        lockFormat: payload.lockFormat,
      });
    } finally {
      cleanupPreparedInstallerArtifacts(preparedInstaller);
    }
  } catch (error) {
    const rollbackSkill = {
      name: entry.skillName,
      description: `Rollback for ${entry.skillName}`,
      path: backupDir,
    };

    installSkill(rollbackSkill, entry.agents as AgentType[], {
      mode: entry.installMode,
      globalInstall: entry.global,
      cwd: payload.cwd,
    });
    throw error;
  } finally {
    fs.rmSync(path.dirname(backupDir), { recursive: true, force: true });
    if (source.cleanup) {
      source.cleanup();
    }
  }

  return { skillName: entry.skillName };
}

async function runListDetectAgentsTask(
  cwd: string,
  options: BackgroundTaskRequest<"list.detectAgents">["payload"]["options"],
  emitProgress: ProgressReporter,
): Promise<ListDetectAgentsTaskResult> {
  await emitProgress("detecting installed agents");
  const agents = options.agent
    ? filterInstalledAgents(resolveAgents(options.agent), cwd)
    : detectInstalledAgents(cwd);
  return { agents };
}

async function runListScanInventoryTask(
  payload: BackgroundTaskRequest<"list.scanInventory">["payload"],
  emitProgress: ProgressReporter,
): Promise<ListScanInventoryTaskResult> {
  const grouped = new Map<
    string,
    { name: string; resolvedPath: string; agents: Set<string> }
  >();

  for (const agent of payload.agents) {
    await emitProgress(
      `scanning installed skills (${AGENTS[agent].displayName})`,
    );
    const dir = getAgentSkillsDir(agent, payload.globalInstall, payload.cwd);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      let resolvedPath = fullPath;
      try {
        resolvedPath = fs.realpathSync(fullPath);
      } catch {
        resolvedPath = fullPath;
      }

      const key = `${entry.name}:${resolvedPath}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.agents.add(AGENTS[agent].displayName);
      } else {
        grouped.set(key, {
          name: entry.name,
          resolvedPath,
          agents: new Set([AGENTS[agent].displayName]),
        });
      }
    }
  }

  const rows: ListInventoryRow[] = Array.from(grouped.values())
    .map((row) => ({
      name: row.name,
      resolvedPath: row.resolvedPath,
      agents: Array.from(row.agents).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows };
}

async function resolveAddSourceSkills(
  sourceInput: string,
  options: AddOptions,
  emitProgress: ProgressReporter,
): Promise<AddFetchOrDiscoverTaskResult> {
  const parsed = parseSource(sourceInput);

  if (parsed.type === "well-known" || parsed.type === "catalog") {
    await emitProgress("fetching skill index");
    const remoteSkills =
      parsed.type === "well-known"
        ? await resolveWellKnownSkills(parsed.url, options)
        : await resolveCatalogSkills(parsed.url, options);
    if (remoteSkills.length === 0) {
      throw new Error("No skills found at remote endpoint");
    }
    return {
      skills: remoteSkills.map((skill) => ({
        name: skill.installName,
        description: skill.description,
      })),
    };
  }

  await emitProgress("loading source");
  const prepared = await prepareSourceDirAsync(
    parsed as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );
  try {
    const skills = await discoverSkillsAsync(prepared.basePath);
    return {
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
    };
  } finally {
    if (prepared.cleanup) {
      prepared.cleanup();
    }
  }
}

async function installSelectedAddSkills(
  payload: BackgroundTaskRequest<"add.install">["payload"],
  emitProgress: ProgressReporter,
): Promise<AddInstallTaskResult> {
  const parsedSource = parseSource(payload.sourceInput);
  const globalInstall = resolveAddGlobalInstall(payload.options);
  const mode = resolveAddInstallMode(payload.options);

  if (parsedSource.type === "well-known" || parsedSource.type === "catalog") {
    await emitProgress("fetching selected skills");
    const remoteSkills =
      parsedSource.type === "well-known"
        ? await resolveWellKnownSkills(parsedSource.url, payload.options)
        : await resolveCatalogSkills(parsedSource.url, payload.options);
    const remoteByName = new Map(
      remoteSkills.map((remote) => [remote.installName, remote]),
    );

    const tempCleanups: Array<() => void> = [];
    const stagedSelected: Skill[] = [];
    const sourceHashesBefore = new Map<string, string>();

    try {
      for (const skillName of payload.selectedSkillNames) {
        const remote = remoteByName.get(skillName);
        if (!remote) {
          throw new Error(`No matching well-known skills found in source`);
        }
        const staged = buildRemoteSkill(remote);
        tempCleanups.push(staged.cleanup);
        stagedSelected.push(staged.skill);
        sourceHashesBefore.set(
          staged.skill.path,
          hashDirectory(staged.skill.path),
        );
      }

      const missingInstallerSkillDirs = listSkillsMissingInstallerConfig(
        stagedSelected.map((item) => item.path),
      );
      const scaffoldFormat = resolveAddInstallerScaffoldFormat(
        payload.options,
        missingInstallerSkillDirs.length,
      );
      if (scaffoldFormat) {
        scaffoldInstallerConfigForSkills(
          missingInstallerSkillDirs,
          scaffoldFormat,
        );
      }

      for (const localSkill of stagedSelected) {
        const remote = remoteByName.get(localSkill.name);
        if (!remote) {
          throw new Error(
            `Could not resolve remote metadata for selected skill '${localSkill.name}'`,
          );
        }

        const sourceHash =
          sourceHashesBefore.get(localSkill.path) || hashDirectory(localSkill.path);
        const sourceCanonical = canonicalSourceIdentity({
          parsedSource,
          wellKnownSourceUrl: remote.sourceUrl,
        });

        await emitProgress(`installing ${localSkill.name}`);
        const preparedInstaller = await prepareInstallerArtifacts(
          localSkill.path,
          payload.cwd,
          {
            sourceType: parsedSource.type,
            policyMode: payload.options.policyMode || "enforce",
            trustWellKnown: Boolean(payload.options.trustWellKnown),
          },
        );
        const outcome = installSkill(
          localSkill,
          payload.agents as AgentType[],
          {
            mode,
            globalInstall,
            cwd: payload.cwd,
          },
        );

        try {
          await applyInstallerArtifacts(
            outcome.canonicalDir,
            preparedInstaller,
          );
          writeLockEntryAfterInstall({
            globalInstall,
            cwd: payload.cwd,
            sourceInput: payload.sourceInput,
            sourceType: parsedSource.type,
            sourceCanonical,
            sourcePinnedRef: sourceHash,
            sourceSkillName: remote.installName,
            sourceHash,
            wellKnownSourceUrl: remote.sourceUrl,
            outcome,
            mode,
            lockFormat: payload.options.lockFormat,
          });
        } finally {
          cleanupPreparedInstallerArtifacts(preparedInstaller);
        }
      }
    } finally {
      for (const cleanup of tempCleanups) {
        cleanup();
      }
    }

    return {
      installedSkillNames: [...payload.selectedSkillNames],
      agentCount: payload.agents.length,
    };
  }

  await emitProgress("loading source");
  const prepared = await prepareSourceDirAsync(
    parsedSource as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );

  try {
    const sourceCanonical = canonicalSourceIdentity({ parsedSource });
    const sourcePinnedRef =
      parsedSource.type === "github" || parsedSource.type === "git"
        ? await resolveGitHeadRefAsync(prepared.basePath)
        : undefined;
    const sourceIsSymlink =
      parsedSource.type === "local"
        ? isLocalSymlinkSource(parsedSource.localPath)
        : undefined;
    const skills = await discoverSkillsAsync(prepared.basePath);
    const selected = skills.filter((skill) =>
      payload.selectedSkillNames.includes(skill.name),
    );
    if (selected.length === 0) {
      throw new Error("No matching skills found in source");
    }

    const sourceHashesBefore = new Map(
      selected.map((skill) => [skill.path, hashDirectory(skill.path)]),
    );
    const missingInstallerSkillDirs = listSkillsMissingInstallerConfig(
      selected.map((skill) => skill.path),
    );
    const scaffoldFormat = resolveAddInstallerScaffoldFormat(
      payload.options,
      missingInstallerSkillDirs.length,
    );
    if (scaffoldFormat) {
      scaffoldInstallerConfigForSkills(
        missingInstallerSkillDirs,
        scaffoldFormat,
      );
    }

    for (const skill of selected) {
      const sourceResolvedPath =
        parsedSource.type === "local"
          ? resolveSafeRealPath(skill.path)
          : undefined;

      await emitProgress(`installing ${skill.name}`);
      const sourceSkillPath =
        path.relative(prepared.basePath, skill.path) || ".";
      const preparedInstaller = await prepareInstallerArtifacts(
        skill.path,
        payload.cwd,
        {
          sourceType: parsedSource.type,
          policyMode: payload.options.policyMode || "enforce",
          trustWellKnown: Boolean(payload.options.trustWellKnown),
        },
      );
      const outcome = installSkill(skill, payload.agents as AgentType[], {
        mode,
        globalInstall,
        cwd: payload.cwd,
      });

      try {
        await applyInstallerArtifacts(outcome.canonicalDir, preparedInstaller);
        writeLockEntryAfterInstall({
          globalInstall,
          cwd: payload.cwd,
          sourceInput: payload.sourceInput,
          sourceType: parsedSource.type,
          sourceCanonical,
          sourcePinnedRef,
          sourceResolvedPath,
          sourceIsSymlink,
          sourceSkillName: skill.name,
          sourceSkillPath,
          sourceHash: sourceHashForInstalledSkill({
            parsedSource,
            skillPath: skill.path,
            beforeHash: sourceHashesBefore.get(skill.path),
          }),
          outcome,
          mode,
          lockFormat: payload.options.lockFormat,
        });
      } finally {
        cleanupPreparedInstallerArtifacts(preparedInstaller);
      }
    }

    return {
      installedSkillNames: selected.map((skill) => skill.name),
      agentCount: payload.agents.length,
    };
  } finally {
    if (prepared.cleanup) {
      prepared.cleanup();
    }
  }
}

async function runFindFetchInventoryTask(
  sourceInput: string,
  options: BackgroundTaskRequest<"find.fetchInventory">["payload"]["options"],
  emitProgress: ProgressReporter,
): Promise<FindInventoryTaskResult> {
  await emitProgress("parsing source");
  const parsedSource = parseSource(sourceInput);
  const sourceLabel = resolveSourceLabel(parsedSource);

  await emitProgress("fetching skill inventory");
  if (parsedSource.type === "well-known" || parsedSource.type === "catalog") {
    if (parsedSource.type === "catalog") {
      assertExperimentalFeatureEnabled(
        "catalog",
        Boolean(options.experimental),
      );
    }

    const remoteSkills =
      parsedSource.type === "well-known"
        ? await resolveWellKnownSkills(parsedSource.url, {
            allowHost: options.allowHost,
            denyHost: options.denyHost,
            maxDownloadBytes: options.maxDownloadBytes,
            experimental: options.experimental,
          })
        : await resolveCatalogSkills(parsedSource.url, {
            allowHost: options.allowHost,
            denyHost: options.denyHost,
            maxDownloadBytes: options.maxDownloadBytes,
            experimental: options.experimental,
          });
    return {
      sourceType: parsedSource.type,
      sourceLabel,
      skills: remoteSkills.map((item) => ({
        name: item.installName,
        description: item.description,
      })),
    };
  }

  const prepared = await prepareSourceDirAsync(parsedSource);
  try {
    const discovered = await discoverSkillsAsync(prepared.basePath);
    return {
      sourceType: parsedSource.type,
      sourceLabel,
      skills: discovered.map((item) => ({
        name: item.name,
        description: item.description,
      })),
    };
  } finally {
    if (prepared.cleanup) {
      prepared.cleanup();
    }
  }
}

async function runValidateRunTask(
  options: BackgroundTaskRequest<"validate.run">["payload"]["options"],
  emitProgress: ProgressReporter,
): Promise<ValidateRunTaskResult> {
  return await runValidateAnalysis(options, emitProgress);
}

function runBlockingTask(
  payload: BackgroundTaskRequest<"test.blocking">["payload"],
): BackgroundTaskResult<"test.blocking"> {
  const end = Date.now() + payload.durationMs;
  while (Date.now() < end) {
    Math.sqrt(Math.random() * Number.MAX_SAFE_INTEGER);
  }
  return { durationMs: payload.durationMs };
}

export async function executeBackgroundTask(
  request: BackgroundTaskRequest,
  emitProgress: ProgressReporter,
): Promise<BackgroundTaskResult> {
  switch (request.kind) {
    case "check.scan":
      return await runCheckScanTask(
        request.payload.cwd,
        request.payload.options,
        emitProgress,
      );
    case "update.assess":
      return await runUpdateAssessTask(
        request.payload.cwd,
        request.payload.options,
        emitProgress,
      );
    case "update.apply":
      return await runUpdateApplyTask(request.payload, emitProgress);
    case "update.migrate":
      return await runUpdateMigrateTask(request.payload, emitProgress);
    case "list.detectAgents":
      return await runListDetectAgentsTask(
        request.payload.cwd,
        request.payload.options,
        emitProgress,
      );
    case "list.scanInventory":
      return await runListScanInventoryTask(request.payload, emitProgress);
    case "add.fetchOrDiscover":
      return await resolveAddSourceSkills(
        request.payload.sourceInput,
        request.payload.options,
        emitProgress,
      );
    case "add.install":
      return await installSelectedAddSkills(request.payload, emitProgress);
    case "find.fetchInventory":
      return await runFindFetchInventoryTask(
        request.payload.sourceInput,
        request.payload.options,
        emitProgress,
      );
    case "validate.run":
      return await runValidateRunTask(request.payload.options, emitProgress);
    case "test.blocking":
      if (request.payload.progressLabel) {
        await emitProgress(request.payload.progressLabel);
      }
      return runBlockingTask(request.payload);
    default:
      throw new Error(`Unsupported background task: ${String(request)}`);
  }
}
