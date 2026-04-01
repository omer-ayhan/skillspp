export type AgentType =
  | "adal"
  | "amp"
  | "antigravity"
  | "augment"
  | "claude-code"
  | "cortex-code"
  | "codex"
  | "crush"
  | "droid"
  | "cursor"
  | "gemini-cli"
  | "github-copilot"
  | "goose"
  | "iflow-cli"
  | "junie"
  | "kiro-cli"
  | "kode"
  | "mistral-vibe"
  | "neovate"
  | "openclaw"
  | "opencode"
  | "openhands"
  | "pochi"
  | "qoder"
  | "qwen-code"
  | "roo"
  | "trae"
  | "trae-cn"
  | "windsurf"
  | "zencoder"
  | "continue"
  | "cline"
  | "codebuddy"
  | "command-code"
  | "kilo"
  | "mcpjam"
  | "mux"
  | "pi"
  | "replit"
  | "universal";

export type AgentInfo = {
  displayName: string;
  projectSkillsDir: string;
  globalSkillsDir: string;
  projectPluginsDir: string;
  globalPluginsDir: string;
  installMarkers?: string[];
};

export type ParsedSource =
  | { type: "local"; localPath: string }
  | { type: "github"; repoUrl: string; ref?: string; subpath?: string }
  | { type: "git"; repoUrl: string }
  | { type: "well-known"; url: string }
  | { type: "catalog"; url: string };

export type Skill = {
  name: string;
  description: string;
  path: string;
};

export type Plugin = {
  name: string;
  description: string;
  path: string;
};

export type AddOptions = {
  global?: boolean;
  agent?: string[];
  agentFlagProvided?: boolean;
  globalFlagProvided?: boolean;
  skill?: string[];
  list?: boolean;
  symlink?: boolean;
  symlinkFlagProvided?: boolean;
  yaml?: boolean;
  all?: boolean;
  nonInteractive?: boolean;
  trustWellKnown?: boolean;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  policyMode?: "enforce" | "warn";
  lockFormat?: "json" | "yaml";
  experimental?: boolean;
};

export type ListOptions = {
  global?: boolean;
  agent?: string[];
  agentFlagProvided?: boolean;
  nonInteractive?: boolean;
};

export type RemoveOptions = {
  global?: boolean;
  agent?: string[];
  agentFlagProvided?: boolean;
  skill?: string[];
  all?: boolean;
  nonInteractive?: boolean;
};

export type InstallMode = "symlink" | "copy";
