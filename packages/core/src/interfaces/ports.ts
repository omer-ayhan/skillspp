import type {
  AddPluginCommand,
  AddSkillCommand,
  CheckSkillCommand,
  FindSkillCommand,
  InitSkillCommand,
  ListSkillCommand,
  RemoveSkillCommand,
  UpdateSkillCommand,
  ValidateSkillCommand,
} from "../contracts/commands";
import type {
  AddPluginResult,
  AddSkillResult,
  CheckSkillResult,
  FindSkillResult,
  InitSkillResult,
  ListSkillResult,
  RemoveSkillResult,
  UpdateSkillResult,
  ValidationReport,
} from "../contracts/results";
import type { LifecycleEventV1 } from "../contracts/events/lifecycle-event";

export type FileSystemPort = {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
};

export type SourceProviderPort = {
  resolve(input: string): Promise<unknown>;
};

export type ProcessRunnerPort = {
  run(command: string, args: string[], cwd?: string): Promise<{ code: number }>;
};

export type TelemetryPort = {
  emit(event: LifecycleEventV1): void;
};

export type PolicyPort = {
  evaluate(input: unknown): Promise<{ ok: boolean; reason?: string }>;
};

export type ClockPort = {
  nowIso(): string;
};

export type CoreCommandPort = {
  addSkill(command: AddSkillCommand): Promise<AddSkillResult>;
  updateSkill(command: UpdateSkillCommand): Promise<UpdateSkillResult>;
  checkSkill(command: CheckSkillCommand): Promise<CheckSkillResult>;
  validateSkill(command: ValidateSkillCommand): Promise<ValidationReport>;
  listSkill(command: ListSkillCommand): Promise<ListSkillResult>;
  removeSkill(command: RemoveSkillCommand): Promise<RemoveSkillResult>;
  findSkill(command: FindSkillCommand): Promise<FindSkillResult>;
  initSkill(command: InitSkillCommand): Promise<InitSkillResult>;
  addPlugin(command: AddPluginCommand): Promise<AddPluginResult>;
};
