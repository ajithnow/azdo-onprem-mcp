import { devOpsApiVersion, type AzureDevOpsClient } from "./client.js";

/** Azure DevOps work item REST body from GET .../workitems/{id}?$expand=all */
export type AzureWorkItem = Record<string, unknown>;

/** Escape single quotes for WIQL string literals */
export function escapeWiqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/** Team project root, e.g. https://host/Collection/Project — must match AZURE_BASE_URL. */
function projectBaseUrl(client: AzureDevOpsClient): string {
  return String(client.defaults.baseURL ?? "").replace(/\/+$/, "");
}

/**
 * Full work item JSON from GET .../workitems/{id}?$expand=all (id, rev, fields, relations, _links, ...).
 */
export async function getWorkItem(
  client: AzureDevOpsClient,
  id: number
): Promise<AzureWorkItem> {
  const base = projectBaseUrl(client);
  const url = `${base}/_apis/wit/workitems/${id}`;
  const { data } = await client.get<AzureWorkItem>(url, {
    params: {
      $expand: "all",
      "api-version": devOpsApiVersion(),
    },
  });
  return data;
}

interface WorkItemBatchRow {
  id: number;
  fields?: Record<string, unknown>;
}

interface WorkItemsBatchResponse {
  value?: WorkItemBatchRow[];
}

interface WiqlWorkItemRef {
  id?: number;
}

interface WiqlResponse {
  workItems?: WiqlWorkItemRef[];
  queryResult?: { workItems?: WiqlWorkItemRef[] };
}

export interface WorkItemSearchRow {
  id: number;
  title: unknown;
  state: unknown;
}

async function fetchWorkItemsBatch(
  client: AzureDevOpsClient,
  ids: number[]
): Promise<Map<number, { title: unknown; state: unknown }>> {
  const map = new Map<number, { title: unknown; state: unknown }>();
  if (ids.length === 0) {
    return map;
  }

  const base = projectBaseUrl(client);
  const url = `${base}/_apis/wit/workitems`;
  const { data } = await client.get<WorkItemsBatchResponse>(url, {
    params: {
      ids: ids.join(","),
      fields: "System.Title,System.State",
      "api-version": devOpsApiVersion(),
    },
  });

  const items = data.value ?? [];
  for (const item of items) {
    const f = item.fields ?? {};
    map.set(item.id, {
      title: f["System.Title"],
      state: f["System.State"],
    });
  }
  return map;
}

export async function searchWorkItems(
  client: AzureDevOpsClient,
  query: string
): Promise<WorkItemSearchRow[]> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return [];
  }

  const safe = escapeWiqlString(trimmed);
  const wiql = `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.Title] CONTAINS '${safe}'`;

  const base = projectBaseUrl(client);
  const url = `${base}/_apis/wit/wiql`;
  const { data } = await client.post<WiqlResponse>(
    url,
    { query: wiql },
    { params: { "api-version": devOpsApiVersion() } }
  );

  const rawList = data.workItems ?? data.queryResult?.workItems ?? [];
  const ids = rawList
    .map((w) => w.id)
    .filter((id): id is number => typeof id === "number");

  const details = await fetchWorkItemsBatch(client, ids);

  const result: WorkItemSearchRow[] = [];
  for (const id of ids) {
    const row = details.get(id);
    if (row) {
      result.push({ id, title: row.title, state: row.state });
    }
  }
  return result;
}
