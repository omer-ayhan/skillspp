import fs from "node:fs";
import path from "node:path";
import type { AddOptions, Plugin, ParsedSource } from "../contracts/runtime-types";
import type { DriftRecord } from "../contracts/results";
import type { RemotePlugin } from "../providers";
import { discoverPluginsAsync, stageRemotePluginFilesToTempDir } from "../sources/plugins";
import { resolveCatalogPlugins, resolveWellKnownPlugins } from "../sources/source-resolution";
import { parseSource } from "../sources/source-parser";
import { prepareSourceDirAsync, resolveGitHeadRefAsync } from "../sources/git";
import { hashDirectoryAsync } from "./hash";
import {
  buildSourceLoadCacheKey,
  listCanonicalResourceDirs,
  readResourceLockfile,
  resolveSourceLoadInput,
  type LockEntry,
} from "./lockfile";

type PluginSourceCandidate = {
  plugin: Plugin;
  sourcePluginPath?: string;
  wellKnownSourceUrl?: string;
  cleanup?: () => void;
};

export type PluginAssessment = {
  entry: LockEntry;
  drift: DriftRecord[];
  sourceHash?: string;
  resolved?: PluginSourceCandidate;
  refreshedSource?: {
    canonical?: string;
    pinnedRef?: string;
    resolvedPath?: string;
    isSymlinkSource?: boolean;
    sourcePluginPath?: string;
    wellKnownSourceUrl?: string;
  };
};

export type PluginCheckOptions = {
  global?: boolean;
  plugin?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  policyMode?: "enforce" | "warn";
  experimental?: boolean;
};

function includeByPlugin(entry: LockEntry, selected?: string[]): boolean {
  if (!selected || selected.length === 0 || selected.includes("*")) {
    return true;
  }
  return selected.includes(entry.skillName);
}

type CachedPreparedSource = {
  kind: "prepared";
  basePath: string;
  plugins: Plugin[];
  cleanupNow: () => void;
  retainCleanup: () => () => void;
};

type CachedRemoteSource = {
  kind: "remote";
  remotePlugins: RemotePlugin[];
};

type CachedSource = CachedPreparedSource | CachedRemoteSource;

type AsyncResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

function migrateHint(pluginName: string): string {
  return `pluginspp update ${pluginName} --migrate <new-plugin-source>`;
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
    const remotePlugins =
      parsed.type === "well-known"
        ? await resolveWellKnownPlugins(parsed.url, options)
        : await resolveCatalogPlugins(parsed.url, options);
    return {
      kind: "remote",
      remotePlugins,
    };
  }

  const prepared = await prepareSourceDirAsync(
    parsed as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );
  const retainedCleanup = createRetainedCleanup(prepared.cleanup);
  try {
    const plugins = await discoverPluginsAsync(prepared.basePath);
    return {
      kind: "prepared",
      basePath: prepared.basePath,
      plugins,
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
  resolved: PluginSourceCandidate,
  cachedSource: CachedSource,
  sourceHash: string,
): Promise<NonNullable<PluginAssessment["refreshedSource"]>> {
  if (entry.source.type === "local") {
    const canonical = entry.source.canonical || entry.source.input;
    return {
      canonical,
      resolvedPath: resolveSafeRealPath(resolved.plugin.path),
      isSymlinkSource: isLocalSymlinkSource(canonical),
      sourcePluginPath: resolved.sourcePluginPath,
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
      sourcePluginPath: resolved.sourcePluginPath,
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
): PluginSourceCandidate {
  if (cachedSource.kind === "remote") {
    const matched = cachedSource.remotePlugins.find(
      (item) => item.installName === entry.source.selector.skillName,
    );
    if (!matched) {
      throw new Error(`Plugin '${entry.source.selector.skillName}' not found in well-known source`);
    }

    const staged = stageRemotePluginFilesToTempDir(matched.installName, matched.files);
    return {
      plugin: {
        name: matched.installName,
        description: matched.description,
        path: path.join(staged.path, "plugins", matched.installName),
      },
      wellKnownSourceUrl: matched.sourceUrl,
      cleanup: staged.cleanup,
    };
  }

  const matched = entry.source.selector.relativePath
    ? cachedSource.plugins.find(
        (item) =>
          path.resolve(item.path) ===
          path.resolve(path.join(cachedSource.basePath, entry.source.selector.relativePath!)),
      )
    : cachedSource.plugins.find((item) => item.name === entry.source.selector.skillName);

  if (!matched) {
    throw new Error(`Plugin '${entry.source.selector.skillName}' not found in source`);
  }

  return {
    plugin: matched,
    sourcePluginPath: path.relative(cachedSource.basePath, matched.path) || ".",
    cleanup: keepResolved ? cachedSource.retainCleanup() : undefined,
  };
}

export async function assessPluginLockEntries(
  options: PluginCheckOptions,
  cwd: string,
  behavior: { keepResolved: boolean } = { keepResolved: false },
): Promise<{
  drift: DriftRecord[];
  checked: number;
  assessments: PluginAssessment[];
}> {
  const lock = readResourceLockfile("plugin", Boolean(options.global), cwd);
  const entries = lock.entries.filter((entry) => includeByPlugin(entry, options.plugin));
  const drift: DriftRecord[] = [];
  const assessments: PluginAssessment[] = [];
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
      const assessment: PluginAssessment = {
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

      let resolved: PluginSourceCandidate | undefined;
      try {
        const cachedSource = unwrapAsyncResult(await toAsyncResult(getCachedSource(entry)));
        resolved = resolveCandidateFromCachedSource(entry, cachedSource, behavior.keepResolved);

        if (entry.source.type === "local") {
          const currentResolvedPath = fs.realpathSync(resolved.plugin.path);
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

        const sourceHash = await hashDirectoryAsync(resolved.plugin.path);
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

    const canonical = listCanonicalResourceDirs("plugin", Boolean(options.global), cwd);
    const lockNames = new Set(lock.entries.map((item) => item.skillName));
    for (const pluginName of canonical) {
      if (
        !lockNames.has(pluginName) &&
        includeByPlugin({ skillName: pluginName } as LockEntry, options.plugin)
      ) {
        drift.push({
          skillName: pluginName,
          kind: "lock-missing",
          detail: "installed plugin is not tracked in lockfile",
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

export async function collectPluginDrift(
  options: PluginCheckOptions,
  cwd: string,
): Promise<{ drift: DriftRecord[]; checked: number }> {
  const assessed = await assessPluginLockEntries(options, cwd, {
    keepResolved: false,
  });
  return { drift: assessed.drift, checked: assessed.checked };
}
