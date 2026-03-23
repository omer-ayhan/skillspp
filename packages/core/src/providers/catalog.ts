import type {
  ProviderMatch,
  RemoteSkill,
  RemoteSkillsProvider,
  WellKnownFetchOptions,
} from "./types";

type CatalogIndexEntry = {
  name: string;
  description: string;
  files: string[];
};

type CatalogIndex = {
  skills: CatalogIndexEntry[];
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
    options: WellKnownFetchOptions = {}
  ): Promise<RemoteSkill[]> {
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

    const indexUrl = parsed.pathname.endsWith(".json")
      ? parsed.toString()
      : new URL(
          "index.json",
          parsed.toString().endsWith("/")
            ? parsed.toString()
            : `${parsed.toString()}/`
        ).toString();
    const indexText = await this.fetchTextWithLimit(
      indexUrl,
      Math.min(maxDownloadBytes, maxSkillFileBytes),
      timeoutMs
    );
    const index = this.validateIndex(
      JSON.parse(indexText) as unknown,
      maxFilesPerSkill
    );

    const out: RemoteSkill[] = [];
    let remaining = maxDownloadBytes - indexText.length;
    const indexBase = indexUrl.slice(0, indexUrl.lastIndexOf("/") + 1);
    for (const row of index.skills) {
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
          timeoutMs
        );
        remaining -= text.length;
        files.set(rel, text);
      }
      out.push({
        name: row.name,
        description: row.description,
        installName: row.name,
        sourceUrl: new URL(`${row.name}/SKILL.md`, indexBase).toString(),
        sourceType: "catalog",
        files,
      });
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

  private validateIndex(raw: unknown, maxFilesPerSkill: number): CatalogIndex {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid catalog index: expected object");
    }
    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.skills)) {
      throw new Error("Invalid catalog index: 'skills' must be an array");
    }
    const skills: CatalogIndexEntry[] = data.skills.map((item, idx) => {
      if (!item || typeof item !== "object") {
        throw new Error(`Invalid catalog index entry[${idx}]`);
      }
      const row = item as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const description = String(row.description || "").trim();
      const files = Array.isArray(row.files)
        ? row.files.map((x) => String(x))
        : [];
      if (!name || !description || files.length === 0) {
        throw new Error(
          `Invalid catalog index entry[${idx}]: missing required fields`
        );
      }
      if (files.length > maxFilesPerSkill) {
        throw new Error(`Too many files in catalog skill '${name}'`);
      }
      if (!files.some((f) => f.toLowerCase() === "skill.md")) {
        throw new Error(`Catalog skill '${name}' is missing SKILL.md`);
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
      throw new Error(`Unsafe catalog file path: ${filePath}`);
    }
  }
}

export const catalogProvider = new HttpCatalogProvider();
