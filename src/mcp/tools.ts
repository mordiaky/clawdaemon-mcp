import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isDaemonRunning, connectToDaemon } from "../daemon/connection.js";
import { pollEvents, acknowledgeEvent, getEventHistory, pruneExpiredEvents } from "../events/queue.js";

export function registerTools(server: McpServer): void {
  // --- Daemon Status ---
  server.tool(
    "daemon_status",
    "Check if the OpenClaw daemon is running and healthy",
    {},
    async () => {
      const running = await isDaemonRunning();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              running,
              socket: process.env.CLAWDAEMON_SOCKET ?? "/tmp/clawdaemon.sock",
              message: running
                ? "OpenClaw daemon is running and accepting connections."
                : "OpenClaw daemon is not running. Start it with: openclaw daemon start",
            }),
          },
        ],
      };
    }
  );

  // --- Poll Events ---
  server.tool(
    "poll_events",
    "Get unacknowledged events from automations that ran in the background. Returns events since the last poll.",
    { limit: z.number().min(1).max(200).default(50).describe("Max events to return") },
    async ({ limit }) => {
      const results = pollEvents(limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: results.length,
              events: results.map((e) => ({
                id: e.id,
                automationId: e.automationId,
                type: e.type,
                payload: JSON.parse(e.payload),
                createdAt: e.createdAt,
              })),
            }),
          },
        ],
      };
    }
  );

  // --- Acknowledge Event ---
  server.tool(
    "acknowledge_event",
    "Mark an event as processed so it no longer appears in poll_events",
    { eventId: z.string().uuid().describe("The event ID to acknowledge") },
    async ({ eventId }) => {
      const success = acknowledgeEvent(eventId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success,
              message: success ? "Event acknowledged." : "Event not found.",
            }),
          },
        ],
      };
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: results.length,
              offset,
              events: results.map((e) => ({
                id: e.id,
                automationId: e.automationId,
                type: e.type,
                payload: JSON.parse(e.payload),
                acknowledged: e.acknowledged,
                createdAt: e.createdAt,
                acknowledgedAt: e.acknowledgedAt,
              })),
            }),
          },
        ],
      };
    }
  );

  // --- Prune Expired Events ---
  server.tool(
    "prune_events",
    "Remove expired acknowledged events from the queue to free space",
    {},
    async () => {
      const pruned = pruneExpiredEvents();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              pruned,
              message: `Removed ${pruned} expired event(s).`,
            }),
          },
        ],
      };
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
      try {
        const socket = await connectToDaemon();
        const request = { action: "send_message", channel, conversationId, text };

        return await sendDaemonRequest(socket, request);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // --- List Channels ---
  server.tool(
    "list_channels",
    "List all connected messaging channels on the OpenClaw daemon",
    {},
    async () => {
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, { action: "list_channels" });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
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
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, {
          action: "create_cron",
          name,
          schedule,
          task: action,
          channel,
        });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // --- List Automations ---
  server.tool(
    "list_automations",
    "List all active automations (cron jobs, webhooks, monitors)",
    {},
    async () => {
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, { action: "list_automations" });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // --- Delete Automation ---
  server.tool(
    "delete_automation",
    "Remove an automation by ID",
    { automationId: z.string().describe("The automation ID to delete") },
    async ({ automationId }) => {
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, { action: "delete_automation", automationId });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // --- Browser Navigate ---
  server.tool(
    "browser_navigate",
    "Open a URL in the OpenClaw browser automation engine",
    { url: z.string().url().describe("URL to navigate to") },
    async ({ url }) => {
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, { action: "browser_navigate", url });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
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
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, { action: "browser_extract", selector });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );

  // --- Browser Screenshot ---
  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current browser page",
    {},
    async () => {
      try {
        const socket = await connectToDaemon();
        return await sendDaemonRequest(socket, { action: "browser_screenshot" });
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }) }],
        };
      }
    }
  );
}

function sendDaemonRequest(
  socket: import("net").Socket,
  request: Record<string, unknown>
): Promise<{ content: { type: "text"; text: string }[] }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Daemon request timed out after 30s"));
    }, 30000);

    socket.once("data", (data) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(data.toString());
        resolve({
          content: [{ type: "text", text: JSON.stringify(response) }],
        });
      } catch {
        resolve({
          content: [{ type: "text", text: data.toString() }],
        });
      }
    });

    socket.write(JSON.stringify(request) + "\n");
  });
}
