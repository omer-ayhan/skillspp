import { pathToFileURL } from "node:url";
import {
  handleRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./request-handler";

export async function runSelfTest(): Promise<void> {
  const list = await handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });
  process.stdout.write(`${JSON.stringify(list)}\n`);
}

export async function runStdioServer(): Promise<void> {
  process.stdin.setEncoding("utf8");

  let buffer = "";
  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        };
        process.stdout.write(`${JSON.stringify(response)}\n`);
        continue;
      }

      try {
        const response = await handleRequest(request);
        process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        };
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  });
}

const isEntrypoint =
  typeof process.argv[1] === "string" &&
  process.argv[1].length > 0 &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  if (process.argv.includes("--self-test")) {
    runSelfTest().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exit(1);
    });
  } else {
    runStdioServer().catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exit(1);
    });
  }
}
