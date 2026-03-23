import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import type { Skill, ParsedSource } from "../contracts/runtime-types";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "__pycache__",
]);

export function resolveSourceLabel(parsedSource: ParsedSource): string {
  switch (parsedSource.type) {
    case "local":
      return parsedSource.localPath;
    case "github":
    case "git":
      return parsedSource.repoUrl;
    case "well-known":
    case "catalog":
      return parsedSource.url;
    default:
      return "";
  }
}

export type RemoteStagingResult = {
  path: string;
  cleanup: () => void;
};

export function stageRemoteSkillFilesToTempDir(
  files: Map<string, string>,
  options?: { prefix?: string },
): RemoteStagingResult {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), options?.prefix || "skillspp-remote-"),
  );

  try {
    for (const [relativePath, content] of files.entries()) {
      const resolved = path.resolve(tmp, relativePath);
      const rel = path.relative(tmp, resolved);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`Unsafe remote skill file path: ${relativePath}`);
      }

      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, "utf8");
    }
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }

  return {
    path: tmp,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

function hasSkillMd(dir: string): boolean {
  const skillPath = path.join(dir, "SKILL.md");
  return fs.existsSync(skillPath) && fs.statSync(skillPath).isFile();
}

async function hasSkillMdAsync(dir: string): Promise<boolean> {
  const skillPath = path.join(dir, "SKILL.md");
  try {
    const stat = await fs.promises.stat(skillPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function parseSkillMd(skillMdPath: string): Skill | null {
  try {
    const raw = fs.readFileSync(skillMdPath, "utf8");
    const { data } = matter(raw);
    if (typeof data.name !== "string" || typeof data.description !== "string") {
      return null;
    }
    return {
      name: data.name,
      description: data.description,
      path: path.dirname(skillMdPath),
    };
  } catch {
    return null;
  }
}

async function parseSkillMdAsync(skillMdPath: string): Promise<Skill | null> {
  try {
    const raw = await fs.promises.readFile(skillMdPath, "utf8");
    const { data } = matter(raw);
    if (typeof data.name !== "string" || typeof data.description !== "string") {
      return null;
    }
    return {
      name: data.name,
      description: data.description,
      path: path.dirname(skillMdPath),
    };
  } catch {
    return null;
  }
}

function findSkillDirsRecursive(
  dir: string,
  depth: number,
  maxDepth: number,
  out: string[]
): void {
  if (depth > maxDepth) {
    return;
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return;
  }

  if (hasSkillMd(dir)) {
    out.push(dir);
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
      continue;
    }
    findSkillDirsRecursive(
      path.join(dir, entry.name),
      depth + 1,
      maxDepth,
      out
    );
  }
}

async function findSkillDirsRecursiveAsync(
  dir: string,
  depth: number,
  maxDepth: number,
  out: string[]
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }

  try {
    const stat = await fs.promises.stat(dir);
    if (!stat.isDirectory()) {
      return;
    }
  } catch {
    return;
  }

  if (await hasSkillMdAsync(dir)) {
    out.push(dir);
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
      continue;
    }
    await findSkillDirsRecursiveAsync(
      path.join(dir, entry.name),
      depth + 1,
      maxDepth,
      out
    );
  }
}

export function discoverSkills(basePath: string): Skill[] {
  const dirsToSearch = [
    basePath,
    path.join(basePath, "skills"),
    path.join(basePath, "skills", ".curated"),
    path.join(basePath, "skills", ".experimental"),
    path.join(basePath, "skills", ".system"),
    path.join(basePath, ".agents", "skills"),
    path.join(basePath, ".agent", "skills"),
  ];

  const skillDirs: string[] = [];
  for (const dir of dirsToSearch) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(dir, entry.name);
      if (hasSkillMd(candidate)) {
        skillDirs.push(candidate);
      }
    }
  }

  if (hasSkillMd(basePath)) {
    skillDirs.unshift(basePath);
  }

  if (skillDirs.length === 0) {
    findSkillDirsRecursive(basePath, 0, 5, skillDirs);
  }

  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const dir of skillDirs) {
    const parsed = parseSkillMd(path.join(dir, "SKILL.md"));
    if (!parsed) {
      continue;
    }
    if (seen.has(parsed.name)) {
      continue;
    }
    seen.add(parsed.name);
    skills.push(parsed);
  }

  return skills;
}

export async function discoverSkillsAsync(basePath: string): Promise<Skill[]> {
  const dirsToSearch = [
    basePath,
    path.join(basePath, "skills"),
    path.join(basePath, "skills", ".curated"),
    path.join(basePath, "skills", ".experimental"),
    path.join(basePath, "skills", ".system"),
    path.join(basePath, ".agents", "skills"),
    path.join(basePath, ".agent", "skills"),
  ];

  const skillDirs: string[] = [];
  for (const dir of dirsToSearch) {
    let stat: fs.Stats | undefined;
    try {
      stat = await fs.promises.stat(dir);
    } catch {
      stat = undefined;
    }
    if (!stat || !stat.isDirectory()) {
      continue;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(dir, entry.name);
      if (await hasSkillMdAsync(candidate)) {
        skillDirs.push(candidate);
      }
    }
  }

  if (await hasSkillMdAsync(basePath)) {
    skillDirs.unshift(basePath);
  }

  if (skillDirs.length === 0) {
    await findSkillDirsRecursiveAsync(basePath, 0, 5, skillDirs);
  }

  const seen = new Set<string>();
  const skills: Skill[] = [];
  for (const dir of skillDirs) {
    const parsed = await parseSkillMdAsync(path.join(dir, "SKILL.md"));
    if (!parsed) {
      continue;
    }
    if (seen.has(parsed.name)) {
      continue;
    }
    seen.add(parsed.name);
    skills.push(parsed);
  }

  return skills;
}

export function filterSkillsByName(
  skills: Skill[],
  requested?: string[]
): Skill[] {
  if (!requested || requested.length === 0) {
    return skills;
  }

  if (requested.includes("*")) {
    return skills;
  }

  const wanted = new Set(requested.map((item) => item.toLowerCase()));
  return skills.filter((skill) => wanted.has(skill.name.toLowerCase()));
}
