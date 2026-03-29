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

## MCP Tools

### Automation Management
| Tool | What it does |
|------|-------------|
| `create_cron` | Schedule a recurring automation |
| `create_webhook` | Set up a webhook trigger |
| `list_automations` | List all active automations |
| `delete_automation` | Remove an automation |
| `get_automation_status` | Check if an automation is healthy |

### Event Polling
| Tool | What it does |
|------|-------------|
| `poll_events` | Get events that happened since last check |
| `acknowledge_event` | Mark an event as processed |
| `get_event_history` | Browse past events |

### Messaging
| Tool | What it does |
|------|-------------|
| `send_message` | Send a message via any connected channel |
| `read_messages` | Read recent messages from a channel |
| `list_channels` | List connected messaging channels |

### Browser Automation
| Tool | What it does |
|------|-------------|
| `browser_navigate` | Open a URL |
| `browser_extract` | Extract content from a page |
| `browser_click` | Click an element |
| `browser_screenshot` | Take a screenshot |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWDAEMON_SOCKET` | `/tmp/clawdaemon.sock` | Path to daemon socket |
| `CLAWDAEMON_DB` | `~/.clawdaemon/events.db` | Event queue database |
| `CLAWDAEMON_EVENT_TTL` | `7d` | How long to keep unacknowledged events |

## Why this exists

OpenClaw is powerful but Anthropic's ToS prohibits extracting Claude OAuth tokens for third-party tools. This MCP server flips the direction — Claude Code calls OpenClaw through MCP, staying fully compliant. OpenClaw provides the automation muscles, Claude provides the brain.

## License

MIT
