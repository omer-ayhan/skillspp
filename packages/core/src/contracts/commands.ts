export type AddSkillCommand = {
  source: string;
  global?: boolean;
  agents?: string[];
  skills?: string[];
  nonInteractive?: boolean;
  trustWellKnown?: boolean;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  policyMode?: "enforce" | "warn";
  lockFormat?: "json" | "yaml";
};

export type UpdateSkillCommand = {
  global?: boolean;
  skills?: string[];
  dryRun?: boolean;
  nonInteractive?: boolean;
  migrate?: string;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  policyMode?: "enforce" | "warn";
  lockFormat?: "json" | "yaml";
};

export type CheckSkillCommand = {
  global?: boolean;
  skills?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  policyMode?: "enforce" | "warn";
};

export type ValidateSkillCommand = {
  source?: string;
  json?: boolean;
  strict?: boolean;
  ci?: boolean;
  roots?: string[];
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  maxLines?: number;
  maxDescriptionChars?: number;
  policyMode?: "enforce" | "warn";
  experimental?: boolean;
};

export type ListSkillCommand = {
  global?: boolean;
  agents?: string[];
  nonInteractive?: boolean;
};

export type RemoveSkillCommand = {
  global?: boolean;
  agents?: string[];
  skills?: string[];
  all?: boolean;
  nonInteractive?: boolean;
};

export type FindSkillCommand = {
  source: string;
  query?: string;
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  experimental?: boolean;
};

export type InitSkillCommand = {
  nonInteractive?: boolean;
  nameArg?: string;
  yaml?: boolean;
  agents?: string[];
};

export type AddPluginCommand = {
  plugins: string[];
  global?: boolean;
  nonInteractive?: boolean;
};
