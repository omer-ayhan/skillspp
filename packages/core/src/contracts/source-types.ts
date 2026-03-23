export type SourceResolveOptions = {
  allowHost?: string[];
  denyHost?: string[];
  maxDownloadBytes?: number;
  experimental?: boolean;
};

export type SourceLockSelector = {
  skillName: string;
  relativePath?: string;
  wellKnownSourceUrl?: string;
};

export type SourceLockEntry = {
  source: {
    input: string;
    type?: "local" | "github" | "git" | "well-known" | "catalog";
    canonical?: string;
    pinnedRef?: string;
    resolvedPath?: string;
    isSymlinkSource?: boolean;
    selector: SourceLockSelector;
  };
};
