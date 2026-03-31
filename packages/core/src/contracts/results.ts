export type AddSkillResult = {
  installedSkillNames: string[];
  agentCount: number;
};

export type UpdateSkillResult = {
  updatedSkillNames: string[];
};

export type DriftRecord = {
  skillName: string;
  kind:
    | "changed-source"
    | "missing-source"
    | "local-modified"
    | "lock-missing"
    | "migrate-required";
  detail: string;
};

export type CheckSkillResult = {
  drift: DriftRecord[];
  checked: number;
};

export type ValidationDiagnostic = {
  severity: "error" | "warning";
  skill: string;
  file: string;
  rule: string;
  message: string;
};

export type ValidationReport = {
  diagnostics: ValidationDiagnostic[];
};

export type ListInventoryRow = {
  name: string;
  resolvedPath: string;
  agents: string[];
};

export type ListSkillResult = {
  rows: ListInventoryRow[];
};

export type RemoveSkillResult = {
  removedCount: number;
  removedSkillNames: string[];
};

export type FoundSkill = {
  name: string;
  description: string;
};

export type FindSkillResult = {
  sourceType: "local" | "github" | "git" | "well-known" | "catalog";
  sourceLabel: string;
  skills: FoundSkill[];
};

export type InitSkillResult = {
  skillPath: string;
  installerConfigPath?: string;
  agentsConfigured: string[];
};

export type AddPluginResult = {
  installedPlugins: string[];
  skippedPlugins: string[];
  failedPlugins: { name: string; reason: string }[];
};
