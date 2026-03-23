import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentInfo, AgentType } from "../contracts/runtime-types";

export type ScopeAgentSelectionEntry = {
  agent: AgentType;
  label: string;
  skillsDir: string;
};

export type SelectionRow = {
  id: string;
  label: string;
  description?: string;
};

export const STANDARD_AGENTS = {
  universal: {
    displayName: "Universal",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".agents/skills",
    installMarkers: [".agents"],
  },
  adal: {
    displayName: "AdaL",
    projectSkillsDir: ".adal/skills",
    globalSkillsDir: ".adal/skills",
    installMarkers: [".adal"],
  },
  antigravity: {
    displayName: "Antigravity",
    projectSkillsDir: ".agent/skills",
    globalSkillsDir: ".gemini/antigravity/skills",
    installMarkers: [".gemini/antigravity"],
  },
  augment: {
    displayName: "Augment",
    projectSkillsDir: ".augment/skills",
    globalSkillsDir: ".augment/skills",
    installMarkers: [".augment"],
  },
  "claude-code": {
    displayName: "Claude Code",
    projectSkillsDir: ".claude/skills",
    globalSkillsDir: ".claude/skills",
    installMarkers: [".claude"],
  },
  "cortex-code": {
    displayName: "Cortex Code",
    projectSkillsDir: ".cortex/skills",
    globalSkillsDir: ".cortex/skills",
    installMarkers: [".cortex"],
  },
  crush: {
    displayName: "Crush",
    projectSkillsDir: ".crush/skills",
    globalSkillsDir: ".crush/skills",
    installMarkers: [".crush"],
  },
  droid: {
    displayName: "Droid",
    projectSkillsDir: ".factory/skills",
    globalSkillsDir: ".factory/skills",
    installMarkers: [".factory"],
  },
  goose: {
    displayName: "Goose",
    projectSkillsDir: ".goose/skills",
    globalSkillsDir: ".config/goose/skills",
    installMarkers: [".config/goose"],
  },
  "iflow-cli": {
    displayName: "iFlow CLI",
    projectSkillsDir: ".iflow/skills",
    globalSkillsDir: ".iflow/skills",
    installMarkers: [".iflow"],
  },
  junie: {
    displayName: "Junie",
    projectSkillsDir: ".junie/skills",
    globalSkillsDir: ".junie/skills",
    installMarkers: [".junie"],
  },
  "kiro-cli": {
    displayName: "Kiro CLI",
    projectSkillsDir: ".kiro/skills",
    globalSkillsDir: ".kiro/skills",
    installMarkers: [".kiro"],
  },
  kode: {
    displayName: "Kode",
    projectSkillsDir: ".kode/skills",
    globalSkillsDir: ".kode/skills",
    installMarkers: [".kode"],
  },
  openclaw: {
    displayName: "OpenClaw",
    projectSkillsDir: "skills",
    globalSkillsDir: ".openclaw/skills",
    installMarkers: [".openclaw"],
  },
  openhands: {
    displayName: "OpenHands",
    projectSkillsDir: ".openhands/skills",
    globalSkillsDir: ".openhands/skills",
    installMarkers: [".openhands"],
  },
  "mistral-vibe": {
    displayName: "Mistral Vibe",
    projectSkillsDir: ".vibe/skills",
    globalSkillsDir: ".vibe/skills",
    installMarkers: [".vibe"],
  },
  neovate: {
    displayName: "Neovate",
    projectSkillsDir: ".neovate/skills",
    globalSkillsDir: ".neovate/skills",
    installMarkers: [".neovate"],
  },
  pochi: {
    displayName: "Pochi",
    projectSkillsDir: ".pochi/skills",
    globalSkillsDir: ".pochi/skills",
    installMarkers: [".pochi"],
  },
  qoder: {
    displayName: "Qoder",
    projectSkillsDir: ".qoder/skills",
    globalSkillsDir: ".qoder/skills",
    installMarkers: [".qoder"],
  },
  "qwen-code": {
    displayName: "Qwen Code",
    projectSkillsDir: ".qwen/skills",
    globalSkillsDir: ".qwen/skills",
    installMarkers: [".qwen"],
  },
  roo: {
    displayName: "Roo Code",
    projectSkillsDir: ".roo/skills",
    globalSkillsDir: ".roo/skills",
    installMarkers: [".roo"],
  },
  trae: {
    displayName: "Trae",
    projectSkillsDir: ".trae/skills",
    globalSkillsDir: ".trae/skills",
    installMarkers: [".trae"],
  },
  "trae-cn": {
    displayName: "Trae CN",
    projectSkillsDir: ".trae/skills",
    globalSkillsDir: ".trae/skills",
    installMarkers: [".trae"],
  },
  windsurf: {
    displayName: "Windsurf",
    projectSkillsDir: ".windsurf/skills",
    globalSkillsDir: ".codeium/windsurf/skills",
    installMarkers: [".windsurf", ".codeium/windsurf"],
  },
  zencoder: {
    displayName: "Zencoder",
    projectSkillsDir: ".zencoder/skills",
    globalSkillsDir: ".zencoder/skills",
    installMarkers: [".zencoder"],
  },
  continue: {
    displayName: "Continue",
    projectSkillsDir: ".continue/skills",
    globalSkillsDir: ".continue/skills",
    installMarkers: [".continue"],
  },
  codebuddy: {
    displayName: "CodeBuddy",
    projectSkillsDir: ".codebuddy/skills",
    globalSkillsDir: ".codebuddy/skills",
    installMarkers: [".codebuddy"],
  },
  "command-code": {
    displayName: "Command Code",
    projectSkillsDir: ".commandcode/skills",
    globalSkillsDir: ".commandcode/skills",
    installMarkers: [".commandcode"],
  },
  kilo: {
    displayName: "Kilo Code",
    projectSkillsDir: ".kilocode/skills",
    globalSkillsDir: ".kilocode/skills",
    installMarkers: [".kilocode"],
  },
  mcpjam: {
    displayName: "MCPJam",
    projectSkillsDir: ".mcpjam/skills",
    globalSkillsDir: ".mcpjam/skills",
    installMarkers: [".mcpjam"],
  },
  mux: {
    displayName: "Mux",
    projectSkillsDir: ".mux/skills",
    globalSkillsDir: ".mux/skills",
    installMarkers: [".mux"],
  },
  pi: {
    displayName: "Pi",
    projectSkillsDir: ".pi/skills",
    globalSkillsDir: ".pi/agent/skills",
    installMarkers: [".pi"],
  },
  replit: {
    displayName: "Replit",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".config/agents/skills",
    installMarkers: [".config/agents"],
  },
};

export const AGENTS: Record<AgentType, AgentInfo> = {
  ...STANDARD_AGENTS,
  codex: {
    displayName: "Codex",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".codex/skills",
    installMarkers: [".codex"],
  },
  cursor: {
    displayName: "Cursor",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".cursor/skills",
    installMarkers: [".cursor"],
  },
  "gemini-cli": {
    displayName: "Gemini CLI",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".gemini/skills",
    installMarkers: [".gemini"],
  },
  "github-copilot": {
    displayName: "GitHub Copilot",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".copilot/skills",
    installMarkers: [".copilot"],
  },
  amp: {
    displayName: "Amp",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".config/agents/skills",
    installMarkers: [".config/agents"],
  },
  opencode: {
    displayName: "OpenCode",
    projectSkillsDir: ".agents/skills",
    globalSkillsDir: ".config/opencode/skills",
    installMarkers: [".config/opencode"],
  },
  windsurf: {
    displayName: "Windsurf",
    projectSkillsDir: ".windsurf/skills",
    globalSkillsDir: ".codeium/windsurf/skills",
    installMarkers: [".windsurf", ".codeium/windsurf"],
  },
  cline: {
    displayName: "Cline",
    projectSkillsDir: ".cline/skills",
    globalSkillsDir: ".cline/skills",
    installMarkers: [".cline"],
  },
};

export const ALL_AGENTS = Object.keys(AGENTS) as AgentType[];

export function isAgent(value: string): value is AgentType {
  return Object.prototype.hasOwnProperty.call(AGENTS, value);
}

export function resolveAddAgentSelectionRows(
  scope: "local" | "global",
): SelectionRow[] {
  const dataset =
    scope === "global"
      ? Object.entries(AGENTS).map(([agent, info]) => ({
          agent: agent as AgentType,
          label: `${info.displayName} (global)`,
          skillsDir: info.globalSkillsDir,
        }))
      : Object.entries(STANDARD_AGENTS).map(([agent, info]) => ({
          agent: agent as AgentType,
          label: info.displayName,
          skillsDir: info.projectSkillsDir,
        }));

  return dataset.map((entry) => ({
    id: entry.agent,
    label: entry.label,
    description: entry.skillsDir,
  }));
}

export function resolveAgents(input: string[] | undefined): AgentType[] {
  if (!input || input.length === 0) {
    const detected = detectInstalledAgents();
    return detected.length > 0 ? detected : ["opencode", "codex"];
  }

  if (input.includes("*")) {
    const detected = detectInstalledAgents();
    return detected.length > 0 ? detected : ALL_AGENTS;
  }

  const out: AgentType[] = [];
  for (const value of input) {
    if (!isAgent(value)) {
      throw new Error(`Unknown agent: ${value}`);
    }
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

export function normalizeAgentSelectionInput(
  values: string[] | undefined,
  cwd: string = process.cwd(),
): string[] | undefined {
  if (!values || values.length === 0) {
    return values;
  }

  if (values.includes("*")) {
    return ["*"];
  }

  const valid = values.filter((value) => isAgent(value));
  const unknown = values.filter((value) => !isAgent(value));
  if (unknown.length === 0) {
    return values;
  }

  // If all unknown values are filesystem entries, this is likely shell
  // expansion from an unquoted `*`.
  const expandedFromGlob = unknown.every((value) =>
    fs.existsSync(path.resolve(cwd, value)),
  );
  if (!expandedFromGlob) {
    return values;
  }

  if (valid.length > 0) {
    return valid;
  }
  return ["*"];
}

export function getAgentSkillsDir(
  agent: AgentType,
  globalInstall: boolean,
  cwd: string,
): string {
  const relative = globalInstall
    ? AGENTS[agent].globalSkillsDir
    : AGENTS[agent].projectSkillsDir;
  const base = globalInstall ? os.homedir() : cwd;
  return path.join(base, relative);
}

export function detectInstalledAgents(
  cwd: string = process.cwd(),
): AgentType[] {
  const found: AgentType[] = [];
  for (const agent of Object.keys(AGENTS) as AgentType[]) {
    if (isAgentInstalled(agent, cwd)) {
      found.push(agent);
    }
  }
  return found;
}

export function filterInstalledAgents(
  agents: AgentType[],
  cwd: string = process.cwd(),
): AgentType[] {
  return agents.filter((agent) => isAgentInstalled(agent, cwd));
}

function isAgentInstalled(agent: AgentType, cwd: string): boolean {
  const info = AGENTS[agent];
  const home = os.homedir();

  if (info.installMarkers) {
    for (const marker of info.installMarkers) {
      if (fs.existsSync(path.join(home, marker))) {
        return true;
      }
    }
  }

  const projectSkillsDir = getAgentSkillsDir(agent, false, cwd);
  if (
    info.projectSkillsDir !== ".agents/skills" &&
    fs.existsSync(projectSkillsDir)
  ) {
    return true;
  }

  const globalSkillsDir = getAgentSkillsDir(agent, true, cwd);
  if (
    info.globalSkillsDir !== ".config/agents/skills" &&
    info.globalSkillsDir !== ".agents/skills" &&
    fs.existsSync(globalSkillsDir)
  ) {
    return true;
  }

  return false;
}
