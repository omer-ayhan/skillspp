import type { PolicyMode } from "@skillspp/core/policy";

export function parsePolicyMode(value?: string): PolicyMode {
  if (!value) {
    return "enforce";
  }
  if (value === "enforce" || value === "warn") {
    return value;
  }
  throw new Error(`Invalid --policy-mode value: ${value}`);
}
