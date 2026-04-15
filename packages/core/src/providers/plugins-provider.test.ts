import dns from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpCatalogProvider } from "./catalog";
import { SecureWellKnownProvider } from "./wellknown";

describe("plugin providers @unit", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("resolves well-known plugin indexes from /.well-known/plugins/index.json @unit", async () => {
    const provider = new SecureWellKnownProvider();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://example.com/repo/.well-known/plugins/index.json") {
        return new Response("not-found", { status: 404 });
      }
      if (url === "https://example.com/.well-known/plugins/index.json") {
        return new Response(
          JSON.stringify({
            plugins: [
              {
                name: "plugin-alpha",
                files: ["codex/plugin.json", "README.md"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "https://example.com/.well-known/plugins/plugin-alpha/codex/plugin.json") {
        return new Response(
          JSON.stringify({
            name: "plugin-alpha",
            description: "plugin alpha",
          }),
          { status: 200 },
        );
      }
      if (url === "https://example.com/.well-known/plugins/plugin-alpha/README.md") {
        return new Response("docs", { status: 200 });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const plugins = await provider.fetchAllPlugins("https://example.com/repo");

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      installName: "plugin-alpha",
      description: "",
      sourceUrl: "https://example.com/.well-known/plugins/plugin-alpha/codex/plugin.json",
    });
    expect(plugins[0]?.files.get("codex/plugin.json")).toContain("plugin-alpha");
  });

  it("rejects well-known plugin indexes that only expose skill manifests @unit", async () => {
    const provider = new SecureWellKnownProvider();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://example.com/.well-known/plugins/index.json") {
        return new Response(
          JSON.stringify({
            plugins: [
              {
                name: "plugin-alpha",
                files: ["SKILL.md"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    await expect(provider.fetchAllPlugins("https://example.com")).rejects.toThrow(
      "No valid well-known plugins index found at /.well-known/plugins/index.json",
    );
  });

  it("uses catalog plugin indexes from /plugins/index.json unless an explicit json URL is provided @unit", async () => {
    const provider = new HttpCatalogProvider();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://catalog.example.com/base/plugins/index.json") {
        return new Response(
          JSON.stringify({
            plugins: [
              {
                name: "plugin-alpha",
                description: "alpha plugin",
                files: ["agents/codex/plugin.json"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (
        url === "https://catalog.example.com/base/plugins/plugin-alpha/agents/codex/plugin.json"
      ) {
        return new Response(
          JSON.stringify({
            name: "plugin-alpha",
            description: "alpha plugin",
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const plugins = await provider.fetchAllPlugins("https://catalog.example.com/base");

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.sourceUrl).toBe(
      "https://catalog.example.com/base/plugins/plugin-alpha/agents/codex/plugin.json",
    );
  });

  it("rejects catalog plugin indexes without plugin.json entries @unit", async () => {
    const provider = new HttpCatalogProvider();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://catalog.example.com/base/plugins/index.json") {
        return new Response(
          JSON.stringify({
            plugins: [
              {
                name: "plugin-alpha",
                description: "alpha plugin",
                files: ["README.md"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    await expect(provider.fetchAllPlugins("https://catalog.example.com/base")).rejects.toThrow(
      "Catalog plugin 'plugin-alpha' is missing plugin.json",
    );
  });
});
