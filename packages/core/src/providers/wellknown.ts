import dns from "node:dns/promises";
import net from "node:net";
import type {
  ProviderMatch,
  RemotePlugin,
  RemoteSkill,
  WellKnownFetchOptions,
  WellKnownProvider,
} from "./types";

type WellKnownIndexEntry = {
  name: string;
  description?: string;
  files: string[];
};

type DownloadBudget = {
  remaining: number;
};

type NormalizedOptions = Required<
  Omit<WellKnownFetchOptions, "allowHosts" | "denyHosts">
> & {
  allowHosts: string[];
  denyHosts: string[];
};

type ResourceKind = "skills" | "plugins";

type ResourceConfig<TResult> = {
  kind: ResourceKind;
  displayLabel: string;
  indexPath: string;
  entryLabel: string;
  requireDescription: boolean;
  missingManifestMessage: (name: string) => string;
  validateName?: (name: string) => void;
  hasRequiredManifest: (filePath: string) => boolean;
  buildRemoteResult: (options: {
    entry: WellKnownIndexEntry;
    files: Map<string, string>;
    sourceUrl: string;
  }) => TResult;
};

const DEFAULT_OPTIONS: Omit<NormalizedOptions, "allowHosts" | "denyHosts"> = {
  maxDownloadBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
  maxFilesPerSkill: 128,
  maxSkillFileBytes: 512 * 1024,
};

const EXCLUDED_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "raw.githubusercontent.com",
]);

const SKILL_CONFIG: ResourceConfig<RemoteSkill> = {
  kind: "skills",
  displayLabel: "well-known skills",
  indexPath: "/.well-known/skills/index.json",
  entryLabel: "skill",
  requireDescription: true,
  missingManifestMessage: (name) => `Well-known skill '${name}' is missing SKILL.md`,
  validateName(name) {
    if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
      throw new Error(`Invalid well-known skill name: ${name}`);
    }
  },
  hasRequiredManifest(filePath) {
    return filePath.toLowerCase() === "skill.md";
  },
  buildRemoteResult({ entry, files, sourceUrl }) {
    return {
      name: entry.name,
      description: entry.description || "",
      installName: entry.name,
      sourceUrl,
      sourceType: "well-known",
      files,
    };
  },
};

const PLUGIN_CONFIG: ResourceConfig<RemotePlugin> = {
  kind: "plugins",
  displayLabel: "well-known plugins",
  indexPath: "/.well-known/plugins/index.json",
  entryLabel: "plugin",
  requireDescription: false,
  missingManifestMessage: (name) =>
    `Well-known plugin '${name}' is missing plugin.json`,
  hasRequiredManifest(filePath) {
    return filePath.split("/").at(-1)?.toLowerCase() === "plugin.json";
  },
  buildRemoteResult({ entry, files, sourceUrl }) {
    return {
      name: entry.name,
      description: entry.description || "",
      installName: entry.name,
      sourceUrl,
      sourceType: "well-known",
      files,
    };
  },
};

export class SecureWellKnownProvider implements WellKnownProvider {
  readonly id = "well-known";
  readonly displayName = "Secure Well-Known Skills";

  match(url: string): ProviderMatch {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { matches: false };
    }

    try {
      const parsed = new URL(url);
      if (EXCLUDED_HOSTS.has(parsed.hostname.toLowerCase())) {
        return { matches: false };
      }
      return { matches: true, sourceIdentifier: this.getSourceIdentifier(url) };
    } catch {
      return { matches: false };
    }
  }

  getSourceIdentifier(url: string): string {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/$/, "");
    return pathname && pathname !== "/"
      ? `wellknown/${parsed.hostname}${pathname}`
      : `wellknown/${parsed.hostname}`;
  }

  async fetchAllSkills(
    url: string,
    options: WellKnownFetchOptions = {},
  ): Promise<RemoteSkill[]> {
    return this.fetchAllResources(url, options, SKILL_CONFIG);
  }

  async fetchAllPlugins(
    url: string,
    options: WellKnownFetchOptions = {},
  ): Promise<RemotePlugin[]> {
    return this.fetchAllResources(url, options, PLUGIN_CONFIG);
  }

  private async fetchAllResources<TResult>(
    url: string,
    options: WellKnownFetchOptions,
    config: ResourceConfig<TResult>,
  ): Promise<TResult[]> {
    const normalized = this.normalizeOptions(options);
    const budget: DownloadBudget = { remaining: normalized.maxDownloadBytes };
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("Well-known provider requires HTTPS URLs");
    }

    await this.assertHostAllowed(parsed.hostname, normalized);

    const { index, resolvedBase } = await this.fetchIndex(
      parsed,
      normalized,
      budget,
      config,
    );

    const resources: TResult[] = [];
    for (const entry of index) {
      resources.push(
        await this.fetchResourceByEntry(resolvedBase, entry, normalized, budget, config),
      );
    }

    return resources;
  }

  private normalizeOptions(options: WellKnownFetchOptions): NormalizedOptions {
    return {
      allowHosts: (options.allowHosts || [])
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      denyHosts: (options.denyHosts || [])
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      maxDownloadBytes:
        options.maxDownloadBytes ?? DEFAULT_OPTIONS.maxDownloadBytes,
      timeoutMs: options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
      maxRedirects: options.maxRedirects ?? DEFAULT_OPTIONS.maxRedirects,
      maxFilesPerSkill:
        options.maxFilesPerSkill ?? DEFAULT_OPTIONS.maxFilesPerSkill,
      maxSkillFileBytes:
        options.maxSkillFileBytes ?? DEFAULT_OPTIONS.maxSkillFileBytes,
    };
  }

  private async fetchIndex(
    parsedUrl: URL,
    options: NormalizedOptions,
    budget: DownloadBudget,
    config: ResourceConfig<unknown>,
  ): Promise<{ index: WellKnownIndexEntry[]; resolvedBase: string }> {
    const candidates = this.buildBaseCandidates(parsedUrl, config.indexPath);

    for (const base of candidates) {
      const indexUrl = `${base}${config.indexPath}`;
      try {
        const jsonText = await this.fetchTextWithLimit(
          indexUrl,
          options.maxDownloadBytes,
          options,
          budget,
        );
        const parsed = JSON.parse(jsonText) as unknown;
        const validated = this.validateIndex(
          parsed,
          options.maxFilesPerSkill,
          config,
        );
        return { index: validated, resolvedBase: base };
      } catch {
        continue;
      }
    }

    throw new Error(
      `No valid ${config.displayLabel} index found at ${config.indexPath}`,
    );
  }

  private buildBaseCandidates(parsed: URL, indexPath: string): string[] {
    const origin = parsed.origin;
    const pathname = parsed.pathname.replace(/\/$/, "");
    const marker = indexPath.replace(/\/index\.json$/, "");

    const out: string[] = [];

    if (pathname.includes(marker)) {
      const prefix = pathname.slice(0, pathname.indexOf(marker));
      out.push(`${origin}${prefix}`.replace(/\/$/, ""));
      if (prefix !== "") {
        out.push(origin);
      }
    } else {
      out.push(`${origin}${pathname}`.replace(/\/$/, ""));
      if (pathname !== "") {
        out.push(origin);
      }
    }

    return [
      ...new Set(out.map((value) => (value.endsWith("/") ? value.slice(0, -1) : value))),
    ].filter(Boolean);
  }

  private validateIndex(
    raw: unknown,
    maxFilesPerSkill: number,
    config: ResourceConfig<unknown>,
  ): WellKnownIndexEntry[] {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid well-known index: expected object");
    }

    const data = raw as Record<string, unknown>;
    const rows = data[config.kind];
    if (!Array.isArray(rows)) {
      throw new Error(
        `Invalid well-known index: '${config.kind}' must be an array`,
      );
    }

    return rows.map((item, idx) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid well-known index entry[${idx}]`);
      }
      const row = item as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const description =
        typeof row.description === "string" ? row.description.trim() : undefined;
      const files = Array.isArray(row.files)
        ? row.files.map((value) => String(value))
        : [];

      if (!name || files.length === 0) {
        throw new Error(
          `Invalid well-known index entry[${idx}]: missing required fields`,
        );
      }
      if (config.requireDescription && !description) {
        throw new Error(
          `Invalid well-known index entry[${idx}]: missing required fields`,
        );
      }
      config.validateName?.(name);
      if (files.length > maxFilesPerSkill) {
        throw new Error(`Too many files in well-known ${config.entryLabel} '${name}'`);
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

  private assertSafeRelativePath(filePath: string): void {
    if (
      !filePath ||
      filePath.startsWith("/") ||
      filePath.startsWith("\\") ||
      filePath.includes("..") ||
      filePath.includes("\\")
    ) {
      throw new Error(`Unsafe well-known file path: ${filePath}`);
    }
  }

  private async fetchResourceByEntry<TResult>(
    resolvedBase: string,
    entry: WellKnownIndexEntry,
    options: NormalizedOptions,
    budget: DownloadBudget,
    config: ResourceConfig<TResult>,
  ): Promise<TResult> {
    const baseUrl = `${resolvedBase}/.well-known/${config.kind}/${entry.name}`;
    const files = new Map<string, string>();

    for (const filePath of entry.files) {
      this.assertSafeRelativePath(filePath);
      const fileUrl = `${baseUrl}/${filePath}`;
      const text = await this.fetchTextWithLimit(
        fileUrl,
        options.maxSkillFileBytes,
        options,
        budget,
      );
      if (text.includes("\u0000")) {
        throw new Error(
          `Binary content is not allowed in well-known file: ${filePath}`,
        );
      }
      files.set(filePath, text);
    }

    const manifestPath = this.pickPrimaryManifestPath(entry.files, config);
    return config.buildRemoteResult({
      entry,
      files,
      sourceUrl: `${baseUrl}/${manifestPath}`,
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
      throw new Error("Missing required manifest in well-known index entry");
    }
    return manifestPath;
  }

  private async fetchTextWithLimit(
    url: string,
    maxPerRequestBytes: number,
    options: NormalizedOptions,
    budget: DownloadBudget,
  ): Promise<string> {
    let currentUrl = url;
    let redirects = 0;

    while (true) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== "https:") {
        throw new Error("Well-known provider only allows HTTPS fetches");
      }
      await this.assertHostAllowed(parsed.hostname, options);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect without location for ${currentUrl}`);
        }
        redirects += 1;
        if (redirects > options.maxRedirects) {
          throw new Error(`Too many redirects for ${url}`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${currentUrl}: ${response.status} ${response.statusText}`,
        );
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxPerRequestBytes) {
        throw new Error(`Exceeded per-file download limit for ${currentUrl}`);
      }
      budget.remaining -= bytes.byteLength;
      if (budget.remaining < 0) {
        throw new Error(`Exceeded total download budget while fetching ${url}`);
      }

      return new TextDecoder("utf8").decode(bytes);
    }
  }

  private async assertHostAllowed(
    hostname: string,
    options: NormalizedOptions,
  ): Promise<void> {
    const lowerHost = hostname.toLowerCase();

    if (options.denyHosts.includes(lowerHost)) {
      throw new Error(`Host '${hostname}' is explicitly denied`);
    }
    if (
      options.allowHosts.length > 0 &&
      !options.allowHosts.includes(lowerHost)
    ) {
      throw new Error(`Host '${hostname}' is not in allowed host list`);
    }
    if (isLocalHostname(lowerHost)) {
      throw new Error(`Local or loopback host '${hostname}' is not allowed`);
    }

    const ips = await resolveHostIps(hostname);
    if (ips.some((ip) => isPrivateOrLocalIp(ip))) {
      throw new Error(`Host '${hostname}' resolves to a private/local address`);
    }
  }
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

async function resolveHostIps(hostname: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const entries = await dns.lookup(hostname, { all: true });
    for (const entry of entries) {
      out.add(entry.address);
    }
  } catch {
    // Ignore DNS lookup errors here and let fetch surface its own error.
  }
  return [...out];
}

function isPrivateOrLocalIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    return (
      ip.startsWith("10.") ||
      ip.startsWith("127.") ||
      ip.startsWith("169.254.") ||
      ip.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    );
  }
  if (family === 6) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return false;
}

export const wellKnownProvider = new SecureWellKnownProvider();
