export type LifecycleEventStatus = "start" | "ok" | "error";

export type LifecycleEventV1 = {
  eventSchemaVersion: "1";
  eventType: string;
  command: string;
  status: LifecycleEventStatus;
  timestamp: string;
  metadata?: Record<string, unknown>;
  error?: string;
};
