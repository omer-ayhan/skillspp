import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type InstallerScaffoldFormat = "json" | "yaml";

type InstallerConfigState = {
  yamlPath: string;
  jsonPath: string;
  hasYaml: boolean;
  hasJson: boolean;
  missing: boolean;
};

function installerConfigSkeleton(): {
  schemaVersion: 1;
  dependencies: unknown[];
  "pre-install": string[];
  "post-install": string[];
} {
  return {
    schemaVersion: 1,
    dependencies: [],
    "pre-install": [],
    "post-install": [],
  };
}

function isFile(filePath: string): boolean {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

export function getInstallerConfigState(skillDir: string): InstallerConfigState {
  const yamlPath = path.join(skillDir, "skill-installer.yaml");
  const jsonPath = path.join(skillDir, "skill-installer.json");
  const hasYaml = isFile(yamlPath);
  const hasJson = isFile(jsonPath);

  if (hasYaml && hasJson) {
    throw new Error(
      "Both skill-installer.yaml and skill-installer.json exist. Keep only one installer config file.",
    );
  }

  return {
    yamlPath,
    jsonPath,
    hasYaml,
    hasJson,
    missing: !hasYaml && !hasJson,
  };
}

export function listSkillsMissingInstallerConfig(skillDirs: string[]): string[] {
  return skillDirs.filter((skillDir) => getInstallerConfigState(skillDir).missing);
}

export function scaffoldInstallerConfigFile(
  skillDir: string,
  format: InstallerScaffoldFormat,
): { created: boolean; filePath?: string } {
  const state = getInstallerConfigState(skillDir);
  if (!state.missing) {
    return { created: false };
  }

  const content =
    format === "yaml"
      ? YAML.stringify(installerConfigSkeleton())
      : JSON.stringify(installerConfigSkeleton(), null, 2);
  const destinationPath = format === "yaml" ? state.yamlPath : state.jsonPath;
  fs.writeFileSync(destinationPath, `${content}\n`, "utf8");
  return { created: true, filePath: destinationPath };
}

export function scaffoldInstallerConfigForSkills(
  skillDirs: string[],
  format: InstallerScaffoldFormat,
): string[] {
  const created: string[] = [];
  for (const skillDir of skillDirs) {
    const result = scaffoldInstallerConfigFile(skillDir, format);
    if (result.created && result.filePath) {
      created.push(result.filePath);
    }
  }
  return created;
}
