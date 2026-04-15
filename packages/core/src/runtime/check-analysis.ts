import fs from "node:fs";
import path from "node:path";
import type { AddOptions, ParsedSource, Skill } from "../contracts/runtime-types";
import type { DriftRecord } from "../contracts/results";
import type { RemoteSkill } from "../providers";
import type { SourceCandidate } from "../sources/source-resolution";
import { discoverSkillsAsync, stageRemoteSkillFilesToTempDir } from "../sources/skills";
import { resolveCatalogSkills, resolveWellKnownSkills } from "../sources/source-resolution";
import { parseSource } from "../sources/source-parser";
import { prepareSourceDirAsync, resolveGitHeadRefAsync } from "../sources/git";
import { hashDirectoryAsync } from "./hash";
import {
  buildSourceLoadCacheKey,
  listCanonicalSkillDirs,
  readLockfile,
  resolveSourceLoadInput,
  type LockEntry,
} from "./lockfile";

export type SkillAssessment = {
  entry: LockEntry;
  drift: DriftRecord[];
  sourceHash?: string;
  resolved?: SourceCandidate;
  refreshedSource?: {
    canonical?: string;
    pinnedRef?: string;
    resolvedPath?: string;
    isSymlinkSource?: boolean;
    sourceSkillPath?: string;
    wellKnownSourceUrl?: string;
  };
};

export type CheckOptions = {
  global?: boolean;
  skill?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  policyMode?: "enforce" | "warn";
  experimental?: boolean;
};

function includeBySkill(entry: LockEntry, selected?: string[]): boolean {
  if (!selected || selected.length === 0 || selected.includes("*")) {
    return true;
  }
  return selected.includes(entry.skillName);
}

type CachedPreparedSource = {
  kind: "prepared";
  basePath: string;
  skills: Skill[];
  cleanupNow: () => void;
  retainCleanup: () => () => void;
};

type CachedRemoteSource = {
  kind: "remote";
  remoteSkills: RemoteSkill[];
};

type CachedSource = CachedPreparedSource | CachedRemoteSource;

type AsyncResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function migrateHint(skillName: string): string {
  return `skillspp update ${skillName} --migrate <new-skill-source>`;
}

function resolveSourceMetadataIssue(entry: LockEntry): string | null {
  if (!entry.source.canonical) {
    return `source canonical metadata missing; run ${migrateHint(entry.skillName)}`;
  }

  if (entry.source.type === "local") {
    if (!entry.source.resolvedPath) {
      return `local source metadata missing; run ${migrateHint(entry.skillName)}`;
    }
    if (!fs.existsSync(entry.source.canonical)) {
      return `local source path not found; run ${migrateHint(entry.skillName)}`;
    }
    return null;
  }

  if (!entry.source.pinnedRef) {
    return `remote pin metadata missing; run ${migrateHint(entry.skillName)}`;
  }
  return null;
}

function createRetainedCleanup(cleanup?: () => void): {
  cleanupNow: () => void;
  retainCleanup: () => () => void;
} {
  let cleaned = false;
  let refCount = 0;

  const runCleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    cleanup?.();
  };

  const cleanupNow = () => {
    if (refCount === 0) {
      runCleanup();
    }
  };

  const retainCleanup = () => {
    refCount += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      refCount -= 1;
      if (refCount === 0) {
        runCleanup();
      }
    };
  };

  return {
    cleanupNow,
    retainCleanup,
  };
}

function toAsyncResult<T>(promise: Promise<T>): Promise<AsyncResult<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

function unwrapAsyncResult<T>(result: AsyncResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw (result as { ok: false; error: unknown }).error;
}

async function loadCachedSource(entry: LockEntry, options: AddOptions): Promise<CachedSource> {
  const sourceInput = resolveSourceLoadInput(entry.source);
  const parsed = parseSource(sourceInput);

  if (parsed.type === "well-known" || parsed.type === "catalog") {
    const remoteSkills =
      parsed.type === "well-known"
        ? await resolveWellKnownSkills(parsed.url, options)
        : await resolveCatalogSkills(parsed.url, options);
    return {
      kind: "remote",
      remoteSkills,
    };
  }

  const prepared = await prepareSourceDirAsync(
    parsed as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );
  const retainedCleanup = createRetainedCleanup(prepared.cleanup);
  try {
    const skills = await discoverSkillsAsync(prepared.basePath);
    return {
      kind: "prepared",
      basePath: prepared.basePath,
      skills,
      cleanupNow: retainedCleanup.cleanupNow,
      retainCleanup: retainedCleanup.retainCleanup,
    };
  } catch (error) {
    retainedCleanup.cleanupNow();
    throw error;
  }
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

async function buildRefreshedSourceMetadata(
  entry: LockEntry,
  resolved: SourceCandidate,
  cachedSource: CachedSource,
  sourceHash: string,
): Promise<NonNullable<SkillAssessment["refreshedSource"]>> {
  if (entry.source.type === "local") {
    const canonical = entry.source.canonical || entry.source.input;
    return {
      canonical,
      resolvedPath: resolveSafeRealPath(resolved.skill.path),
      isSymlinkSource: isLocalSymlinkSource(canonical),
      sourceSkillPath: resolved.sourceSkillPath,
    };
  }

  if (entry.source.type === "git" || entry.source.type === "github") {
    const nextPinnedRef =
      cachedSource.kind === "prepared"
        ? await resolveGitHeadRefAsync(cachedSource.basePath)
        : entry.source.pinnedRef;
    return {
      canonical: entry.source.canonical,
      pinnedRef: nextPinnedRef,
      sourceSkillPath: resolved.sourceSkillPath,
    };
  }

  const canonical = resolved.wellKnownSourceUrl || entry.source.canonical;
  return {
    canonical,
    pinnedRef: sourceHash,
    wellKnownSourceUrl: resolved.wellKnownSourceUrl,
  };
}

function resolveCandidateFromCachedSource(
  entry: LockEntry,
  cachedSource: CachedSource,
  keepResolved: boolean,
): SourceCandidate {
  if (cachedSource.kind === "remote") {
    const matched = cachedSource.remoteSkills.find(
      (item) => item.installName === entry.source.selector.skillName,
    );
    if (!matched) {
      throw new Error(`Skill '${entry.source.selector.skillName}' not found in well-known source`);
    }

    const staged = stageRemoteSkillFilesToTempDir(matched.files);
    return {
      skill: {
        name: matched.installName,
        description: matched.description,
        path: staged.path,
      },
      wellKnownSourceUrl: matched.sourceUrl,
      cleanup: staged.cleanup,
    };
  }

  const matched = entry.source.selector.relativePath
    ? cachedSource.skills.find(
        (item) =>
          path.resolve(item.path) ===
          path.resolve(path.join(cachedSource.basePath, entry.source.selector.relativePath!)),
      )
    : cachedSource.skills.find((item) => item.name === entry.source.selector.skillName);

  if (!matched) {
    throw new Error(`Skill '${entry.source.selector.skillName}' not found in source`);
  }

  return {
    skill: matched,
    sourceSkillPath: path.relative(cachedSource.basePath, matched.path) || ".",
    cleanup: keepResolved ? cachedSource.retainCleanup() : undefined,
  };
}

export async function assessLockEntries(
  options: CheckOptions,
  cwd: string,
  behavior: { keepResolved: boolean } = { keepResolved: false },
): Promise<{
  drift: DriftRecord[];
  checked: number;
  assessments: SkillAssessment[];
}> {
  const lock = readLockfile(Boolean(options.global), cwd);
  const entries = lock.entries.filter((entry) => includeBySkill(entry, options.skill));
  const drift: DriftRecord[] = [];
  const assessments: SkillAssessment[] = [];
  const sourceOptions: AddOptions = {
    global: options.global,
    allowHost: options.allowHost,
    denyHost: options.denyHost,
    maxDownloadBytes: options.maxDownloadBytes,
    policyMode: options.policyMode,
    experimental: options.experimental,
  };
  const sourceCache = new Map<string, Promise<CachedSource>>();

  const getCachedSource = (entry: LockEntry): Promise<CachedSource> => {
    const key = buildSourceLoadCacheKey(entry.source);
    const existing = sourceCache.get(key);
    if (existing) {
      return existing;
    }

    const created = loadCachedSource(entry, sourceOptions);
    sourceCache.set(key, created);
    return created;
  };

  try {
    for (const entry of entries) {
      const assessment: SkillAssessment = {
        entry,
        drift: [],
      };

      if (!fs.existsSync(entry.canonicalDir) || !fs.statSync(entry.canonicalDir).isDirectory()) {
        const row: DriftRecord = {
          skillName: entry.skillName,
          kind: "local-modified",
          detail: "canonical directory is missing",
        };
        drift.push(row);
        assessment.drift.push(row);
        assessments.push(assessment);
        continue;
      }

      const installedHash = unwrapAsyncResult(
        await toAsyncResult(hashDirectoryAsync(entry.canonicalDir)),
      );
      if (installedHash !== entry.installedHash) {
        const row: DriftRecord = {
          skillName: entry.skillName,
          kind: "local-modified",
          detail: "installed content differs from lockfile hash",
        };
        drift.push(row);
        assessment.drift.push(row);
      }

      const metadataIssue = resolveSourceMetadataIssue(entry);
      if (metadataIssue) {
        const row: DriftRecord = {
          skillName: entry.skillName,
          kind: "migrate-required",
          detail: metadataIssue,
        };
        drift.push(row);
        assessment.drift.push(row);
        assessments.push(assessment);
        continue;
      }

      let resolved: SourceCandidate | undefined;
      try {
        const cachedSource = unwrapAsyncResult(await toAsyncResult(getCachedSource(entry)));
        resolved = resolveCandidateFromCachedSource(entry, cachedSource, behavior.keepResolved);

        if (entry.source.type === "local") {
          const currentResolvedPath = fs.realpathSync(resolved.skill.path);
          if (currentResolvedPath !== path.resolve(entry.source.resolvedPath!)) {
            const row: DriftRecord = {
              skillName: entry.skillName,
              kind: "migrate-required",
              detail: `local source identity changed; run ${migrateHint(entry.skillName)}`,
            };
            drift.push(row);
            assessment.drift.push(row);
            if (resolved.cleanup && !behavior.keepResolved) {
              resolved.cleanup();
              resolved = undefined;
            }
            assessments.push(assessment);
            continue;
          }
        }

        const sourceHash = await hashDirectoryAsync(resolved.skill.path);
        assessment.sourceHash = sourceHash;
        assessment.refreshedSource = await buildRefreshedSourceMetadata(
          entry,
          resolved,
          cachedSource,
          sourceHash,
        );
        if (sourceHash !== entry.sourceHash) {
          const row: DriftRecord = {
            skillName: entry.skillName,
            kind: "changed-source",
            detail: "source hash changed",
          };
          drift.push(row);
          assessment.drift.push(row);
        }

        if (behavior.keepResolved) {
          assessment.resolved = resolved;
        }
      } catch (error) {
        const asText = error instanceof Error ? error.message : String(error);
        const migrateRequired =
          entry.source.type === "local" &&
          (asText.includes("Local source not found") || asText.includes("not found in source"));
        const row: DriftRecord = {
          skillName: entry.skillName,
          kind: migrateRequired ? "migrate-required" : "missing-source",
          detail: migrateRequired
            ? `local source identity changed; run ${migrateHint(entry.skillName)}`
            : asText,
        };
        drift.push(row);
        assessment.drift.push(row);
      } finally {
        if (resolved?.cleanup && !behavior.keepResolved) {
          resolved.cleanup();
        }
      }

      assessments.push(assessment);
    }

    const canonical = listCanonicalSkillDirs(Boolean(options.global), cwd);
    const lockNames = new Set(lock.entries.map((item) => item.skillName));
    for (const skillName of canonical) {
      if (!lockNames.has(skillName) && includeBySkill({ skillName } as LockEntry, options.skill)) {
        drift.push({
          skillName,
          kind: "lock-missing",
          detail: "installed skill is not tracked in lockfile",
        });
      }
    }

    return { drift, checked: entries.length, assessments };
  } finally {
    if (!behavior.keepResolved) {
      for (const cachedSourcePromise of sourceCache.values()) {
        const cachedSource = await cachedSourcePromise.catch(() => null);
        if (cachedSource?.kind === "prepared") {
          cachedSource.cleanupNow();
        }
      }
    }
  }
}

export async function collectDrift(
  options: CheckOptions,
  cwd: string,
): Promise<{ drift: DriftRecord[]; checked: number }> {
  const assessed = await assessLockEntries(options, cwd, {
    keepResolved: false,
  });
  return { drift: assessed.drift, checked: assessed.checked };
}
