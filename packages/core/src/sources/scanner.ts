import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export type ScannerConflict = {
  skillName: string;
  winner: "local" | "global";
};

export type TransitiveSkillCandidate = {
  skillName: string;
  skillDir: string;
  packageName: string;
  packageVersion: string;
  depth: number;
};

export type TransitiveSkillConflict = {
  skillName: string;
  winner: TransitiveSkillCandidate;
  losers: TransitiveSkillCandidate[];
};

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function detectLocalGlobalConflicts(cwd: string): ScannerConflict[] {
  const localDir = path.join(cwd, ".agents", "skills");
  const globalDir = path.join(os.homedir(), ".config", "agents", "skills");

  const local = new Set(listDirs(localDir));
  const global = new Set(listDirs(globalDir));
  const overlap = [...local].filter((name) => global.has(name));

  return overlap
    .sort((a, b) => a.localeCompare(b))
    .map((skillName) => ({
      skillName,
      winner: "local",
    }));
}

function readPackageMeta(packageDir: string): {
  name: string;
  version: string;
} {
  const packageJson = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJson) || !fs.statSync(packageJson).isFile()) {
    return {
      name: path.basename(packageDir),
      version: "0.0.0",
    };
  }

  const parsed = JSON.parse(fs.readFileSync(packageJson, "utf8")) as {
    name?: string;
    version?: string;
  };
  return {
    name: parsed.name || path.basename(packageDir),
    version: parsed.version || "0.0.0",
  };
}

function collectSkillsFromPackage(
  packageDir: string,
  depth: number,
  out: TransitiveSkillCandidate[]
): void {
  const meta = readPackageMeta(packageDir);
  const skillsDir = path.join(packageDir, "skills");

  if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillDir = path.join(skillsDir, entry.name);
      const skillMd = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) {
        continue;
      }

      out.push({
        skillName: entry.name,
        skillDir,
        packageName: meta.name,
        packageVersion: meta.version,
        depth,
      });
    }
  }
}

function walkNodeModules(
  nodeModulesDir: string,
  depth: number,
  maxDepth: number,
  seen: Set<string>,
  out: TransitiveSkillCandidate[]
): void {
  const resolvedNodeModules = path.resolve(nodeModulesDir);
  if (seen.has(resolvedNodeModules) || depth > maxDepth) {
    return;
  }
  seen.add(resolvedNodeModules);

  if (
    !fs.existsSync(resolvedNodeModules) ||
    !fs.statSync(resolvedNodeModules).isDirectory()
  ) {
    return;
  }

  for (const entry of fs.readdirSync(resolvedNodeModules, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(resolvedNodeModules, entry.name);
      for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!scoped.isDirectory()) {
          continue;
        }
        const packageDir = path.join(scopeDir, scoped.name);
        collectSkillsFromPackage(packageDir, depth, out);
        walkNodeModules(
          path.join(packageDir, "node_modules"),
          depth + 1,
          maxDepth,
          seen,
          out
        );
      }
      continue;
    }

    const packageDir = path.join(resolvedNodeModules, entry.name);
    collectSkillsFromPackage(packageDir, depth, out);
    walkNodeModules(
      path.join(packageDir, "node_modules"),
      depth + 1,
      maxDepth,
      seen,
      out
    );
  }
}

export function discoverTransitiveSkillCandidates(
  cwd: string,
  options: { maxDepth?: number } = {}
): TransitiveSkillCandidate[] {
  const maxDepth = options.maxDepth ?? 8;
  const out: TransitiveSkillCandidate[] = [];
  const seen = new Set<string>();

  walkNodeModules(path.join(cwd, "node_modules"), 0, maxDepth, seen, out);

  return out.sort((a, b) => {
    if (a.skillName !== b.skillName) {
      return a.skillName.localeCompare(b.skillName);
    }
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    if (a.packageName !== b.packageName) {
      return a.packageName.localeCompare(b.packageName);
    }
    if (a.packageVersion !== b.packageVersion) {
      return b.packageVersion.localeCompare(a.packageVersion);
    }
    return a.skillDir.localeCompare(b.skillDir);
  });
}

export function detectTransitiveSkillConflicts(
  candidates: TransitiveSkillCandidate[]
): TransitiveSkillConflict[] {
  const grouped = new Map<string, TransitiveSkillCandidate[]>();
  for (const candidate of candidates) {
    const rows = grouped.get(candidate.skillName) || [];
    rows.push(candidate);
    grouped.set(candidate.skillName, rows);
  }

  const conflicts: TransitiveSkillConflict[] = [];
  for (const [skillName, rows] of grouped) {
    if (rows.length <= 1) {
      continue;
    }

    const sorted = [...rows].sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      if (a.packageName !== b.packageName) {
        return a.packageName.localeCompare(b.packageName);
      }
      if (a.packageVersion !== b.packageVersion) {
        return b.packageVersion.localeCompare(a.packageVersion);
      }
      return a.skillDir.localeCompare(b.skillDir);
    });

    conflicts.push({
      skillName,
      winner: sorted[0],
      losers: sorted.slice(1),
    });
  }

  return conflicts.sort((a, b) => a.skillName.localeCompare(b.skillName));
}
