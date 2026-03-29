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

function formatErrorResponse(
  status: number,
  statusText: string,
  data: unknown,
  headers: Headers
): string {
  const base = `${status} ${statusText || ""}`.trim();
  const wwwAuth = headers.get("www-authenticate");
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

/**
 * Readable message for failed HTTP calls (used by {@link createAzureDevOpsClient}).
 */
export function formatRequestError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message || String(err) : String(err);
  const code = errCodeSuffix(err);
  if (
    (err &&
      typeof err === "object" &&
      (err as { code?: string }).code === "ECONNABORTED") ||
    /timeout/i.test(msg) ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    return `Request timed out${code}. Increase AZURE_HTTP_TIMEOUT_MS (default 120000) or check VPN/network.`;
  }
  return `${msg}${code}`;
}

function httpTimeoutMs(): number {
  const raw = process.env.AZURE_HTTP_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === "") {
    return 120_000;
  }
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

function buildUrlWithParams(
  url: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const u = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) {
        u.searchParams.set(k, String(v));
      }
    }
  }
  return u.toString();
}

export interface AzureDevOpsClient {
  readonly defaults: { baseURL: string };
  get<T>(
    url: string,
    config?: {
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<{ data: T }>;
  post<T>(
    url: string,
    body: unknown,
    config?: {
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<{ data: T }>;
}

/**
 * HTTP client for Azure DevOps REST APIs (Node 18+ native `fetch`).
 * Avoids extra dependencies (e.g. axios → form-data → mime-db) that can break under `npx` on Windows.
 */
export function createAzureDevOpsClient(): AzureDevOpsClient {
  const baseURL = requireEnv("AZURE_BASE_URL").replace(/\/+$/, "");
  const pat = normalizePat(requireEnv("AZURE_PAT"));
  const timeoutMs = httpTimeoutMs();

  const authHeaders: Record<string, string> = {
    Authorization: patAuthorizationHeader(pat),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function request<T>(
    method: "GET" | "POST",
    url: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {}
  ): Promise<{ data: T }> {
    const finalUrl = buildUrlWithParams(url, options.params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const debug = process.env.MCP_DEBUG === "1";
    const started = Date.now();

    if (debug) {
      console.error(`[MCP_DEBUG] ${method} ${finalUrl}`);
      console.error(
        `[MCP_DEBUG] Authorization header: ${authHeaders.Authorization ? "present" : "MISSING (would get TF400813 / anonymous)"}`
      );
      console.error(
        `[MCP_DEBUG] timeout ${timeoutMs}ms (set AZURE_HTTP_TIMEOUT_MS to change)`
      );
    }

    try {
      const res = await fetch(finalUrl, {
        method,
        headers: authHeaders,
        body:
          options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let data: unknown = undefined;
      if (text.length > 0) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) {
          try {
            data = JSON.parse(text) as unknown;
          } catch {
            data = text;
          }
        } else {
          data = text;
        }
      }

      if (debug) {
        const ms = Date.now() - started;
        console.error(`[MCP_DEBUG] ${res.status} in ${ms}ms`);
      }

      if (!res.ok) {
        throw new Error(
          formatErrorResponse(res.status, res.statusText, data, res.headers)
        );
      }

      return { data: data as T };
    } catch (err) {
      if (debug) {
        const ms = Date.now() - started;
        const m = err instanceof Error ? err.message : String(err);
        console.error(`[MCP_DEBUG] failed after ${ms}ms: ${m}`);
      }
      throw err instanceof Error
        ? err
        : new Error(formatRequestError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    defaults: { baseURL },
    get: (url, config) => request("GET", url, { params: config?.params }),
    post: (url, body, config) =>
      request("POST", url, { body, params: config?.params }),
  };
}
