# ClawDaemon MCP

An MCP server that connects Claude Code to a persistent OpenClaw daemon for 24/7 automation.

## What it does

OpenClaw runs as a background daemon on your machine. This MCP server gives Claude Code tools to manage that daemon — create cron jobs, set up webhooks, send messages across 23+ platforms, and automate your browser.

The key difference from other approaches: **automations keep running when Claude Code isn't open**. When you come back, Claude catches up on everything that happened through an event queue.

## How it works

```
Claude Code  <--MCP stdio-->  ClawDaemon MCP Server  <--socket-->  OpenClaw Daemon (24/7)
                                      |
                                SQLite Event Queue
```

- **OpenClaw Daemon** runs in the background (systemd/launchd). It handles cron jobs, webhooks, messaging channels, and browser automation.
- **MCP Server** connects to the daemon and exposes tools for Claude Code.
- **Event Queue** stores results from automations. When Claude Code reconnects, it polls for missed events.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) installed locally
- Node.js 22+

## Setting Up OpenClaw

ClawDaemon needs a running OpenClaw gateway to connect to. If you haven't set up OpenClaw yet:

### 1. Install and build OpenClaw

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
npx pnpm install
npx pnpm build
```

> **Note:** OpenClaw uses pnpm, not npm. If you don't have pnpm installed globally, `npx pnpm` works fine.

### 2. Start the gateway

```bash
node openclaw.mjs gateway run
```

The gateway starts on `http://127.0.0.1:18789` by default. You'll see a web UI at that address.

### 3. Device pairing

The first time you connect, OpenClaw will create a device identity and request pairing. You'll need to **approve the pairing request** from the gateway's web UI or CLI before the MCP connection will work.

If you're connecting a new device or reconnecting after a reinstall, you may need to approve pairing again.

## Install

```bash
git clone https://github.com/mordiaky/clawdaemon-mcp.git
cd clawdaemon-mcp
npm install
npm run build
```

## Connect to Claude Code

```bash
claude mcp add clawdaemon -- node /absolute/path/to/clawdaemon-mcp/build/server.js
```

You can also add OpenClaw's built-in MCP server for direct messaging tools:

```bash
claude mcp add openclaw -- node /absolute/path/to/openclaw/openclaw.mjs mcp serve
```

After adding, **restart your Claude Code session** for the new tools to load.

## MCP Tools

### Daemon
| Tool | What it does |
|------|-------------|
| `daemon_status` | Check if OpenClaw gateway is running and healthy |

### Automation Management
| Tool | What it does |
|------|-------------|
| `create_cron` | Schedule a recurring automation |
| `list_automations` | List all active automations |
| `delete_automation` | Remove an automation |

### Event Polling
| Tool | What it does |
|------|-------------|
| `poll_events` | Get events that happened since last check |
| `acknowledge_event` | Mark an event as processed |
| `get_event_history` | Browse past events |
| `prune_events` | Remove expired events from the queue |

### Messaging
| Tool | What it does |
|------|-------------|
| `send_message` | Send a message via any connected channel |
| `list_channels` | List connected messaging channels |

### Browser Automation
| Tool | What it does |
|------|-------------|
| `browser_navigate` | Open a URL in the browser |
| `browser_extract` | Get a DOM snapshot of the current page |
| `browser_screenshot` | Take a screenshot |

> **Note:** Browser tools use OpenClaw's HTTP `/tools/invoke` endpoint (the browser plugin isn't available over WebSocket). The MCP server handles this automatically using the same auth token.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | *(from ~/.openclaw/openclaw.json)* | Auth token for gateway |
| `CLAWDAEMON_DB` | `~/.clawdaemon/events.db` | Event queue database path |

## Troubleshooting

### MCP server won't connect / tools not showing up

1. **Restart Claude Code** — MCP tools only load at session start. After adding or fixing a server, restart.
2. **Check the gateway is running** — Visit `http://127.0.0.1:18789` in your browser. If it's not loading, start it with `node openclaw.mjs gateway run` from your OpenClaw directory.
3. **Check MCP server status** — Run `/mcp` in Claude Code to see which servers are connected and which have errors.

### "Connection refused" or socket errors

The OpenClaw gateway isn't running. Start it:

```bash
cd /path/to/openclaw
node openclaw.mjs gateway run
```

### Stale device identity

If OpenClaw was reinstalled or the gateway entrypoint changed, the old device identity may be invalid. Signs: connection errors even though the gateway is running.

**Fix:**
1. Delete the stale device identity from OpenClaw's data directory
2. Restart the gateway: `node openclaw.mjs gateway run`
3. Approve the new device's pairing request from the gateway web UI at `http://127.0.0.1:18789`

### Gateway entrypoint changed after update

If you updated OpenClaw and the gateway won't start, the entrypoint path may have moved. Reinstall/rebuild:

```bash
cd /path/to/openclaw
npx pnpm install
npx pnpm build
node openclaw.mjs gateway run
```

### Tools load but return errors

If MCP tools appear in Claude Code but return errors when called, the gateway is likely down or the device pairing expired. Check the gateway is running and re-approve pairing if needed.

## Why this exists

OpenClaw is powerful but Anthropic's ToS prohibits extracting Claude OAuth tokens for third-party tools. This MCP server flips the direction — Claude Code calls OpenClaw through MCP, staying fully compliant. OpenClaw provides the automation muscles, Claude provides the brain.

## License

MIT
