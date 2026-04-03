import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  AgentType,
  InstallMode,
  ParsedSource,
} from "../contracts/runtime-types";
import { parseSource } from "../sources/source-parser";
import { AGENTS, getAgentPluginsDir, getAgentSkillsDir } from "./agents";

export type ResourceKind = "skill" | "plugin";

export type LockedSource = {
  input: string;
  type: ParsedSource["type"];
  canonical?: string;
  pinnedRef?: string;
  resolvedPath?: string;
  isSymlinkSource?: boolean;
  selector: {
    skillName: string;
    relativePath?: string;
    wellKnownSourceUrl?: string;
  };
};

export type LockEntry = {
  skillName: string;
  global: boolean;
  installMode: InstallMode;
  agents: AgentType[];
  canonicalDir: string;
  source: LockedSource;
  sourceHash: string;
  installedHash: string;
  updatedAt: string;
};

export type SkillsLockfile = {
  version: 1;
  entries: LockEntry[];
};

export type ResourceLockEntry = LockEntry;
export type ResourceLockfile = SkillsLockfile;

export type LockfileFormat = "json" | "yaml";

type SourceLoadIdentity = Pick<LockedSource, "type" | "input" | "canonical">;

export function resolveSourceLoadInput(source: SourceLoadIdentity): string {
  return source.type === "local" && source.canonical
    ? source.canonical
    : source.input;
}

export function buildSourceIdentityCacheKey(parsed: ParsedSource): string {
  if (parsed.type === "local") {
    return `local:${parsed.localPath}`;
  }

  if (parsed.type === "well-known") {
    return `well-known:${parsed.url}`;
  }

  if (parsed.type === "catalog") {
    return `catalog:${parsed.url}`;
  }

  if (parsed.type === "github") {
    return `github:${parsed.repoUrl}:${parsed.ref || ""}:${parsed.subpath || ""}`;
  }

  return `git:${parsed.repoUrl}`;
}

export function buildSourceLoadCacheKey(source: SourceLoadIdentity): string {
  return buildSourceIdentityCacheKey(parseSource(resolveSourceLoadInput(source)));
}

function perSkillLockfilePath(
  canonicalDir: string,
  format: LockfileFormat = "json",
): string {
  if (format === "yaml") {
    return path.join(canonicalDir, "skillspp-lock.yaml");
  }
  return path.join(canonicalDir, "skillspp-lock.json");
}

function parseLockPayload(
  text: string,
  format: "json" | "yaml",
): { version: 1; entry?: LockEntry; entries?: LockEntry[] } | null {
  const raw = (format === "json" ? JSON.parse(text) : YAML.parse(text)) as
    | { version: 1; entry?: LockEntry; entries?: LockEntry[] }
    | undefined;
  if (!raw || raw.version !== 1) {
    return null;
  }
  return raw;
}

function readPerSkillLockfile(canonicalDir: string): LockEntry | null {
  const jsonPath = perSkillLockfilePath(canonicalDir, "json");
  const yamlPath = perSkillLockfilePath(canonicalDir, "yaml");

  const raw = fs.existsSync(jsonPath)
    ? parseLockPayload(fs.readFileSync(jsonPath, "utf8"), "json")
    : fs.existsSync(yamlPath)
    ? parseLockPayload(fs.readFileSync(yamlPath, "utf8"), "yaml")
    : null;

  if (!raw) {
    return null;
  }

  if (raw.entry && typeof raw.entry.skillName === "string") {
    return raw.entry;
  }

  if (
    Array.isArray(raw.entries) &&
    raw.entries[0] &&
    typeof raw.entries[0].skillName === "string"
  ) {
    return raw.entries[0];
  }

  return null;
}

function writePerSkillLockfile(
  canonicalDir: string,
  entry: LockEntry,
  format: LockfileFormat,
): void {
  const jsonPath = perSkillLockfilePath(canonicalDir, "json");
  const yamlPath = perSkillLockfilePath(canonicalDir, "yaml");
  fs.mkdirSync(canonicalDir, { recursive: true });
  if (format === "yaml") {
    fs.writeFileSync(yamlPath, YAML.stringify({ version: 1, entry }), "utf8");
    if (fs.existsSync(jsonPath)) {
      fs.rmSync(jsonPath, { force: true });
    }
    return;
  }

  fs.writeFileSync(
    jsonPath,
    `${JSON.stringify({ version: 1, entry }, null, 2)}\n`,
    "utf8",
  );
  if (fs.existsSync(yamlPath)) {
    fs.rmSync(yamlPath, { force: true });
  }
}

function isSkillDirEntry(entry: fs.Dirent): boolean {
  return entry.isDirectory() || entry.isSymbolicLink();
}

function listInstalledResourceDirs(
  kind: ResourceKind,
  globalInstall: boolean,
  cwd: string,
): string[] {
  const out = new Set<string>();
  for (const agent of Object.keys(AGENTS) as AgentType[]) {
    const resourceRoot =
      kind === "plugin"
        ? getAgentPluginsDir(agent, globalInstall, cwd)
        : getAgentSkillsDir(agent, globalInstall, cwd);
    if (
      !fs.existsSync(resourceRoot) ||
      !fs.statSync(resourceRoot).isDirectory()
    ) {
      continue;
    }
    for (const entry of fs.readdirSync(resourceRoot, { withFileTypes: true })) {
      if (!isSkillDirEntry(entry)) {
        continue;
      }
      out.add(path.join(resourceRoot, entry.name));
    }
  }

  return [...out];
}

function lockEntrySortTime(entry: LockEntry): number {
  const parsed = Date.parse(entry.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readLockfile(
  globalInstall: boolean,
  cwd: string,
): SkillsLockfile {
  return readResourceLockfile("skill", globalInstall, cwd);
}

export function readResourceLockfile(
  kind: ResourceKind,
  globalInstall: boolean,
  cwd: string,
): ResourceLockfile {
  const entriesBySkill = new Map<string, LockEntry>();
  for (const skillDir of listInstalledResourceDirs(kind, globalInstall, cwd)) {
    const entry = readPerSkillLockfile(skillDir);
    if (!entry || typeof entry.skillName !== "string") {
      continue;
    }

    const existing = entriesBySkill.get(entry.skillName);
    if (
      !existing ||
      lockEntrySortTime(entry) > lockEntrySortTime(existing)
    ) {
      entriesBySkill.set(entry.skillName, entry);
    }
  }

  return {
    version: 1,
    entries: [...entriesBySkill.values()].sort((a, b) =>
      a.skillName.localeCompare(b.skillName),
    ),
  };
}

export function writeLockfile(
  globalInstall: boolean,
  cwd: string,
  lockfile: SkillsLockfile,
  format: LockfileFormat = "json",
): void {
  writeResourceLockfile("skill", globalInstall, cwd, lockfile, format);
}

export function writeResourceLockfile(
  _kind: ResourceKind,
  _globalInstall: boolean,
  _cwd: string,
  lockfile: ResourceLockfile,
  format: LockfileFormat = "json",
): void {
  const normalized = [...lockfile.entries].sort((a, b) =>
    a.skillName.localeCompare(b.skillName),
  );

  for (const entry of normalized) {
    writePerSkillLockfile(entry.canonicalDir, entry, format);
  }
}

export function upsertLockEntry(
  lockfile: SkillsLockfile,
  entry: LockEntry,
): SkillsLockfile {
  return upsertResourceLockEntry(lockfile, entry);
}

export function upsertResourceLockEntry(
  lockfile: ResourceLockfile,
  entry: ResourceLockEntry,
): ResourceLockfile {
  const next = lockfile.entries.filter(
    (item) => item.skillName !== entry.skillName,
  );
  next.push(entry);
  return { version: 1, entries: next };
}

export function removeLockEntry(
  lockfile: SkillsLockfile,
  skillName: string,
): SkillsLockfile {
  return removeResourceLockEntry(lockfile, skillName);
}

export function removeResourceLockEntry(
  lockfile: ResourceLockfile,
  resourceName: string,
): ResourceLockfile {
  return {
    version: 1,
    entries: lockfile.entries.filter((item) => item.skillName !== resourceName),
  };
}

export function listCanonicalSkillDirs(
  globalInstall: boolean,
  cwd: string,
): string[] {
  return listCanonicalResourceDirs("skill", globalInstall, cwd);
}

export function listCanonicalResourceDirs(
  kind: ResourceKind,
  globalInstall: boolean,
  cwd: string,
): string[] {
  return [
    ...new Set(
      listInstalledResourceDirs(kind, globalInstall, cwd).map((dir) =>
        path.basename(dir),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
