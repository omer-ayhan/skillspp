import os from "node:os";
import path from "node:path";
import { colorToken } from "./colors";

export function shortenHomePath(value: string, homeDir: string = os.homedir()) {
  if (value === homeDir || value.startsWith(`${homeDir}${path.sep}`)) {
    return `~${value.slice(homeDir.length)}`;
  }
  return value;
}

export function compactAgentDisplayNames(
  names: string[],
  maxVisible = 4,
): string {
  if (names.length <= maxVisible) {
    return names.join(", ");
  }
  return `${names.slice(0, maxVisible).join(", ")} +${
    names.length - maxVisible
  } more`;
}

export function formatDriftChips(options: {
  plusCount: number;
  minusCount: number;
  colorEnabled?: boolean;
}): string {
  const plus = `+${Math.max(0, options.plusCount)}`;
  const minus = `-${Math.max(0, options.minusCount)}`;
  const colorEnabled = options.colorEnabled !== false;
  if (!colorEnabled) {
    return `${plus}  ${minus}`;
  }
  return `${colorToken(plus, "success", colorEnabled)}  ${colorToken(
    minus,
    "danger",
    colorEnabled,
  )}`;
}
