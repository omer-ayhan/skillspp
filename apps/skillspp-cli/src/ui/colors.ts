export type ColorToken =
  | "primary"
  | "success"
  | "danger"
  | "warning"
  | "accent"
  | "muted"
  | "info";

const ANSI_ESCAPE = "\x1b[";
export const ANSI_RESET = "\x1b[0m";

export const COLOR_TOKENS: Record<ColorToken, string> = {
  primary: "38;2;86;172;235",
  success: "32",
  danger: "31",
  warning: "33",
  accent: "35",
  muted: "90",
  info: "36",
};

function isColorEnabled(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

export function ansiStyle(
  text: string,
  code: string,
  colorEnabled?: boolean,
): string {
  if (!isColorEnabled(colorEnabled)) {
    return text;
  }
  return `${ANSI_ESCAPE}${code}m${text}${ANSI_RESET}`;
}

export function colorToken(
  text: string,
  token: ColorToken,
  colorEnabled?: boolean,
): string {
  return ansiStyle(text, COLOR_TOKENS[token], colorEnabled);
}

export function bold(text: string, colorEnabled?: boolean): string {
  return ansiStyle(text, "1", colorEnabled);
}

export function dim(text: string, colorEnabled?: boolean): string {
  return ansiStyle(text, "2", colorEnabled);
}
