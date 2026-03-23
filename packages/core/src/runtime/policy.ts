import type { ParsedSource } from "../contracts/runtime-types";
import {
  evaluateInstallerLocalDependency as evaluateLocalDependencySecurity,
  type InstallerSecurityEvaluationResult,
  type InstallerSecurityViolation,
} from "./installer-security";

export type PolicyMode = "enforce" | "warn";

export type PolicyViolation =
  | InstallerSecurityViolation
  | {
      rule: "hook-trust-required";
      message: string;
      severity: "error" | "warning";
      blocking: boolean;
    };

export type PolicyDecision = {
  allowed: boolean;
  violation?: PolicyViolation;
};

function applyMode(
  result: InstallerSecurityEvaluationResult,
  mode: PolicyMode
): InstallerSecurityEvaluationResult {
  if (mode === "enforce" || result.ok) {
    return result;
  }
  const violation = "violation" in result ? result.violation : undefined;
  if (!violation) {
    return result;
  }
  return {
    ok: false,
    violation: {
      ...violation,
      severity: "warning",
      blocking: false,
    },
  };
}

export function evaluateInstallerLocalDependencyPolicy(
  input: { source: string; sourceRoot: string },
  mode: PolicyMode
): InstallerSecurityEvaluationResult {
  return applyMode(
    evaluateLocalDependencySecurity(input, { policyMode: "fixed" }),
    mode
  );
}

export function evaluateHookTrustPolicy(input: {
  sourceType: ParsedSource["type"];
  trustWellKnown: boolean;
  mode: PolicyMode;
}): PolicyDecision {
  if (input.sourceType !== "well-known") {
    return { allowed: true };
  }

  if (input.trustWellKnown) {
    return { allowed: true };
  }

  if (input.mode === "warn") {
    return {
      allowed: true,
      violation: {
        rule: "hook-trust-required",
        message:
          "Well-known hook commands are untrusted. Proceeding due to warning policy mode.",
        severity: "warning",
        blocking: false,
      },
    };
  }

  return {
    allowed: false,
    violation: {
      rule: "hook-trust-required",
      message:
        "Blocked skill-installer hook commands for well-known source. Trust this source explicitly or use warning policy mode.",
      severity: "error",
      blocking: true,
    },
  };
}
