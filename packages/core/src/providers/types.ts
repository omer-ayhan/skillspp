export type ProviderMatch = {
  matches: boolean;
  sourceIdentifier?: string;
};

export type RemoteSkill = {
  name: string;
  description: string;
  installName: string;
  sourceUrl: string;
  sourceType: "well-known" | "catalog";
  files: Map<string, string>;
};

export type WellKnownFetchOptions = {
  allowHosts?: string[];
  denyHosts?: string[];
  maxDownloadBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  maxFilesPerSkill?: number;
  maxSkillFileBytes?: number;
};

export interface HostProvider {
  readonly id: string;
  readonly displayName: string;
  match(url: string): ProviderMatch;
}

export interface WellKnownProvider extends HostProvider {
  fetchAllSkills(
    url: string,
    options?: WellKnownFetchOptions
  ): Promise<RemoteSkill[]>;
}

export interface RemoteSkillsProvider extends HostProvider {
  fetchAllSkills(
    url: string,
    options?: WellKnownFetchOptions
  ): Promise<RemoteSkill[]>;
}
