import axios, { type AxiosError, type AxiosInstance } from "axios";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

/** PAT copy/paste often wraps quotes; trim and strip matching quotes only. */
function normalizePat(pat: string): string {
  let p = String(pat).trim();
  if (
    (p.startsWith('"') && p.endsWith('"')) ||
    (p.startsWith("'") && p.endsWith("'"))
  ) {
    p = p.slice(1, -1).trim();
  }
  return p;
}

/**
 * Team projects API is rooted at the collection, not the project.
 * Set AZURE_COLLECTION_URL to override (e.g. https://host/CollectionName).
 * Otherwise the last path segment of AZURE_BASE_URL is dropped when it looks
 * like .../Collection/Project.
 */
export function resolveCollectionBaseUrl(): string {
  const explicit = process.env.AZURE_COLLECTION_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const projectBase = requireEnv("AZURE_BASE_URL").replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(projectBase);
  } catch {
    return projectBase;
  }
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length >= 2) {
    parts.pop();
    u.pathname = `/${parts.join("/")}`;
  }
  return u.toString().replace(/\/+$/, "");
}

/** REST `api-version` query param for all DevOps calls (default 7.1). */
export function devOpsApiVersion(): string {
  const v = process.env.AZURE_DEVOPS_API_VERSION?.trim();
  return v || "7.1";
}

/**
 * Build a Basic auth header for Azure DevOps PAT (empty username).
 */
function patAuthorizationHeader(pat: string): string {
  const token = Buffer.from(`:${pat}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function responseDetail(data: unknown): string {
  if (data == null) {
    return "";
  }
  if (typeof data === "string") {
    return data.trim();
  }
  if (typeof data === "object" && data !== null) {
    const o = data as Record<string, unknown>;
    if (typeof o.message === "string") {
      return o.message;
    }
    if (typeof o.errorMessage === "string") {
      return o.errorMessage;
    }
    try {
      const s = JSON.stringify(data);
      return s === "{}" ? "" : s;
    } catch {
      return "";
    }
  }
  return "";
}

function errCodeSuffix(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return ` [${(err as { code: string }).code}]`;
  }
  return "";
}

/**
 * Extract a readable message from an Axios error response.
 */
export function formatAxiosError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    const msg =
      err instanceof Error ? err.message || String(err) : String(err);
    const code = errCodeSuffix(err);
    if (
      (err && typeof err === "object" && (err as { code?: string }).code === "ECONNABORTED") ||
      /timeout/i.test(msg)
    ) {
      return `Request timed out${code}. Increase AZURE_HTTP_TIMEOUT_MS (default 120000) or check VPN/network.`;
    }
    return `${msg}${code}`;
  }

  if (!err.response) {
    const code = err.code ? ` [${err.code}]` : "";
    if (err.code === "ECONNABORTED" || /timeout/i.test(String(err.message))) {
      return `Request timed out${code}. Increase AZURE_HTTP_TIMEOUT_MS (default 120000) or check VPN/network.`;
    }
    return `${err.message || String(err)}${code}`;
  }

  const { status, statusText, data } = err.response;
  const base = `${status} ${statusText || ""}`.trim();
  const wwwAuth = err.response.headers?.["www-authenticate"];

  const detail = responseDetail(data);

  if (status === 401) {
    const hint =
      "PAT rejected or anonymous. Fix: use a valid PAT with Work Items (read), set AZURE_BASE_URL to the team project root (same as in the browser), ensure AZURE_PAT is exported in this shell / Cursor MCP env (no extra quotes). Test: curl -sS -u \":$AZURE_PAT\" \"$AZURE_BASE_URL/_apis/wit/workitems?ids=1&api-version=7.1\"";
    const authHint = wwwAuth ? ` www-authenticate: ${wwwAuth}.` : "";
    return detail
      ? `${base}: ${detail}.${authHint} ${hint}`
      : `${base}.${authHint} ${hint}`;
  }

  if (detail) {
    return `${base}: ${detail}`;
  }
  return base;
}

function httpTimeoutMs(): number {
  const raw = process.env.AZURE_HTTP_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === "") {
    return 120_000;
  }
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

export function createAzureDevOpsClient(): AxiosInstance {
  const baseURL = requireEnv("AZURE_BASE_URL").replace(/\/+$/, "");
  const pat = normalizePat(requireEnv("AZURE_PAT"));
  const timeout = httpTimeoutMs();

  const client = axios.create({
    baseURL,
    timeout,
    headers: {
      Authorization: patAuthorizationHeader(pat),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    validateStatus: (s) => s >= 200 && s < 300,
    responseType: "json",
  });

  if (process.env.MCP_DEBUG === "1") {
    client.interceptors.request.use((config) => {
      const uri = client.getUri(config);
      const h = config.headers;
      const auth =
        (typeof h.get === "function" ? h.get("Authorization") : null) ||
        (h as { Authorization?: string }).Authorization ||
        (h as { common?: { Authorization?: string } }).common?.Authorization;
      console.error(`[MCP_DEBUG] ${config.method?.toUpperCase()} ${uri}`);
      console.error(
        `[MCP_DEBUG] Authorization header: ${auth ? "present" : "MISSING (would get TF400813 / anonymous)"}`
      );
      console.error(
        `[MCP_DEBUG] timeout ${timeout}ms (set AZURE_HTTP_TIMEOUT_MS to change)`
      );
      config.mcpRequestStart = Date.now();
      return config;
    });
    client.interceptors.response.use(
      (res) => {
        const started = res.config?.mcpRequestStart;
        const ms = started != null ? Date.now() - started : null;
        console.error(
          `[MCP_DEBUG] ${res.status} in ${ms != null ? `${ms}ms` : "?ms"}`
        );
        return res;
      },
      (error: AxiosError) => {
        const started = error.config?.mcpRequestStart;
        const ms = started != null ? Date.now() - started : null;
        console.error(
          `[MCP_DEBUG] failed after ${ms != null ? `${ms}ms` : "?ms"}: ${error.message}`
        );
        return Promise.reject(error);
      }
    );
  }

  client.interceptors.response.use(
    (res) => res,
    (err: unknown) => Promise.reject(new Error(formatAxiosError(err)))
  );

  return client;
}
