# ClawDaemon MCP

An MCP server that connects Claude Code to a persistent OpenClaw daemon for 24/7 automation. Includes a Claude CLI proxy that lets OpenClaw use your Claude Code subscription as its AI brain — no separate API key needed.

## What it does

OpenClaw runs as a background daemon on your machine. This MCP server gives Claude Code tools to manage that daemon — create cron jobs, set up webhooks, send messages across 23+ platforms, and automate your browser.

The key difference from other approaches: **automations keep running when Claude Code isn't open**. When you come back, Claude catches up on everything that happened through an event queue.

## Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              OpenClaw Daemon (24/7)          │
                        │  ┌─────────┐ ┌──────┐ ┌────────┐ ┌───────┐ │
                        │  │ Discord │ │ Cron │ │Browser │ │ Gmail │ │
                        │  └────┬────┘ └──┬───┘ └───┬────┘ └───┬───┘ │
                        │       └─────────┴─────────┴──────────┘     │
                        │                    │                        │
                        │              Gateway (:18789)               │
                        └──────────┬─────────────────┬───────────────┘
                                   │                 │
              MCP stdio            │  OpenAI API     │
Claude Code ◄──────────► MCP Server│  (:18790)       │
                              │    │                 │
                        SQLite DB  └── Claude Proxy ◄┘
                                         │
                                    claude --print
                                   (your CLI sub)
```

- **OpenClaw Daemon** runs in the background (systemd/launchd). Handles cron, messaging channels, browser automation.
- **MCP Server** connects to the daemon and exposes tools for Claude Code.
- **Claude Proxy** translates OpenAI API calls to `claude --print` calls. OpenClaw thinks it's talking to an API, but it's using your Claude Code subscription.
- **Event Queue** stores results from automations. When Claude Code reconnects, it polls for missed events.

## Prerequisites

- [Claude Code CLI](https://claude.ai/claude-code) installed and authenticated
- [OpenClaw](https://github.com/openclaw/openclaw) installed locally
- Node.js 22+

## Quick Start

### 1. Install

```bash
git clone https://github.com/mordiaky/clawdaemon-mcp.git
cd clawdaemon-mcp
npm install
npm run build
```

### 2. Set up OpenClaw

If you haven't installed OpenClaw yet:

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
npx pnpm install
npx pnpm build
```

Start the gateway:

```bash
node openclaw.mjs gateway run
```

The gateway starts on `http://127.0.0.1:18789` by default.

### 3. Connect MCP to Claude Code

```bash
claude mcp add clawdaemon -- node /absolute/path/to/clawdaemon-mcp/build/server.js
```

Optionally add OpenClaw's built-in messaging tools:

```bash
claude mcp add openclaw -- node /absolute/path/to/openclaw/openclaw.mjs mcp serve
```

Restart Claude Code for the tools to load.

### 4. Set up the Claude Proxy (optional)

The Claude Proxy lets OpenClaw use your Claude Code CLI subscription as its AI model. This means OpenClaw can respond to Discord messages, run heartbeat tasks, and process automations — all powered by Claude, with no separate API key.

#### Start the proxy

```bash
cd clawdaemon-mcp
npm run proxy
```

The proxy listens on `http://127.0.0.1:18790/v1` and translates OpenAI-compatible API calls into `claude --print` calls.

#### Configure OpenClaw to use the proxy

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "claude-proxy": {
        "baseUrl": "http://127.0.0.1:18790/v1",
        "api": "openai-completions",
        "models": [
          {
            "id": "claude-cli",
            "name": "Claude via CLI Proxy",
            "input": ["text", "image"],
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "claude-proxy/claude-cli"
      }
    }
  }
}
```

Restart the gateway to apply:

```bash
openclaw gateway restart
```

#### Give the proxy access to your MCP servers

Edit `openclaw-mcp-config.json` to add any MCP servers you want the proxy-spawned Claude to have access to:

```json
{
  "mcpServers": {
    "clawdaemon": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/clawdaemon-mcp/build/server.js"],
      "env": {}
    },
    "your-other-server": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/your-server/build/index.js"],
      "env": {}
    }
  }
}
```

The proxy passes this config to `claude --print --mcp-config` so the Claude instance that responds to messages has full tool access.

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

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `OPENCLAW_GATEWAY_TOKEN` | *(from ~/.openclaw/openclaw.json)* | Auth token for gateway |
| `CLAWDAEMON_DB` | `~/.clawdaemon/events.db` | Event queue database path |
| `CLAUDE_PROXY_PORT` | `18790` | Port for the Claude CLI proxy |

## How the Claude Proxy Works

The proxy is a lightweight HTTP server that makes Claude Code CLI look like an OpenAI-compatible API:

1. OpenClaw sends a standard `/v1/chat/completions` request
2. The proxy converts the messages to a prompt string
3. It spawns `claude --print --output-format json --mcp-config openclaw-mcp-config.json`
4. Claude processes the prompt with full MCP tool access
5. The proxy wraps the response in OpenAI format and returns it
6. OpenClaw delivers the response to Discord/Telegram/etc.

Supports both streaming (SSE) and non-streaming responses.

## Channel Setup (Discord example)

Once the proxy is running and OpenClaw is configured to use it, add a messaging channel:

1. Create a Discord bot at https://discord.com/developers/applications
2. Get the bot token, enable Message Content Intent
3. Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "groupPolicy": "open",
      "accounts": {
        "default": {
          "token": "YOUR_DISCORD_BOT_TOKEN"
        }
      }
    }
  }
}
```

4. Restart the gateway and invite the bot to your server
5. DM the bot to trigger pairing, then approve: `openclaw pairing approve discord <CODE>`

Claude will now respond to Discord messages through the proxy.

## Troubleshooting

### MCP server won't connect / tools not showing up

1. **Restart Claude Code** — MCP tools only load at session start.
2. **Check the gateway is running** — Visit `http://127.0.0.1:18789`.
3. **Check MCP server status** — Run `/mcp` in Claude Code.

### Claude Proxy not responding

1. **Check the proxy is running** — `curl http://127.0.0.1:18790/v1/models`
2. **Check Claude CLI is authenticated** — `claude --version`
3. **Check proxy logs** — Logs go to stderr. Run `npm run proxy` in a terminal to see them.

### Discord bot connects but doesn't receive messages

1. Enable all three Privileged Gateway Intents in the Discord Developer Portal (Message Content, Server Members, Presence)
2. Set `groupPolicy: "open"` in the Discord channel config
3. DM the bot and complete the pairing flow

### "Awaiting gateway readiness" on restart

Discord's WebSocket sometimes doesn't reconnect cleanly. Stop the gateway, wait 15 seconds, then restart:

```bash
systemctl --user stop openclaw-gateway.service
sleep 15
openclaw gateway restart
```

## Why this exists

OpenClaw is a powerful automation daemon but its built-in AI requires separate API keys. Claude Code users already have a Claude subscription. This MCP server + proxy lets you use OpenClaw's full automation stack (messaging, cron, browser, webhooks) powered entirely by your existing Claude Code subscription — no additional API costs, no ToS violations.

## License

MIT
