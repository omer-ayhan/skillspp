import { createNodeCoreServices } from "@skillspp/platform-node";
import type { ValidateSkillCommand } from "@skillspp/core/commands";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: "tools/list" | "tools/call";
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

export const tools = [
  {
    name: "skills.validate",
    description: "Validate skill source structure and references",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        ci: { type: "boolean" },
        strict: { type: "boolean" },
        roots: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
];

export async function handleRequest(
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  if (request.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: { tools },
    };
  }

  if (request.method === "tools/call") {
    const name = String(request.params?.name || "");
    const args = (request.params?.arguments || {}) as ValidateSkillCommand;

    if (name !== "skills.validate") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
    }

    const services = createNodeCoreServices();
    const report = await services.validateSkill.execute({
      ...args,
      json: true,
    });

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: report,
    };
  }

  return {
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: `Unknown method: ${request.method}` },
  };
}
