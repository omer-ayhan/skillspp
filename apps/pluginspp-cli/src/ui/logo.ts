import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type LogoCell = {
  x: number;
  y: number;
  char: string;
  color?: string;
  bgColor?: string;
};

type LogoFrame = {
  cells?: LogoCell[];
};

type LogoSession = {
  canvas?: {
    width?: number;
    height?: number;
  };
  animation?: {
    frameRate?: number;
  };
  frames?: LogoFrame[];
};

export type AnimatedLogo = {
  fps: number;
  frames: string[][];
};

const DEFAULT_LOGO_FPS = 12;
const EMPTY_TEXT_ONLY_LOGO: string[] = [];

let animatedCache: AnimatedLogo | null | undefined;
let staticCache: string[] | null | undefined;

function resolveLogoDir(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(dirname, "../assets/ascii/logo");
}

function resolveSessionPath(): string {
  const customPath = process.env.SKILLSPP_LOGO_SESSION_PATH;
  return (
    customPath || path.join(resolveLogoDir(), "skillspp-logo.session.json")
  );
}

function resolveStaticPath(): string {
  const customPath = process.env.SKILLSPP_LOGO_TEXT_PATH;
  return customPath || path.join(resolveLogoDir(), "skillspp-logo.txt");
}

function trimOuterEmptyRows(lines: string[]): string[] {
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && lines[start]?.trim().length === 0) {
    start += 1;
  }
  while (end >= start && lines[end]?.trim().length === 0) {
    end -= 1;
  }
  return lines.slice(start, end + 1);
}

function parseTextLogo(rawText: string): string[] | null {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const trimmed = trimOuterEmptyRows(lines);
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function parseSessionLogo(rawText: string): AnimatedLogo | null {
  const parsed = JSON.parse(rawText) as LogoSession;
  const width = Math.max(1, parsed.canvas?.width ?? 48);
  const height = Math.max(1, parsed.canvas?.height ?? 16);
  const fps = Math.max(1, parsed.animation?.frameRate ?? DEFAULT_LOGO_FPS);
  const sourceFrames = parsed.frames ?? [];
  if (sourceFrames.length === 0) {
    return null;
  }

  const renderedFrames: string[][] = [];
  for (const frame of sourceFrames) {
    const grid = Array.from({ length: height }, () => Array(width).fill(" "));
    for (const cell of frame.cells ?? []) {
      if (
        cell &&
        Number.isInteger(cell.x) &&
        Number.isInteger(cell.y) &&
        typeof cell.char === "string" &&
        cell.char.length > 0 &&
        cell.x >= 0 &&
        cell.x < width &&
        cell.y >= 0 &&
        cell.y < height
      ) {
        grid[cell.y][cell.x] = colorizeChar(
          normalizeLogoChar(cell.char[0] ?? " "),
          cell.color ?? null,
        );
      }
    }
    const lines = grid.map((row) => row.join(""));
    const trimmed = trimOuterEmptyRows(lines);
    if (trimmed.length > 0) {
      renderedFrames.push(trimmed);
    }
  }

  if (renderedFrames.length === 0) {
    return null;
  }

  return { fps, frames: renderedFrames };
}

function normalizeLogoChar(char: string): string {
  // Prevent hash-style fallback logos by normalizing legacy glyphs to blocks.
  if (char === "#") {
    return "█";
  }
  return char;
}

function colorizeChar(char: string, hexColor: string | null): string {
  if (!hexColor) {
    return char;
  }
  const rgb = parseHexColor(hexColor);
  if (!rgb) {
    return char;
  }
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${char}\x1b[0m`;
}

function parseHexColor(
  color: string,
): { r: number; g: number; b: number } | null {
  const value = color.trim();
  const short = /^#([0-9a-fA-F]{3})$/;
  const full = /^#([0-9a-fA-F]{6})$/;
  if (short.test(value)) {
    const raw = short.exec(value)?.[1];
    if (!raw) {
      return null;
    }
    return {
      r: Number.parseInt(`${raw[0]}${raw[0]}`, 16),
      g: Number.parseInt(`${raw[1]}${raw[1]}`, 16),
      b: Number.parseInt(`${raw[2]}${raw[2]}`, 16),
    };
  }
  if (full.test(value)) {
    const raw = full.exec(value)?.[1];
    if (!raw) {
      return null;
    }
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

function readFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function resetLogoCache(): void {
  animatedCache = undefined;
  staticCache = undefined;
}

export function getAnimatedLogoFrames(): AnimatedLogo | null {
  if (animatedCache !== undefined) {
    return animatedCache;
  }

  const rawText = readFileSafe(resolveSessionPath());
  if (!rawText) {
    animatedCache = null;
    return animatedCache;
  }

  try {
    animatedCache = parseSessionLogo(rawText);
  } catch {
    animatedCache = null;
  }
  return animatedCache;
}

export function getStaticLogoLines(): string[] | null {
  if (staticCache !== undefined) {
    return staticCache;
  }

  const rawText = readFileSafe(resolveStaticPath());
  if (!rawText) {
    staticCache = null;
    return staticCache;
  }

  staticCache = parseTextLogo(rawText);
  return staticCache;
}

export function getBannerLogoLines(): string[] {
  const animated = getAnimatedLogoFrames();
  if (animated && animated.frames.length > 0) {
    return animated.frames[0] ?? EMPTY_TEXT_ONLY_LOGO;
  }
  return getStaticLogoLines() ?? EMPTY_TEXT_ONLY_LOGO;
}
