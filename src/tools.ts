import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AxiosInstance } from "axios";
import { z } from "zod";
import { listProjects } from "./projects.js";
import type { AzureWorkItem } from "./workItems.js";
import { getWorkItem, searchWorkItems } from "./workItems.js";

function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/**
 * Full work item for MCP: `structuredContent` is the complete REST object.
 * Preamble reminds clients that data lives under `fields`, `relations`, etc. — not just id/title/state.
 */
function workItemResult(item: AzureWorkItem) {
  const full = JSON.parse(JSON.stringify(item)) as AzureWorkItem;
  const fields = full.fields;
  const fieldCount =
    fields && typeof fields === "object" && !Array.isArray(fields)
      ? Object.keys(fields as Record<string, unknown>).length
      : 0;
  const relCount = Array.isArray(full.relations) ? full.relations.length : 0;
  const topKeys = Object.keys(full).join(", ");
  const preamble =
    "This is the full Azure DevOps GET work item response ($expand=all). " +
    `Top-level keys: [${topKeys}]. ` +
    `The "fields" object has ${fieldCount} entries (only non-empty fields are returned by the API). ` +
    "Description/tags/HTML live under keys like System.Description, System.Tags. " +
    `"relations" has ${relCount} link rows. ` +
    "Use the JSON below in full — do not reduce to id/title/state/assignedTo only.\n\n";

  return {
    content: [
      {
        type: "text" as const,
        text: preamble + JSON.stringify(full, null, 2),
      },
    ],
    structuredContent: full,
  };
}

export function registerTools(server: McpServer, client: AxiosInstance): void {
  server.tool(
    "listProjects",
    "List team projects in the Azure DevOps collection. Uses AZURE_COLLECTION_URL if set, otherwise derives collection URL from AZURE_BASE_URL.",
    {},
    async () => {
      const projects = await listProjects(client);
      return jsonResult(projects);
    }
  );

  server.tool(
    "getWorkItem",
    "Returns the complete Azure DevOps work item JSON from GET /_apis/wit/workitems/{id}?$expand=all. Includes the full `fields` map (System.Title, System.Description, System.Tags, custom fields, etc. — only fields with values are present), `relations`, `_links`, `rev`. This is NOT limited to id/title/state/assignedTo; read the `fields` object for description, tags, and links.",
    { id: z.number().int().positive() },
    async ({ id }) => {
      const item = await getWorkItem(client, id);
      return workItemResult(item);
    }
  );

  server.tool(
    "searchWorkItems",
    'Search work items whose title contains the given text (WIQL CONTAINS on System.Title). Returns { id, title, state }[].',
    { query: z.string() },
    async ({ query }) => {
      const items = await searchWorkItems(client, query);
      return jsonResult(items);
    }
  );
}
