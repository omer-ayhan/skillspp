import { describe, expect, it, vi } from "vitest";

const validateExecute = vi.fn(async () => ({ diagnostics: [] }));

vi.mock("@skillspp/platform-node", () => ({
  createNodeCoreServices: () => ({
    validateSkill: {
      execute: validateExecute,
    },
  }),
}));

const { handleRequest } = await import("./request-handler");

describe("skillspp-mcp request contracts @contract", () => {
  it("returns tools list for tools/list @contract", async () => {
    const response = await handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(response.error).toBeUndefined();
    expect((response.result as { tools: Array<{ name: string }> }).tools[0]?.name).toBe(
      "skills.validate",
    );
  });

  it("returns method error for unknown tool call @contract", async () => {
    const response = await handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "skills.unknown",
      },
    });

    expect(response.error?.code).toBe(-32601);
  });

  it("calls validate service and forces json output @contract @critical", async () => {
    const response = await handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "skills.validate",
        arguments: {
          source: "/tmp/source",
        },
      },
    });

    expect(validateExecute).toHaveBeenCalledWith({ source: "/tmp/source", json: true });
    expect(response.error).toBeUndefined();
    expect(Array.isArray((response.result as { diagnostics: unknown[] }).diagnostics)).toBe(true);
  });

  it("returns method error for unknown rpc method @contract", async () => {
    const response = await handleRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list" as "tools/list" | "tools/call",
      // force unknown branch at runtime
    } as {
      jsonrpc: "2.0";
      id: number;
      method: "tools/list" | "tools/call";
      params?: Record<string, unknown>;
    });

    const forcedResponse = await handleRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "unknown" as "tools/list" | "tools/call",
    } as {
      jsonrpc: "2.0";
      id: number;
      method: "tools/list" | "tools/call";
      params?: Record<string, unknown>;
    });

    expect(response.error).toBeUndefined();
    expect(forcedResponse.error?.code).toBe(-32601);
  });
});
