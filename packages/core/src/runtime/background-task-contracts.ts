import type { AddOptions, AgentType, ListOptions } from "../contracts/runtime-types";
import type { DriftRecord, ListInventoryRow } from "../contracts/results";
import type { CheckOptions } from "./check-analysis";
import type { ValidateDiagnostic, ValidateOptions } from "./validate-analysis";
import type { LockEntry, LockfileFormat } from "./lockfile";
import type { ScannerConflict, TransitiveSkillConflict } from "../sources/scanner";

export type FindOptions = {
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  experimental?: boolean;
};

export type UpdateOptions = CheckOptions & {
  dryRun?: boolean;
  trustWellKnown?: boolean;
  nonInteractive?: boolean;
  policyMode?: "enforce" | "warn";
  lockFormat?: LockfileFormat;
  migrate?: string;
};

export type { ListInventoryRow };

export type SerializableSkillAssessment = {
  entry: LockEntry;
  drift: DriftRecord[];
};

export type AddSourceSkill = {
  name: string;
  description: string;
};

export type CheckScanTaskResult = {
  drift: DriftRecord[];
  checked: number;
  conflicts: ScannerConflict[];
  transitiveConflicts: TransitiveSkillConflict[];
};

export type UpdateAssessTaskResult = {
  assessments: SerializableSkillAssessment[];
};

export type UpdateApplyTaskResult = {
  updatedSkillNames: string[];
};

export type UpdateMigrateTaskResult = {
  skillName: string;
};

export type PluginUpdateAssessTaskResult = {
  assessments: SerializableSkillAssessment[];
};

export type PluginUpdateApplyTaskResult = {
  updatedPluginNames: string[];
};

export type PluginUpdateMigrateTaskResult = {
  pluginName: string;
};

export type ListDetectAgentsTaskResult = {
  agents: AgentType[];
};

export type ListScanInventoryTaskResult = {
  rows: ListInventoryRow[];
};

export type AddFetchOrDiscoverTaskResult = {
  skills: AddSourceSkill[];
};

export type AddInstallTaskResult = {
  installedSkillNames: string[];
  agentCount: number;
};

export type PluginAddFetchOrDiscoverTaskResult = {
  plugins: AddSourceSkill[];
};

export type PluginAddInstallTaskResult = {
  installedPluginNames: string[];
  agentCount: number;
};

export type FindInventoryTaskResult = {
  sourceType: "local" | "github" | "git" | "well-known" | "catalog";
  sourceLabel: string;
  skills: AddSourceSkill[];
};

export type ValidateRunTaskResult = {
  diagnostics: ValidateDiagnostic[];
};

export type TestBlockingTaskResult = {
  durationMs: number;
};

export type BackgroundTaskRequestMap = {
  "check.scan": {
    cwd: string;
    options: CheckOptions;
  };
  "update.assess": {
    cwd: string;
    options: CheckOptions;
  };
  "update.apply": {
    cwd: string;
    options: UpdateOptions;
    selectedSkillNames: string[];
    lockFormat: LockfileFormat;
  };
  "update.migrate": {
    cwd: string;
    options: UpdateOptions;
    skillName: string;
    sourceInput: string;
    lockFormat: LockfileFormat;
  };
  "plugin.update.assess": {
    cwd: string;
    options: UpdateOptions;
  };
  "plugin.update.apply": {
    cwd: string;
    options: UpdateOptions;
    selectedPluginNames: string[];
    lockFormat: LockfileFormat;
  };
  "plugin.update.migrate": {
    cwd: string;
    options: UpdateOptions;
    pluginName: string;
    sourceInput: string;
    lockFormat: LockfileFormat;
  };
  "list.detectAgents": {
    cwd: string;
    options: ListOptions;
  };
  "list.scanInventory": {
    cwd: string;
    globalInstall: boolean;
    agents: AgentType[];
  };
  "add.fetchOrDiscover": {
    cwd: string;
    sourceInput: string;
    options: AddOptions;
  };
  "add.install": {
    cwd: string;
    sourceInput: string;
    options: AddOptions;
    selectedSkillNames: string[];
    agents: AgentType[];
  };
  "plugin.add.fetchOrDiscover": {
    cwd: string;
    sourceInput: string;
    options: AddOptions;
  };
  "plugin.add.install": {
    cwd: string;
    sourceInput: string;
    options: AddOptions;
    selectedPluginNames: string[];
    agents: AgentType[];
  };
  "find.fetchInventory": {
    cwd: string;
    sourceInput: string;
    options: FindOptions;
  };
  "validate.run": {
    cwd: string;
    options: ValidateOptions;
  };
  "test.blocking": {
    durationMs: number;
    progressLabel?: string;
  };
};

export type BackgroundTaskResultMap = {
  "check.scan": CheckScanTaskResult;
  "update.assess": UpdateAssessTaskResult;
  "update.apply": UpdateApplyTaskResult;
  "update.migrate": UpdateMigrateTaskResult;
  "plugin.update.assess": PluginUpdateAssessTaskResult;
  "plugin.update.apply": PluginUpdateApplyTaskResult;
  "plugin.update.migrate": PluginUpdateMigrateTaskResult;
  "list.detectAgents": ListDetectAgentsTaskResult;
  "list.scanInventory": ListScanInventoryTaskResult;
  "add.fetchOrDiscover": AddFetchOrDiscoverTaskResult;
  "add.install": AddInstallTaskResult;
  "plugin.add.fetchOrDiscover": PluginAddFetchOrDiscoverTaskResult;
  "plugin.add.install": PluginAddInstallTaskResult;
  "find.fetchInventory": FindInventoryTaskResult;
  "validate.run": ValidateRunTaskResult;
  "test.blocking": TestBlockingTaskResult;
};

export type BackgroundTaskKind = keyof BackgroundTaskRequestMap;

export type BackgroundTaskRequest<TKind extends BackgroundTaskKind = BackgroundTaskKind> =
  TKind extends BackgroundTaskKind
    ? {
        kind: TKind;
        payload: BackgroundTaskRequestMap[TKind];
      }
    : never;

export type BackgroundTaskResult<TKind extends BackgroundTaskKind = BackgroundTaskKind> =
  BackgroundTaskResultMap[TKind];

export type BackgroundTaskProgressEvent = {
  type: "progress";
  label: string;
};

export type BackgroundTaskResultEvent<TKind extends BackgroundTaskKind = BackgroundTaskKind> = {
  type: "result";
  kind: TKind;
  result: BackgroundTaskResultMap[TKind];
};

export type BackgroundTaskErrorEvent = {
  type: "error";
  message: string;
  stack?: string;
};

export type BackgroundTaskEvent =
  | BackgroundTaskProgressEvent
  | {
      [TKind in BackgroundTaskKind]: BackgroundTaskResultEvent<TKind>;
    }[BackgroundTaskKind]
  | BackgroundTaskErrorEvent;
