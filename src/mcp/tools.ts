import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getGatewayClient } from "../gateway/client.js";
import { pollEvents, acknowledgeEvent, getEventHistory, pruneExpiredEvents } from "../events/queue.js";

export function registerTools(server: McpServer): void {
  // --- Daemon Status ---
  server.tool(
    "daemon_status",
    "Check if the OpenClaw daemon is running and healthy",
    {},
    async () => {
      const gw = getGatewayClient();
      try {
        await gw.connect();
        return jsonResponse({
          running: true,
          gateway: gw.isConnected(),
          methods: gw.getMethods().length,
          message: "Connected to OpenClaw gateway.",
        });
      } catch (err) {
        return jsonResponse({
          running: false,
          gateway: false,
          message: `Cannot connect to OpenClaw gateway: ${(err as Error).message}`,
        });
      }
    }
  );

  // --- Poll Events ---
  server.tool(
    "poll_events",
    "Get unacknowledged events from automations that ran in the background. Returns events since the last poll.",
    { limit: z.number().min(1).max(200).default(50).describe("Max events to return") },
    async ({ limit }) => {
      const results = pollEvents(limit);
      return jsonResponse({
        count: results.length,
        events: results.map((e) => ({
          id: e.id,
          automationId: e.automationId,
          type: e.type,
          payload: safeParse(e.payload),
          createdAt: e.createdAt,
        })),
      });
    }
  );

  // --- Acknowledge Event ---
  server.tool(
    "acknowledge_event",
    "Mark an event as processed so it no longer appears in poll_events",
    { eventId: z.string().uuid().describe("The event ID to acknowledge") },
    async ({ eventId }) => {
      const success = acknowledgeEvent(eventId);
      return jsonResponse({
        success,
        message: success ? "Event acknowledged." : "Event not found.",
      });
    }
  );

  // --- Event History ---
  server.tool(
    "get_event_history",
    "Browse past events (both acknowledged and unacknowledged)",
    {
      limit: z.number().min(1).max(200).default(50).describe("Max events to return"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
    },
    async ({ limit, offset }) => {
      const results = getEventHistory(limit, offset);
      return jsonResponse({
        count: results.length,
        offset,
        events: results.map((e) => ({
          id: e.id,
          automationId: e.automationId,
          type: e.type,
          payload: safeParse(e.payload),
          acknowledged: e.acknowledged,
          createdAt: e.createdAt,
          acknowledgedAt: e.acknowledgedAt,
        })),
      });
    }
  );

  // --- Prune Expired Events ---
  server.tool(
    "prune_events",
    "Remove expired acknowledged events from the queue to free space",
    {},
    async () => {
      const pruned = pruneExpiredEvents();
      return jsonResponse({
        pruned,
        message: `Removed ${pruned} expired event(s).`,
      });
    }
  );

  // --- Send Message ---
  server.tool(
    "send_message",
    "Send a message through a connected OpenClaw messaging channel (Slack, Discord, Telegram, etc.)",
    {
      channel: z.string().describe("Channel name or ID (e.g., 'slack', 'discord', 'telegram')"),
      conversationId: z.string().describe("Conversation/chat/room ID to send to"),
      text: z.string().describe("Message text to send"),
    },
    async ({ channel, conversationId, text }) => {
      return gatewayToolCall("message", { action: "send", channel, conversationId, text });
    }
  );

  // --- List Channels ---
  server.tool(
    "list_channels",
    "List all connected messaging channels on the OpenClaw daemon",
    {},
    async () => {
      return gatewayRequest("channels.status");
    }
  );

  // --- Create Cron ---
  server.tool(
    "create_cron",
    "Create a recurring automation that runs on a cron schedule",
    {
      name: z.string().describe("Human-readable name for this automation"),
      schedule: z.string().describe("Cron expression (e.g., '0 9 * * *' for daily at 9am)"),
      action: z.string().describe("What to do when triggered — a description of the task"),
      channel: z.string().optional().describe("Optional: messaging channel to send results to"),
    },
    async ({ name, schedule, action, channel }) => {
      return gatewayRequest("cron.add", { name, schedule, action, channel });
    }
  );

  // --- List Automations ---
  server.tool(
    "list_automations",
    "List all active automations (cron jobs, webhooks, monitors)",
    {},
    async () => {
      return gatewayRequest("cron.list");
    }
  );

  // --- Delete Automation ---
  server.tool(
    "delete_automation",
    "Remove an automation by ID",
    { automationId: z.string().describe("The automation ID to delete") },
    async ({ automationId }) => {
      return gatewayRequest("cron.remove", { id: automationId });
    }
  );

  // --- Browser Navigate ---
  server.tool(
    "browser_navigate",
    "Open a URL in the OpenClaw browser automation engine",
    { url: z.string().url().describe("URL to navigate to") },
    async ({ url }) => {
      return gatewayToolCall("web_fetch", { url });
    }
  );

  // --- Browser Extract ---
  server.tool(
    "browser_extract",
    "Extract text content from the current browser page, optionally filtered by CSS selector",
    {
      selector: z.string().optional().describe("CSS selector to extract from (default: full page)"),
    },
    async ({ selector }) => {
      return gatewayToolCall("web_fetch", { selector });
    }
  );

  // --- Browser Screenshot ---
  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current browser page",
    {},
    async () => {
      return jsonResponse({
        error: "Browser screenshots require the OpenClaw desktop agent. Use browser_navigate + browser_extract for web content.",
      });
    }
  );
}

async function gatewayRequest(method: string, params?: unknown) {
  try {
    const gw = getGatewayClient();
    await gw.connect();
    const result = await gw.request(method, params);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message });
  }
}

async function gatewayToolCall(tool: string, args?: Record<string, unknown>) {
  try {
    const gw = getGatewayClient();
    await gw.connect();
    const result = await gw.request("tools_invoke", { tool, args });
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message });
  }
}

function jsonResponse(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}
