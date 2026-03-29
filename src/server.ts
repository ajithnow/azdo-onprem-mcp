#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAzureDevOpsClient } from "./client.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const client = createAzureDevOpsClient();
  const server = new McpServer({
    name: "azure-devops-server",
    version: "1.0.0",
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  console.error(msg);
  process.exit(1);
});
