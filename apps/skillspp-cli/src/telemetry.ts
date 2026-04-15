import { createTelemetryEmitter, type TelemetryEmitter } from "@skillspp/core/telemetry";

export type TelemetrySink = "stdout-json";

export function parseTelemetrySink(value?: string): TelemetrySink | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "stdout-json") {
    return value;
  }
  throw new Error(`Invalid --telemetry value: ${value}`);
}

export function createCliTelemetryEmitter(sink?: TelemetrySink): TelemetryEmitter {
  const emitter = createTelemetryEmitter();
  if (sink === "stdout-json") {
    emitter.subscribe((event) => {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    });
  }
  return emitter;
}
