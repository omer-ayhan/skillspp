import dns from "node:dns/promises";
import net from "node:net";
import type {
  ProviderMatch,
  RemoteSkill,
  WellKnownFetchOptions,
  WellKnownProvider,
} from "./types";

type WellKnownIndexEntry = {
  name: string;
  description: string;
  files: string[];
};

type WellKnownIndex = {
  skills: WellKnownIndexEntry[];
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
    const path = parsed.pathname.replace(/\/$/, "");
    return path && path !== "/"
      ? `wellknown/${parsed.hostname}${path}`
      : `wellknown/${parsed.hostname}`;
  }

  async fetchAllSkills(
    url: string,
    options: WellKnownFetchOptions = {}
  ): Promise<RemoteSkill[]> {
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
      budget
    );
    const skills: RemoteSkill[] = [];

    for (const entry of index.skills) {
      const skill = await this.fetchSkillByEntry(
        resolvedBase,
        entry,
        normalized,
        budget
      );
      if (skill) {
        skills.push(skill);
      }
    }

    return skills;
  }

  private normalizeOptions(options: WellKnownFetchOptions): NormalizedOptions {
    return {
      allowHosts: (options.allowHosts || [])
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
      denyHosts: (options.denyHosts || [])
        .map((x) => x.trim().toLowerCase())
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
    budget: DownloadBudget
  ): Promise<{ index: WellKnownIndex; resolvedBase: string }> {
    const candidates = this.buildBaseCandidates(parsedUrl);

    for (const base of candidates) {
      const indexUrl = `${base}/.well-known/skills/index.json`;
      try {
        const jsonText = await this.fetchTextWithLimit(
          indexUrl,
          options.maxDownloadBytes,
          options,
          budget
        );
        const parsed = JSON.parse(jsonText) as unknown;
        const validated = this.validateIndex(parsed, options.maxFilesPerSkill);
        return { index: validated, resolvedBase: base };
      } catch {
        continue;
      }
    }

    throw new Error(
      "No valid well-known skills index found at /.well-known/skills/index.json"
    );
  }

  private buildBaseCandidates(parsed: URL): string[] {
    const origin = parsed.origin;
    const pathname = parsed.pathname.replace(/\/$/, "");
    const marker = "/.well-known/skills";

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
      ...new Set(out.map((x) => (x.endsWith("/") ? x.slice(0, -1) : x))),
    ].filter(Boolean);
  }

  private validateIndex(
    raw: unknown,
    maxFilesPerSkill: number
  ): WellKnownIndex {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid well-known index: expected object");
    }

    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.skills)) {
      throw new Error("Invalid well-known index: 'skills' must be an array");
    }

    const skills: WellKnownIndexEntry[] = data.skills.map((item, idx) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid well-known index entry[${idx}]`);
      }
      const row = item as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const description = String(row.description || "").trim();
      const files = Array.isArray(row.files)
        ? row.files.map((x) => String(x))
        : [];

      if (!name || !description || files.length === 0) {
        throw new Error(
          `Invalid well-known index entry[${idx}]: missing required fields`
        );
      }
      if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
        throw new Error(`Invalid well-known skill name: ${name}`);
      }
      if (files.length > maxFilesPerSkill) {
        throw new Error(`Too many files in well-known skill '${name}'`);
      }
      if (!files.some((f) => f.toLowerCase() === "skill.md")) {
        throw new Error(`Well-known skill '${name}' is missing SKILL.md`);
      }

      for (const file of files) {
        this.assertSafeRelativePath(file);
      }

      return { name, description, files };
    });

    return { skills };
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

  private async fetchSkillByEntry(
    resolvedBase: string,
    entry: WellKnownIndexEntry,
    options: NormalizedOptions,
    budget: DownloadBudget
  ): Promise<RemoteSkill | null> {
    const baseUrl = `${resolvedBase}/.well-known/skills/${entry.name}`;
    const files = new Map<string, string>();

    for (const filePath of entry.files) {
      this.assertSafeRelativePath(filePath);
      const fileUrl = `${baseUrl}/${filePath}`;
      const text = await this.fetchTextWithLimit(
        fileUrl,
        options.maxSkillFileBytes,
        options,
        budget
      );
      if (text.includes("\u0000")) {
        throw new Error(
          `Binary content is not allowed in well-known file: ${filePath}`
        );
      }
      files.set(filePath, text);
    }

    const skillContent = files.get("SKILL.md") || files.get("skill.md");
    if (!skillContent) {
      return null;
    }

    return {
      name: entry.name,
      description: entry.description,
      installName: entry.name,
      sourceUrl: `${baseUrl}/SKILL.md`,
      sourceType: "well-known",
      files,
    };
  }

  private async fetchTextWithLimit(
    url: string,
    maxPerRequestBytes: number,
    options: NormalizedOptions,
    budget: DownloadBudget
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
          `Fetch failed (${response.status} ${response.statusText}) for ${currentUrl}`
        );
      }

      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const declared = Number(contentLengthHeader);
        if (Number.isFinite(declared) && declared > maxPerRequestBytes) {
          throw new Error(
            `Response exceeds per-file size limit for ${currentUrl}`
          );
        }
        if (Number.isFinite(declared) && declared > budget.remaining) {
          throw new Error(
            `Response exceeds remaining download budget for ${currentUrl}`
          );
        }
      }

      const reader = response.body?.getReader();
      if (!reader) {
        return "";
      }

      let received = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }

        const chunk = result.value;
        received += chunk.byteLength;

        if (received > maxPerRequestBytes) {
          throw new Error(
            `Response exceeded per-file size limit for ${currentUrl}`
          );
        }
        if (received > budget.remaining) {
          throw new Error(
            `Response exceeded remaining download budget for ${currentUrl}`
          );
        }

        chunks.push(chunk);
      }

      budget.remaining -= received;
      const total = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        total.set(chunk, offset);
        offset += chunk.byteLength;
      }

      return new TextDecoder("utf-8", { fatal: false }).decode(total);
    }
  }

  private async assertHostAllowed(
    hostname: string,
    options: NormalizedOptions
  ): Promise<void> {
    const host = hostname.toLowerCase();

    if (options.denyHosts.includes(host)) {
      throw new Error(`Well-known host denied by policy: ${hostname}`);
    }

    if (options.allowHosts.length > 0 && !options.allowHosts.includes(host)) {
      throw new Error(`Well-known host is not in allowlist: ${hostname}`);
    }

    if (this.isLocalHostname(host)) {
      throw new Error(`Well-known host is not allowed: ${hostname}`);
    }

    const records = await this.resolveHostIps(host);
    for (const ip of records) {
      if (this.isPrivateOrLocalIp(ip)) {
        throw new Error(
          `Well-known host resolves to private/local address: ${hostname}`
        );
      }
    }
  }

  private isLocalHostname(host: string): boolean {
    return (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "0.0.0.0"
    );
  }

  private async resolveHostIps(hostname: string): Promise<string[]> {
    const out = new Set<string>();
    try {
      const records = await dns.lookup(hostname, { all: true });
      for (const record of records) {
        out.add(record.address);
      }
    } catch {
      // keep empty; resolution failures will fail during fetch anyway
    }
    return [...out];
  }

  private isPrivateOrLocalIp(ip: string): boolean {
    if (!net.isIP(ip)) {
      return false;
    }

    if (net.isIPv4(ip)) {
      const parts = ip.split(".").map((x) => Number(x));
      const [a, b] = parts;
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a >= 224) return true;
      return false;
    }

    const value = ip.toLowerCase();
    return (
      value === "::1" ||
      value === "::" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:")
    );
  }
}

export const wellKnownProvider = new SecureWellKnownProvider();
