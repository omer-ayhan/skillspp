import type {
  ProviderMatch,
  RemotePlugin,
  RemoteSkill,
  RemoteSkillsProvider,
  WellKnownFetchOptions,
} from "./types";

type CatalogIndexEntry = {
  name: string;
  description?: string;
  files: string[];
};

type ResourceKind = "skills" | "plugins";

type ResourceConfig<TResult> = {
  kind: ResourceKind;
  indexLabel: string;
  resolveIndexUrl: (parsed: URL) => string;
  requireDescription: boolean;
  missingManifestMessage: (name: string) => string;
  hasRequiredManifest: (filePath: string) => boolean;
  buildRemoteResult: (options: {
    entry: CatalogIndexEntry;
    files: Map<string, string>;
    sourceUrl: string;
  }) => TResult;
};

const DEFAULT_OPTIONS = {
  maxDownloadBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
  maxFilesPerSkill: 128,
  maxSkillFileBytes: 512 * 1024,
};

export class HttpCatalogProvider implements RemoteSkillsProvider {
  readonly id = "catalog";
  readonly displayName = "HTTP Catalog Skills";

  match(url: string): ProviderMatch {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return { matches: false };
      }
      return { matches: true, sourceIdentifier: this.getSourceIdentifier(url) };
    } catch {
      return { matches: false };
    }
  }

  getSourceIdentifier(url: string): string {
    const parsed = new URL(url);
    return `catalog/${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
  }

  async fetchAllSkills(
    url: string,
    options: WellKnownFetchOptions = {},
  ): Promise<RemoteSkill[]> {
    return this.fetchAllResources(url, options, {
      kind: "skills",
      indexLabel: "catalog skills",
      resolveIndexUrl(parsed) {
        return parsed.pathname.endsWith(".json")
          ? parsed.toString()
          : new URL(
              "index.json",
              parsed.toString().endsWith("/")
                ? parsed.toString()
                : `${parsed.toString()}/`,
            ).toString();
      },
      requireDescription: true,
      missingManifestMessage: (name) => `Catalog skill '${name}' is missing SKILL.md`,
      hasRequiredManifest(filePath) {
        return filePath.toLowerCase() === "skill.md";
      },
      buildRemoteResult({ entry, files, sourceUrl }) {
        return {
          name: entry.name,
          description: entry.description || "",
          installName: entry.name,
          sourceUrl,
          sourceType: "catalog",
          files,
        };
      },
    });
  }

  async fetchAllPlugins(
    url: string,
    options: WellKnownFetchOptions = {},
  ): Promise<RemotePlugin[]> {
    return this.fetchAllResources(url, options, {
      kind: "plugins",
      indexLabel: "catalog plugins",
      resolveIndexUrl(parsed) {
        return parsed.pathname.endsWith(".json")
          ? parsed.toString()
          : new URL(
              "plugins/index.json",
              parsed.toString().endsWith("/")
                ? parsed.toString()
                : `${parsed.toString()}/`,
            ).toString();
      },
      requireDescription: false,
      missingManifestMessage: (name) =>
        `Catalog plugin '${name}' is missing plugin.json`,
      hasRequiredManifest(filePath) {
        return filePath.split("/").at(-1)?.toLowerCase() === "plugin.json";
      },
      buildRemoteResult({ entry, files, sourceUrl }) {
        return {
          name: entry.name,
          description: entry.description || "",
          installName: entry.name,
          sourceUrl,
          sourceType: "catalog",
          files,
        };
      },
    });
  }

  private async fetchAllResources<TResult>(
    url: string,
    options: WellKnownFetchOptions,
    config: ResourceConfig<TResult>,
  ): Promise<TResult[]> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("Catalog provider requires HTTPS URLs");
    }

    const maxDownloadBytes =
      options.maxDownloadBytes ?? DEFAULT_OPTIONS.maxDownloadBytes;
    const timeoutMs = options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
    const maxFilesPerSkill =
      options.maxFilesPerSkill ?? DEFAULT_OPTIONS.maxFilesPerSkill;
    const maxSkillFileBytes =
      options.maxSkillFileBytes ?? DEFAULT_OPTIONS.maxSkillFileBytes;

    const indexUrl = config.resolveIndexUrl(parsed);
    const indexText = await this.fetchTextWithLimit(
      indexUrl,
      Math.min(maxDownloadBytes, maxSkillFileBytes),
      timeoutMs,
    );
    const index = this.validateIndex(
      JSON.parse(indexText) as unknown,
      maxFilesPerSkill,
      config,
    );

    const out: TResult[] = [];
    let remaining = maxDownloadBytes - indexText.length;
    const indexBase = indexUrl.slice(0, indexUrl.lastIndexOf("/") + 1);
    for (const row of index) {
      const files = new Map<string, string>();
      for (const rel of row.files) {
        this.assertSafeRelativePath(rel);
        const fileUrl = new URL(`${row.name}/${rel}`, indexBase).toString();
        if (remaining <= 0) {
          throw new Error("Catalog download budget exhausted");
        }
        const text = await this.fetchTextWithLimit(
          fileUrl,
          Math.min(remaining, maxSkillFileBytes),
          timeoutMs,
        );
        remaining -= text.length;
        files.set(rel, text);
      }
      out.push(
        config.buildRemoteResult({
          entry: row,
          files,
          sourceUrl: new URL(
            `${row.name}/${this.pickPrimaryManifestPath(row.files, config)}`,
            indexBase,
          ).toString(),
        }),
      );
    }
    return out;
  }

  private async fetchTextWithLimit(
    url: string,
    maxBytes: number,
    timeoutMs: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(
          `Catalog fetch failed (${response.status} ${response.statusText}) for ${url}`
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new Error(`Catalog file exceeds size limit for ${url}`);
      }
      return new TextDecoder("utf8").decode(bytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateIndex(
    raw: unknown,
    maxFilesPerSkill: number,
    config: ResourceConfig<unknown>,
  ): CatalogIndexEntry[] {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid catalog index: expected object");
    }
    const data = raw as Record<string, unknown>;
    const rows = data[config.kind];
    if (!Array.isArray(rows)) {
      throw new Error(`Invalid catalog index: '${config.kind}' must be an array`);
    }
    return rows.map((item, idx) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid catalog index entry[${idx}]`);
      }
      const row = item as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const description =
        typeof row.description === "string" ? row.description.trim() : undefined;
      const files = Array.isArray(row.files)
        ? row.files.map((x) => String(x))
        : [];
      if (!name || files.length === 0) {
        throw new Error(
          `Invalid catalog index entry[${idx}]: missing required fields`,
        );
      }
      if (config.requireDescription && !description) {
        throw new Error(
          `Invalid catalog index entry[${idx}]: missing required fields`,
        );
      }
      if (files.length > maxFilesPerSkill) {
        throw new Error(
          `Too many files in catalog ${config.kind.slice(0, -1)} '${name}'`,
        );
      }
      if (!files.some((filePath) => config.hasRequiredManifest(filePath))) {
        throw new Error(config.missingManifestMessage(name));
      }
      for (const file of files) {
        this.assertSafeRelativePath(file);
      }
      return { name, description, files };
    });
  }

  private pickPrimaryManifestPath(
    filePaths: string[],
    config: ResourceConfig<unknown>,
  ): string {
    const manifests = filePaths
      .filter((filePath) => config.hasRequiredManifest(filePath))
      .sort((left, right) => {
        const leftDepth = left.split("/").length;
        const rightDepth = right.split("/").length;
        if (leftDepth !== rightDepth) {
          return leftDepth - rightDepth;
        }
        return left.localeCompare(right);
      });

    const manifestPath = manifests[0];
    if (!manifestPath) {
      throw new Error("Catalog entry is missing required manifest");
    }
    return manifestPath;
  }

  private assertSafeRelativePath(filePath: string): void {
    if (
      !filePath ||
      filePath.startsWith("/") ||
      filePath.startsWith("\\") ||
      filePath.includes("..") ||
      filePath.includes("\\")
    ) {
      throw new Error(`Unsafe catalog file path: ${filePath}`);
    }
  }
}

export const catalogProvider = new HttpCatalogProvider();
