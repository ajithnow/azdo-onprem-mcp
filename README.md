# azdo-onprem-mcp

Minimal [Model Context Protocol](https://modelcontextprotocol.io) server for **self-hosted Azure DevOps Server** (on-premises). It uses the REST APIs with a PAT and **Basic** auth (`curl -u ":$PAT"`), same as Azure DevOps Services patterns but with your own base URL.

**Not** for `dev.azure.com` only—any DevOps Server reachable over HTTPS works if the APIs respond.

## Requirements

- **Node.js** 18+
- A **Personal Access Token** with at least **Work Items (Read)** (and any other scopes you rely on)
- **VPN/network** access to your server if required

## Install

```bash
npm install -g azdo-onprem-mcp
```

Or run without a global install:

```bash
npx azdo-onprem-mcp
```

The package exposes the CLI binary **`azdo-onprem-mcp`** (see `package.json` → `bin`).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_BASE_URL` | Yes | **Team project** root URL, same as in the browser for that project, e.g. `https://devops.example.com/Collection/MyProject` (no trailing slash required). |
| `AZURE_PAT` | Yes | Personal Access Token. Sent as Basic auth with an empty username (`Authorization: Basic base64(":PAT")`). |
| `AZURE_COLLECTION_URL` | No | Overrides collection root for **`listProjects`** only. If unset, the collection URL is derived by dropping the last path segment of `AZURE_BASE_URL` (e.g. `.../Collection/Project` → `.../Collection`). |
| `AZURE_HTTP_TIMEOUT_MS` | No | HTTP timeout in ms (default `120000`). |
| `AZURE_DEVOPS_API_VERSION` | No | REST `api-version` query parameter (default `7.1`). Try `7.0` or `6.0` if your server is older. |
| `MCP_DEBUG` | No | Set to `1` to log request URLs and timing on stderr (no secrets). |

Do **not** commit secrets. Prefer Cursor/IDE env injection or your OS secret store.

## Cursor (or any MCP client)

Example `mcp.json` entry using the **published package** (`-y` lets `npx` install or run without an interactive prompt, which MCP clients need):

```json
{
  "mcpServers": {
    "azdo-onprem": {
      "command": "npx",
      "args": ["-y", "azdo-onprem-mcp"],
      "env": {
        "AZURE_BASE_URL": "https://devops.example.com/Collection/MyProject",
        "AZURE_PAT": "<your-pat>"
      }
    }
  }
}
```

**Alternatives**

- **Global install:** `"command": "azdo-onprem-mcp"` with no `args` (or an empty `args` array), if `npm install -g azdo-onprem-mcp` put the binary on your `PATH`.
- **Local clone:** after `npm install` and `npm run build`, use `"command": "node"` and `"args": ["/absolute/path/to/azdo-onprem-mcp/dist/server.js"]` (adjust the path to your machine).

Reload MCP / restart the editor after changing env.

## Tools

| Tool | Description |
|------|-------------|
| `getWorkItem` | `GET` …`/_apis/wit/workitems/{id}?` `$expand=all` — returns the **full** REST body as **MCP `structuredContent`** and as JSON text. Empty field values are often omitted by Azure DevOps; unset fields are not listed. If the chat UI shows a short snippet, use the structured payload (or your client’s tool-result JSON view). |
| `searchWorkItems` | WIQL search on `System.Title` (contains), then batch-fetch details — returns `{ id, title, state }[]`. |
| `listProjects` | `GET` …`/_apis/projects` at the **collection** URL (see `AZURE_COLLECTION_URL` / derivation above). |

## Verify with curl (optional)

Mac/Linux: use **single quotes** around the URL so `$expand` is not interpreted by the shell.

```bash
export AZURE_PAT='your-pat'
curl -sS -u ":$AZURE_PAT" \
  'https://your-host/Collection/MyProject/_apis/wit/workitems/12345?$expand=all&api-version=7.1'
```

## Development

From a clone of this repository:

```bash
npm install
npm run build
npm start
```

Source lives in `src/` (TypeScript); `npm run build` emits to `dist/`. With `AZURE_BASE_URL` and `AZURE_PAT` set, `npm start` runs the MCP server on stdio (stop with Ctrl+C). Point your MCP client at this command or use `npx azdo-onprem-mcp` after publishing.

## Publish to npm

From the repo root (with `npm login` if needed):

```bash
npm run build
npm publish
```

`prepack` runs `npm run build` automatically, so `dist/` is always fresh in the tarball. For a **scoped** package name (e.g. `@your-scope/azdo-onprem-mcp`), use `npm publish --access public` the first time.

## License

MIT (see `package.json` → `"license"`).
