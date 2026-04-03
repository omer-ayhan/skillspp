import type {
  AddFetchOrDiscoverTaskResult,
  AddInstallTaskResult,
  BackgroundTaskKind,
  BackgroundTaskRequest,
  BackgroundTaskRequestMap,
  BackgroundTaskResult,
  BackgroundTaskResultMap,
  CheckScanTaskResult,
  FindInventoryTaskResult,
  ListDetectAgentsTaskResult,
  ListScanInventoryTaskResult,
  PluginAddFetchOrDiscoverTaskResult,
  PluginAddInstallTaskResult,
  PluginUpdateApplyTaskResult,
  PluginUpdateAssessTaskResult,
  PluginUpdateMigrateTaskResult,
  UpdateApplyTaskResult,
  UpdateAssessTaskResult,
  UpdateMigrateTaskResult,
  ValidateRunTaskResult,
} from "@skillspp/core/runtime/background-task-contracts";

export type {
  AddFetchOrDiscoverTaskResult,
  AddInstallTaskResult,
  BackgroundTaskKind,
  BackgroundTaskRequest,
  BackgroundTaskRequestMap,
  BackgroundTaskResult,
  BackgroundTaskResultMap,
  CheckScanTaskResult,
  FindInventoryTaskResult,
  ListDetectAgentsTaskResult,
  ListScanInventoryTaskResult,
  PluginAddFetchOrDiscoverTaskResult,
  PluginAddInstallTaskResult,
  PluginUpdateApplyTaskResult,
  PluginUpdateAssessTaskResult,
  PluginUpdateMigrateTaskResult,
  UpdateApplyTaskResult,
  UpdateAssessTaskResult,
  UpdateMigrateTaskResult,
  ValidateRunTaskResult,
};

export type BackgroundTaskProgressEvent = {
  type: "progress";
  label: string;
};

export type BackgroundTaskResultEvent<
  TKind extends BackgroundTaskKind = BackgroundTaskKind
> = {
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
