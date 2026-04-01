import path from "node:path";
import type {
  ParsedSource,
  Skill,
  AddOptions,
} from "../contracts/runtime-types";
import { parseSource } from "./source-parser";
import { prepareSourceDir } from "./git";
import {
  discoverSkills,
  filterSkillsByName,
  stageRemoteSkillFilesToTempDir,
} from "./skills";
import { getProviderById, initializeProviders } from "../providers";
import type {
  RemotePlugin,
  RemoteSkill,
  RemoteSkillsProvider,
} from "../providers";

import type { LockEntry } from "../runtime/lockfile";
import { assertExperimentalFeatureEnabled } from "../application/experimental";

export type SourceCandidate = {
  skill: Skill;
  sourceSkillPath?: string;
  wellKnownSourceUrl?: string;
  cleanup?: () => void;
};

export async function resolveWellKnownSkills(
  sourceUrl: string,
  options: AddOptions,
): Promise<RemoteSkill[]> {
  initializeProviders();
  const provider = getProviderById("well-known");
  if (!provider) {
    throw new Error("Well-known provider is not registered");
  }

  const wellKnown = provider as RemoteSkillsProvider;
  return wellKnown.fetchAllSkills(sourceUrl, {
    allowHosts: options.allowHost,
    denyHosts: options.denyHost,
    maxDownloadBytes: options.maxDownloadBytes,
  });
}

export async function resolveCatalogSkills(
  sourceUrl: string,
  options: AddOptions,
): Promise<RemoteSkill[]> {
  assertExperimentalFeatureEnabled("catalog", Boolean(options.experimental));
  initializeProviders();
  const provider = getProviderById("catalog");
  if (!provider) {
    throw new Error("Catalog provider is not registered");
  }
  const catalog = provider as RemoteSkillsProvider;
  return catalog.fetchAllSkills(sourceUrl, {
    allowHosts: options.allowHost,
    denyHosts: options.denyHost,
    maxDownloadBytes: options.maxDownloadBytes,
  });
}

export async function resolveWellKnownPlugins(
  sourceUrl: string,
  options: AddOptions,
): Promise<RemotePlugin[]> {
  initializeProviders();
  const provider = getProviderById("well-known");
  if (!provider) {
    throw new Error("Well-known provider is not registered");
  }

  const wellKnown = provider as RemoteSkillsProvider;
  return wellKnown.fetchAllPlugins(sourceUrl, {
    allowHosts: options.allowHost,
    denyHosts: options.denyHost,
    maxDownloadBytes: options.maxDownloadBytes,
  });
}

export async function resolveCatalogPlugins(
  sourceUrl: string,
  options: AddOptions,
): Promise<RemotePlugin[]> {
  assertExperimentalFeatureEnabled("catalog", Boolean(options.experimental));
  initializeProviders();
  const provider = getProviderById("catalog");
  if (!provider) {
    throw new Error("Catalog provider is not registered");
  }
  const catalog = provider as RemoteSkillsProvider;
  return catalog.fetchAllPlugins(sourceUrl, {
    allowHosts: options.allowHost,
    denyHosts: options.denyHost,
    maxDownloadBytes: options.maxDownloadBytes,
  });
}

export async function resolveSourceCandidates(
  sourceInput: string,
  options: AddOptions,
  requestedSkills?: string[],
): Promise<SourceCandidate[]> {
  const parsed = parseSource(sourceInput);

  if (parsed.type === "well-known" || parsed.type === "catalog") {
    const remoteSkills =
      parsed.type === "well-known"
        ? await resolveWellKnownSkills(parsed.url, options)
        : await resolveCatalogSkills(parsed.url, options);
    const indexSkills: Skill[] = remoteSkills.map((remote) => ({
      name: remote.installName,
      description: remote.description,
      path: remote.sourceUrl,
    }));

    const selected = requestedSkills
      ? filterSkillsByName(indexSkills, requestedSkills)
      : indexSkills;
    const pickedNames = new Set(selected.map((item) => item.name));

    return remoteSkills
      .filter((remote) => pickedNames.has(remote.installName))
      .map((remote) => {
        const staged = stageRemoteSkillFilesToTempDir(remote.files);
        return {
          skill: {
            name: remote.installName,
            description: remote.description,
            path: staged.path,
          },
          wellKnownSourceUrl: remote.sourceUrl,
          cleanup: staged.cleanup,
        };
      });
  }

  const prepared = prepareSourceDir(
    parsed as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );
  try {
    const skills = discoverSkills(prepared.basePath);
    const selected = requestedSkills
      ? filterSkillsByName(skills, requestedSkills)
      : skills;

    return selected.map((skill) => ({
      skill,
      sourceSkillPath: path.relative(prepared.basePath, skill.path) || ".",
      cleanup: prepared.cleanup,
    }));
  } catch (error) {
    if (prepared.cleanup) {
      prepared.cleanup();
    }
    throw error;
  }
}

export async function resolveSkillFromLockEntry(
  entry: LockEntry,
  options: AddOptions,
): Promise<SourceCandidate> {
  const parsed = parseSource(entry.source.input);

  if (parsed.type === "well-known" || parsed.type === "catalog") {
    const remoteSkills =
      parsed.type === "well-known"
        ? await resolveWellKnownSkills(parsed.url, options)
        : await resolveCatalogSkills(parsed.url, options);
    const matched = remoteSkills.find(
      (item) => item.installName === entry.source.selector.skillName,
    );
    if (!matched) {
      throw new Error(
        `Skill '${entry.source.selector.skillName}' not found in well-known source`,
      );
    }

    const staged = stageRemoteSkillFilesToTempDir(matched.files);
    return {
      skill: {
        name: matched.installName,
        description: matched.description,
        path: staged.path,
      },
      wellKnownSourceUrl: matched.sourceUrl,
      cleanup: staged.cleanup,
    };
  }

  const prepared = prepareSourceDir(
    parsed as Exclude<ParsedSource, { type: "well-known" | "catalog" }>,
  );

  try {
    let targetPath = prepared.basePath;
    if (entry.source.selector.relativePath) {
      targetPath = path.join(
        prepared.basePath,
        entry.source.selector.relativePath,
      );
    }

    const skills = discoverSkills(prepared.basePath);
    const byName = skills.find(
      (item) => item.name === entry.source.selector.skillName,
    );
    const byPath = skills.find(
      (item) => path.resolve(item.path) === path.resolve(targetPath),
    );
    const matched = byPath || byName;

    if (!matched) {
      throw new Error(
        `Skill '${entry.source.selector.skillName}' not found in source`,
      );
    }

    return {
      skill: matched,
      sourceSkillPath: path.relative(prepared.basePath, matched.path) || ".",
      cleanup: prepared.cleanup,
    };
  } catch (error) {
    if (prepared.cleanup) {
      prepared.cleanup();
    }
    throw error;
  }
}
