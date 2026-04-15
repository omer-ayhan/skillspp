import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "../contracts/runtime-types";
import { stageRemoteSkillFilesToTempDir, type RemoteStagingResult } from "./skills";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "__pycache__"]);

type PluginManifest = {
  name: string;
  description?: string;
};

type PluginInspection = {
  pluginName: string;
  pluginDir: string;
  plugin?: Plugin;
  error?: Error;
};

type ManifestCandidate = {
  description: string;
  relativePath: string;
};

function resolvePluginsRootFromStat(basePath: string, stat: fs.Stats): string {
  if (stat.isDirectory() && path.basename(basePath) === "plugins") {
    return basePath;
  }

  const pluginsDir = path.join(basePath, "plugins");
  if (fs.existsSync(pluginsDir) && fs.statSync(pluginsDir).isDirectory()) {
    return pluginsDir;
  }

  throw new Error("No plugins directory found in source");
}

export function resolvePluginsRoot(basePath: string): string {
  if (!fs.existsSync(basePath)) {
    throw new Error(`Local source not found: ${basePath}`);
  }
  return resolvePluginsRootFromStat(basePath, fs.statSync(basePath));
}

async function resolvePluginsRootAsync(basePath: string): Promise<string> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(basePath);
  } catch {
    throw new Error(`Local source not found: ${basePath}`);
  }

  if (stat.isDirectory() && path.basename(basePath) === "plugins") {
    return basePath;
  }

  const pluginsDir = path.join(basePath, "plugins");
  try {
    const pluginsStat = await fs.promises.stat(pluginsDir);
    if (pluginsStat.isDirectory()) {
      return pluginsDir;
    }
  } catch {
    // handled below
  }

  throw new Error("No plugins directory found in source");
}

function collectPluginJsonFilesRecursive(dir: string, pluginRoot: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPluginJsonFilesRecursive(fullPath, pluginRoot, out);
      continue;
    }

    if (entry.isFile() && path.basename(fullPath).toLowerCase() === "plugin.json") {
      out.push(path.relative(pluginRoot, fullPath));
    }
  }
}

async function collectPluginJsonFilesRecursiveAsync(
  dir: string,
  pluginRoot: string,
  out: string[],
): Promise<void> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectPluginJsonFilesRecursiveAsync(fullPath, pluginRoot, out);
      continue;
    }

    if (entry.isFile() && path.basename(fullPath).toLowerCase() === "plugin.json") {
      out.push(path.relative(pluginRoot, fullPath));
    }
  }
}

function parsePluginManifest(manifestPath: string, pluginName: string): PluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error(`Plugin '${pluginName}' has invalid plugin.json`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Plugin '${pluginName}' has invalid plugin.json`);
  }

  const data = parsed as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    throw new Error(`Plugin '${pluginName}' plugin.json is missing name`);
  }

  if (data.name !== pluginName) {
    throw new Error(`Plugin '${pluginName}' plugin.json name must match plugin folder name`);
  }

  return {
    name: data.name,
    description: typeof data.description === "string" ? data.description : undefined,
  };
}

async function parsePluginManifestAsync(
  manifestPath: string,
  pluginName: string,
): Promise<PluginManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error(`Plugin '${pluginName}' has invalid plugin.json`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Plugin '${pluginName}' has invalid plugin.json`);
  }

  const data = parsed as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    throw new Error(`Plugin '${pluginName}' plugin.json is missing name`);
  }

  if (data.name !== pluginName) {
    throw new Error(`Plugin '${pluginName}' plugin.json name must match plugin folder name`);
  }

  return {
    name: data.name,
    description: typeof data.description === "string" ? data.description : undefined,
  };
}

function sortManifestCandidates(a: string, b: string): number {
  const depthA = a.split(path.sep).length;
  const depthB = b.split(path.sep).length;
  if (depthA !== depthB) {
    return depthA - depthB;
  }
  return a.localeCompare(b);
}

function inspectPluginFolder(pluginDir: string): PluginInspection {
  const pluginName = path.basename(pluginDir);
  const pluginJsonRelativePaths: string[] = [];
  collectPluginJsonFilesRecursive(pluginDir, pluginDir, pluginJsonRelativePaths);
  pluginJsonRelativePaths.sort(sortManifestCandidates);

  if (pluginJsonRelativePaths.length === 0) {
    return {
      pluginName,
      pluginDir,
      error: new Error(`Plugin '${pluginName}' is missing plugin.json`),
    };
  }

  const manifests: ManifestCandidate[] = [];
  try {
    for (const relativePath of pluginJsonRelativePaths) {
      const manifest = parsePluginManifest(path.join(pluginDir, relativePath), pluginName);
      manifests.push({
        description: manifest.description || "",
        relativePath,
      });
    }
  } catch (error) {
    return {
      pluginName,
      pluginDir,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const selectedManifest = manifests[0];
  return {
    pluginName,
    pluginDir,
    plugin: {
      name: pluginName,
      description: selectedManifest?.description || "",
      path: pluginDir,
    },
  };
}

async function inspectPluginFolderAsync(pluginDir: string): Promise<PluginInspection> {
  const pluginName = path.basename(pluginDir);
  const pluginJsonRelativePaths: string[] = [];
  await collectPluginJsonFilesRecursiveAsync(pluginDir, pluginDir, pluginJsonRelativePaths);
  pluginJsonRelativePaths.sort(sortManifestCandidates);

  if (pluginJsonRelativePaths.length === 0) {
    return {
      pluginName,
      pluginDir,
      error: new Error(`Plugin '${pluginName}' is missing plugin.json`),
    };
  }

  const manifests: ManifestCandidate[] = [];
  try {
    for (const relativePath of pluginJsonRelativePaths) {
      const manifest = await parsePluginManifestAsync(
        path.join(pluginDir, relativePath),
        pluginName,
      );
      manifests.push({
        description: manifest.description || "",
        relativePath,
      });
    }
  } catch (error) {
    return {
      pluginName,
      pluginDir,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  const selectedManifest = manifests[0];
  return {
    pluginName,
    pluginDir,
    plugin: {
      name: pluginName,
      description: selectedManifest?.description || "",
      path: pluginDir,
    },
  };
}

function filterRequestedPluginErrors(
  requestedPlugins: string[] | undefined,
  inspections: PluginInspection[],
): void {
  if (!requestedPlugins || requestedPlugins.length === 0) {
    return;
  }
  if (requestedPlugins.includes("*")) {
    return;
  }

  const inspectionByName = new Map(
    inspections.map((inspection) => [inspection.pluginName, inspection]),
  );

  for (const requestedPlugin of requestedPlugins) {
    const inspection = inspectionByName.get(requestedPlugin);
    if (inspection?.error) {
      throw inspection.error;
    }
  }
}

export function discoverPlugins(basePath: string, requestedPlugins?: string[]): Plugin[] {
  const pluginsRoot = resolvePluginsRoot(basePath);
  const entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
  const inspections = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => inspectPluginFolder(path.join(pluginsRoot, entry.name)));

  filterRequestedPluginErrors(requestedPlugins, inspections);

  return filterPluginsByName(
    inspections
      .map((inspection) => inspection.plugin)
      .filter((plugin): plugin is Plugin => Boolean(plugin)),
    requestedPlugins,
  );
}

export async function discoverPluginsAsync(
  basePath: string,
  requestedPlugins?: string[],
): Promise<Plugin[]> {
  const pluginsRoot = await resolvePluginsRootAsync(basePath);
  const entries = await fs.promises.readdir(pluginsRoot, {
    withFileTypes: true,
  });

  const inspections = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => inspectPluginFolderAsync(path.join(pluginsRoot, entry.name))),
  );

  filterRequestedPluginErrors(requestedPlugins, inspections);

  return filterPluginsByName(
    inspections
      .map((inspection) => inspection.plugin)
      .filter((plugin): plugin is Plugin => Boolean(plugin)),
    requestedPlugins,
  );
}

export function filterPluginsByName(plugins: Plugin[], requested?: string[]): Plugin[] {
  if (!requested || requested.length === 0) {
    return plugins;
  }

  if (requested.includes("*")) {
    return plugins;
  }

  const wanted = new Set(requested.map((item) => item.toLowerCase()));
  return plugins.filter((plugin) => wanted.has(plugin.name.toLowerCase()));
}

export function stageRemotePluginFilesToTempDir(
  pluginName: string,
  files: Map<string, string>,
): RemoteStagingResult {
  const prefixed = new Map<string, string>();
  for (const [relativePath, content] of files.entries()) {
    prefixed.set(path.join("plugins", pluginName, relativePath), content);
  }

  return stageRemoteSkillFilesToTempDir(prefixed, {
    prefix: "skillspp-remote-plugin-",
  });
}
