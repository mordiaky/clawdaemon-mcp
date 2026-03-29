import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = parseInt(process.env.CLAUDE_PROXY_PORT || "18790", 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_CONFIG = join(__dirname, "..", "openclaw-mcp-config.json");

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return JSON.stringify(part);
      })
      .join("\n");
  }
  if (content && typeof content === "object") {
    return (content as any).text || JSON.stringify(content);
  }
  return String(content ?? "");
}

function messagesToPrompt(messages: Array<{ role: string; content: unknown }>): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const text = extractText(msg.content);
    if (msg.role === "system") {
      parts.push(text);
    } else if (msg.role === "user") {
      parts.push(`\nHuman: ${text}`);
    } else if (msg.role === "assistant") {
      parts.push(`\nAssistant: ${text}`);
    } else if (msg.role === "tool") {
      parts.push(`\nTool result: ${text}`);
    }
  }
  return parts.join("\n");
}

function callClaude(prompt: string): Promise<{ text: string; usage: any }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["--print", "--output-format", "json", "--mcp-config", MCP_CONFIG], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve({
          text: result.result || "",
          usage: {
            prompt_tokens: result.usage?.input_tokens || 0,
            completion_tokens: result.usage?.output_tokens || 0,
            total_tokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
          },
        });
      } catch {
        resolve({ text: stdout.trim(), usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
      }
    });

    proc.on("error", reject);
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function jsonRes(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.url === "/v1/models" && req.method === "GET") {
    return jsonRes(res, 200, {
      object: "list",
      data: [{ id: "claude-cli", object: "model", created: Date.now(), owned_by: "anthropic" }],
    });
  }

  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    try {
      const body = JSON.parse(await readBody(req));
      const prompt = messagesToPrompt(body.messages || []);
      const isStream = body.stream === true;

      console.error(`[claude-proxy] model=${body.model} stream=${isStream} prompt=${prompt.slice(0, 80)}...`);

      const result = await callClaude(prompt);

      console.error(`[claude-proxy] response (${result.text.length} chars): ${result.text.slice(0, 120)}...`);

      if (isStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const id = `chatcmpl-${Date.now()}`;
        const ts = Math.floor(Date.now() / 1000);
        // Content chunk
        res.write(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created: ts, model: body.model || "claude-cli",
          choices: [{ index: 0, delta: { role: "assistant", content: result.text }, finish_reason: null }],
        })}\n\n`);
        // Stop chunk
        res.write(`data: ${JSON.stringify({
          id, object: "chat.completion.chunk", created: ts, model: body.model || "claude-cli",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      return jsonRes(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "claude-cli",
        choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
        usage: result.usage,
      });
    } catch (err: any) {
      console.error(`[claude-proxy] error: ${err.message}`);
      return jsonRes(res, 500, { error: { message: err.message, type: "server_error" } });
    }
  }

  jsonRes(res, 404, { error: { message: "Not found" } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`[claude-proxy] listening on http://127.0.0.1:${PORT}/v1`);
  console.error(`[claude-proxy] Claude CLI → OpenAI-compatible API proxy`);
});
