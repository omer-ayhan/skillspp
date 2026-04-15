import fs from "node:fs";
import path from "node:path";

export type InstallerSecuritySeverity = "error" | "warning";

export type InstallerSecurityViolation = {
  rule: "installer-local-dependency-absolute-path" | "installer-local-dependency-path-escape";
  message: string;
  severity: InstallerSecuritySeverity;
  blocking: boolean;
};

export type InstallerSecurityEvaluationInput = {
  source: string;
  sourceRoot: string;
};

export type InstallerSecurityEvaluationOptions = {
  // Reserved for Phase 6 policy controls.
  readonly policyMode?: "fixed";
};

export type InstallerSecurityEvaluationResult =
  | {
      ok: true;
      resolvedPath: string;
    }
  | {
      ok: false;
      violation: InstallerSecurityViolation;
    };

function isInsideRoot(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(rootDir, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function toEscapeViolation(source: string): InstallerSecurityViolation {
  return {
    rule: "installer-local-dependency-path-escape",
    message: `local dependency escapes source root: ${source}`,
    severity: "error",
    blocking: true,
  };
}

export function evaluateInstallerLocalDependency(
  input: InstallerSecurityEvaluationInput,
  _options: InstallerSecurityEvaluationOptions = {},
): InstallerSecurityEvaluationResult {
  if (path.isAbsolute(input.source)) {
    return {
      ok: false,
      violation: {
        rule: "installer-local-dependency-absolute-path",
        message: `absolute local dependency paths are not allowed: ${input.source}`,
        severity: "error",
        blocking: true,
      },
    };
  }

  const resolvedRoot = path.resolve(input.sourceRoot);
  const resolvedSourcePath = path.resolve(resolvedRoot, input.source);

  if (!isInsideRoot(resolvedRoot, resolvedSourcePath)) {
    return {
      ok: false,
      violation: toEscapeViolation(input.source),
    };
  }

  if (fs.existsSync(resolvedSourcePath)) {
    const realRoot = fs.realpathSync.native
      ? fs.realpathSync.native(resolvedRoot)
      : fs.realpathSync(resolvedRoot);
    const realSource = fs.realpathSync.native
      ? fs.realpathSync.native(resolvedSourcePath)
      : fs.realpathSync(resolvedSourcePath);
    if (!isInsideRoot(realRoot, realSource)) {
      return {
        ok: false,
        violation: toEscapeViolation(input.source),
      };
    }
  }

  return {
    ok: true,
    resolvedPath: resolvedSourcePath,
  };
}
