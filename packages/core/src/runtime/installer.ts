import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentType, InstallMode, Plugin, Skill } from "../contracts/runtime-types";
import { getAgentPluginsDir, getAgentSkillsDir } from "./agents";

export type InstallOutcome = {
  skillName: string;
  canonicalDir: string;
  installedTo: Array<{ agent: AgentType; path: string; mode: InstallMode }>;
};

export function sanitizeSkillName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized || "unnamed-skill";
}

function ensureSafeInside(baseDir: string, target: string): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(target);
  if (
    !(resolvedTarget === resolvedBase || resolvedTarget.startsWith(`${resolvedBase}${path.sep}`))
  ) {
    throw new Error(`Unsafe path detected: ${target}`);
  }
}

export function getCanonicalSkillsBaseDir(globalInstall: boolean, cwd: string): string {
  return globalInstall
    ? path.join(os.homedir(), ".config", "agents", "skills")
    : path.join(cwd, ".agents", "skills");
}

export function getCanonicalPluginsBaseDir(globalInstall: boolean, cwd: string): string {
  return globalInstall
    ? path.join(os.homedir(), ".config", "agents", "plugins", "cache")
    : path.join(cwd, ".agents", "plugins", "cache");
}

function symlinkRelative(target: string, linkPath: string): void {
  const parent = path.dirname(linkPath);
  const relative = path.relative(parent, target);
  const symlinkType: fs.symlink.Type | undefined =
    process.platform === "win32" ? "junction" : undefined;
  fs.symlinkSync(relative, linkPath, symlinkType);
}

function installToAgent(
  itemName: string,
  canonicalDir: string,
  agent: AgentType,
  mode: InstallMode,
  globalInstall: boolean,
  cwd: string,
  resolveAgentBaseDir: (agent: AgentType, globalInstall: boolean, cwd: string) => string,
): { agent: AgentType; path: string; mode: InstallMode } {
  const agentBase = resolveAgentBaseDir(agent, globalInstall, cwd);
  const agentDir = path.join(agentBase, itemName);

  fs.mkdirSync(agentBase, { recursive: true });
  ensureSafeInside(agentBase, agentDir);

  if (path.resolve(agentDir) === path.resolve(canonicalDir)) {
    return { agent, path: canonicalDir, mode };
  }

  if (mode === "copy") {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.cpSync(canonicalDir, agentDir, { recursive: true, force: true });
    return { agent, path: agentDir, mode };
  }

  try {
    fs.rmSync(agentDir, { recursive: true, force: true });
    symlinkRelative(canonicalDir, agentDir);
    return { agent, path: agentDir, mode: "symlink" };
  } catch {
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.cpSync(canonicalDir, agentDir, { recursive: true, force: true });
    return { agent, path: agentDir, mode: "copy" };
  }
}

function installSkillToAgent(
  skillName: string,
  canonicalDir: string,
  agent: AgentType,
  mode: InstallMode,
  globalInstall: boolean,
  cwd: string,
): { agent: AgentType; path: string; mode: InstallMode } {
  return installToAgent(
    skillName,
    canonicalDir,
    agent,
    mode,
    globalInstall,
    cwd,
    getAgentSkillsDir,
  );
}

function installPluginToAgent(
  pluginName: string,
  canonicalDir: string,
  agent: AgentType,
  mode: InstallMode,
  globalInstall: boolean,
  cwd: string,
): { agent: AgentType; path: string; mode: InstallMode } {
  return installToAgent(
    pluginName,
    canonicalDir,
    agent,
    mode,
    globalInstall,
    cwd,
    getAgentPluginsDir,
  );
}

function installToCanonicalDir(
  sourcePath: string,
  itemName: string,
  canonicalBase: string,
): string {
  const canonicalDir = path.join(canonicalBase, itemName);
  fs.mkdirSync(canonicalBase, { recursive: true });
  ensureSafeInside(canonicalBase, canonicalDir);
  fs.rmSync(canonicalDir, { recursive: true, force: true });
  fs.cpSync(sourcePath, canonicalDir, { recursive: true, force: true });
  return canonicalDir;
}

export function installSkill(
  skill: Skill,
  agents: AgentType[],
  options: { mode: InstallMode; globalInstall: boolean; cwd: string },
): InstallOutcome {
  if (agents.length === 0) {
    throw new Error("At least one target agent is required for installation.");
  }

  const uniqueAgents = Array.from(new Set(agents));
  const skillName = sanitizeSkillName(skill.name);
  const canonicalAgent = uniqueAgents[0];
  const canonicalBase = getAgentSkillsDir(canonicalAgent, options.globalInstall, options.cwd);
  const canonicalDir = installToCanonicalDir(skill.path, skillName, canonicalBase);

  const installedTo = [
    { agent: canonicalAgent, path: canonicalDir, mode: options.mode },
    ...uniqueAgents
      .slice(1)
      .map((agent) =>
        installSkillToAgent(
          skillName,
          canonicalDir,
          agent,
          options.mode,
          options.globalInstall,
          options.cwd,
        ),
      ),
  ];

  return {
    skillName,
    canonicalDir,
    installedTo,
  };
}

export function installPlugin(
  plugin: Plugin,
  agents: AgentType[],
  options: { mode: InstallMode; globalInstall: boolean; cwd: string },
): InstallOutcome {
  if (agents.length === 0) {
    throw new Error("At least one target agent is required for installation.");
  }

  const uniqueAgents = Array.from(new Set(agents));
  const pluginName = sanitizeSkillName(plugin.name);
  const canonicalAgent = uniqueAgents[0];
  const canonicalBase = getAgentPluginsDir(canonicalAgent, options.globalInstall, options.cwd);
  const canonicalDir = installToCanonicalDir(plugin.path, pluginName, canonicalBase);

  const installedTo = [
    { agent: canonicalAgent, path: canonicalDir, mode: options.mode },
    ...uniqueAgents
      .slice(1)
      .map((agent) =>
        installPluginToAgent(
          pluginName,
          canonicalDir,
          agent,
          options.mode,
          options.globalInstall,
          options.cwd,
        ),
      ),
  ];

  return {
    skillName: pluginName,
    canonicalDir,
    installedTo,
  };
}
