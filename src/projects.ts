import {
  devOpsApiVersion,
  resolveCollectionBaseUrl,
  type AzureDevOpsClient,
} from "./client.js";

export interface TeamProjectSummary {
  id: string;
  name: string;
  state: string;
  visibility: string;
}

interface ProjectsApiRow {
  id?: string;
  name?: string;
  state?: string;
  visibility?: string;
}

interface ProjectsApiResponse {
  value?: ProjectsApiRow[];
}

/**
 * List team projects in the collection (GET Core /projects).
 * Uses collection-scoped base URL; see resolveCollectionBaseUrl in client.ts.
 */
export async function listProjects(
  client: AzureDevOpsClient
): Promise<TeamProjectSummary[]> {
  const collectionBase = resolveCollectionBaseUrl();
  const url = `${collectionBase}/_apis/projects`;
  const { data } = await client.get<ProjectsApiResponse>(url, {
    params: { "api-version": devOpsApiVersion() },
  });
  return (data.value ?? []).map((p) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    state: String(p.state ?? ""),
    visibility: String(p.visibility ?? ""),
  }));
}
