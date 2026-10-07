/**
 * EWM Agent MCP server (stdio).
 *
 * Lets an MCP client such as Claude Desktop read tickets and run the read-only SAP tools of one
 * project. It is a thin relay: it holds no SAP credentials and no SAP logic. Every call goes to
 * the EWM Agent platform with an agent access token, and the platform applies the same checks
 * and writes the same records as for a person using the web console.
 *
 * Settings (environment variables):
 *   EWM_API_TOKEN  agent access token created in the web console (required)
 *   EWM_API_URL    address of the platform, default http://localhost:3000
 *
 * stdout carries the protocol and nothing else. Anything for a person goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PlatformApi } from "./api";
import { createMcpServer } from "./mcp-server";

const token = process.env.EWM_API_TOKEN?.trim();
const url = process.env.EWM_API_URL?.trim() || "http://localhost:3000";

if (!token) {
  console.error(
    "EWM_API_TOKEN is not set. Create an agent access token in the web console (Agent access) and set it.",
  );
  process.exit(1);
}

const api = new PlatformApi(url, token);
try {
  const context = await api.context();
  console.error(
    `EWM Agent MCP server: project ${context.project.key} ${context.project.name}, acting for ${context.actingFor.name}, ` +
      `${context.sapSystems.length} SAP system(s), ${context.tools.length} SAP tools.`,
  );
} catch (err) {
  // Start anyway: the client then shows a clear error on the first call instead of a dead server.
  console.error(`EWM Agent MCP server: could not load the project yet. ${(err as Error).message}`);
}

await createMcpServer(api).connect(new StdioServerTransport());
