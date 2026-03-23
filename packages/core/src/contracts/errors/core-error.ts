export type CoreErrorCode =
  | `VALIDATION_${string}`
  | `SOURCE_${string}`
  | `INSTALL_${string}`
  | `POLICY_${string}`
  | `INTERNAL_${string}`;

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(input: {
    code: CoreErrorCode;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "CoreError";
    this.code = input.code;
    this.details = input.details;
    this.cause = input.cause;
  }
}
