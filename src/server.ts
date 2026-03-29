import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./mcp/tools.js";
import { getGatewayClient } from "./gateway/client.js";
import "./db/client.js"; // Ensure DB tables are created at startup

const server = new McpServer({
  name: "clawdaemon",
  version: "0.1.0",
});

registerTools(server);

// Connect to gateway in background — don't block MCP startup
const gw = getGatewayClient();
gw.connect().then(() => {
  process.stderr.write("[clawdaemon] gateway connection ready\n");
}).catch((err) => {
  process.stderr.write(`[clawdaemon] gateway connection deferred: ${err.message}\n`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[clawdaemon] MCP server running\n");
