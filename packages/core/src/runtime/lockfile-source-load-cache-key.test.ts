import { describe, expect, it } from "vitest";
import { buildSourceLoadCacheKey, type LockEntry } from "./lockfile";

function makeEntry(sourceOverrides: Partial<LockEntry["source"]> = {}): LockEntry {
  const selector = {
    skillName: "alpha",
    relativePath: "alpha",
    ...sourceOverrides.selector,
  };
  const source: LockEntry["source"] = {
    input: "https://example.com/skills.json",
    type: "well-known",
    canonical: "https://example.com/skills.json",
    pinnedRef: "pin-a",
    ...sourceOverrides,
    selector,
  };

  return {
    skillName: "alpha",
    global: false,
    installMode: "copy",
    agents: ["codex"],
    canonicalDir: "/tmp/alpha",
    source,
    sourceHash: "source-hash",
    installedHash: "installed-hash",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("source load cache key @unit", () => {
  it("dedupes same source across selector changes @unit", () => {
    const keyA = buildSourceLoadCacheKey(
      makeEntry({
        selector: { skillName: "alpha", relativePath: "skills/alpha" },
      }).source,
    );
    const keyB = buildSourceLoadCacheKey(
      makeEntry({
        selector: { skillName: "beta", relativePath: "skills/beta" },
      }).source,
    );

    expect(keyA).toBe(keyB);
  });

  it("dedupes same remote source across pinned ref changes @unit", () => {
    const keyA = buildSourceLoadCacheKey(makeEntry({ pinnedRef: "old-pin" }).source);
    const keyB = buildSourceLoadCacheKey(makeEntry({ pinnedRef: "new-pin" }).source);

    expect(keyA).toBe(keyB);
  });

  it("keys local sources by canonical resolved path @unit", () => {
    const keyA = buildSourceLoadCacheKey(
      makeEntry({
        type: "local",
        input: "./skills/local-alpha",
        canonical: "/tmp/local-source-alpha",
      }).source,
    );
    const keyB = buildSourceLoadCacheKey(
      makeEntry({
        type: "local",
        input: "../other/local-source",
        canonical: "/tmp/local-source-alpha",
      }).source,
    );

    expect(keyA).toBe(keyB);
  });

  it("produces different keys for different source identities @unit", () => {
    const keys = [
      buildSourceLoadCacheKey(
        makeEntry({
          type: "well-known",
          input: "https://example.com/well-known-a.json",
        }).source,
      ),
      buildSourceLoadCacheKey(
        makeEntry({
          type: "catalog",
          input: "catalog+https://example.com/catalog-a.json",
        }).source,
      ),
      buildSourceLoadCacheKey(
        makeEntry({
          type: "git",
          input: "https://gitlab.com/acme/repo-a.git",
        }).source,
      ),
      buildSourceLoadCacheKey(
        makeEntry({
          type: "local",
          input: "./skills/local-a",
          canonical: "/tmp/local-a",
        }).source,
      ),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys github sources by repo, ref, and subpath @unit", () => {
    const mainRef = buildSourceLoadCacheKey(
      makeEntry({
        type: "github",
        input: "https://github.com/acme/skills/tree/main/skills/alpha",
      }).source,
    );
    const devRef = buildSourceLoadCacheKey(
      makeEntry({
        type: "github",
        input: "https://github.com/acme/skills/tree/dev/skills/alpha",
      }).source,
    );
    const mainOtherPath = buildSourceLoadCacheKey(
      makeEntry({
        type: "github",
        input: "https://github.com/acme/skills/tree/main/skills/beta",
      }).source,
    );

    expect(mainRef).not.toBe(devRef);
    expect(mainRef).not.toBe(mainOtherPath);
  });
});
