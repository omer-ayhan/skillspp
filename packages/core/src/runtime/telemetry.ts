import { randomUUID } from "node:crypto";

export type LifecycleEvent = {
  eventSchemaVersion: 1;
  eventType: string;
  source: string;
  reason: string;
  runId: string;
  timestamp: string;
  command: string;
  status: "start" | "ok" | "error" | "warn";
  error?: string;
  metadata?: Record<string, unknown>;
};

export type TelemetryEmitter = {
  runId: string;
  publish: (event: LifecycleEvent) => void;
  subscribe: (listener: TelemetryListener) => () => void;
};

export type TelemetryListener = (event: LifecycleEvent) => void;

class TelemetryBus {
  private listeners = new Set<TelemetryListener>();

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: LifecycleEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createTelemetryEmitter(): TelemetryEmitter {
  const bus = new TelemetryBus();

  return {
    runId: randomUUID(),
    publish: (event) => bus.publish(event),
    subscribe: (listener) => bus.subscribe(listener),
  };
}

export function subscribeLifecycleEvents(
  emitter: TelemetryEmitter,
  listener: TelemetryListener
): () => void {
  return emitter.subscribe(listener);
}

export function emitLifecycleEvent(
  emitter: TelemetryEmitter,
  event: Omit<LifecycleEvent, "eventSchemaVersion" | "runId" | "timestamp">
): void {
  const row: LifecycleEvent = {
    eventSchemaVersion: 1,
    runId: emitter.runId,
    timestamp: new Date().toISOString(),
    ...event,
  };

  emitter.publish(row);
}
