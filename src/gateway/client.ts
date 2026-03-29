import WebSocket from "ws";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
};

export type GatewayConfig = {
  url: string;
  token?: string;
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private config: GatewayConfig;
  private ready = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private connectNonce: string | null = null;
  private availableMethods: string[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionallyClosed = false;

  private static readonly BACKOFF_BASE = 1000;   // 1s
  private static readonly BACKOFF_MAX = 30000;    // 30s
  private static readonly MAX_REQUEST_RETRIES = 2;

  constructor(config?: Partial<GatewayConfig>) {
    this.config = {
      url: config?.url ?? process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
      token: config?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? loadTokenFromConfig(),
    };
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;

    this.intentionallyClosed = false;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const url = this.config.url.replace(/^http/, "ws");
    this.ws = new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });

    this.ws.on("message", (data) => this.handleMessage(data.toString()));

    this.ws.on("error", (err) => {
      if (!this.ready) {
        this.readyReject?.(new Error(`Gateway connection failed: ${err.message}`));
        this.resetConnectState();
      } else {
        for (const [id, p] of this.pending) {
          p.reject(new Error(`Gateway error: ${err.message}`));
          clearTimeout(p.timeout);
          this.pending.delete(id);
        }
      }
    });

    this.ws.on("close", () => {
      const wasPreviouslyReady = this.ready;
      this.resetConnectState();

      for (const [id, p] of this.pending) {
        p.reject(new Error("Gateway connection closed"));
        clearTimeout(p.timeout);
        this.pending.delete(id);
      }

      if (!this.intentionallyClosed && wasPreviouslyReady) {
        this.scheduleReconnect();
      }
    });

    return this.readyPromise;
  }

  private resetConnectState() {
    this.ready = false;
    this.ws = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.connectNonce = null;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      GatewayClient.BACKOFF_BASE * Math.pow(2, this.reconnectAttempt),
      GatewayClient.BACKOFF_MAX,
    );
    this.reconnectAttempt++;
    process.stderr.write(
      `[clawdaemon] gateway disconnected, reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})\n`
    );
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        this.reconnectAttempt = 0;
        process.stderr.write(`[clawdaemon] gateway reconnected successfully\n`);
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private handleMessage(raw: string) {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (frame.type === "event" && frame.event === "connect.challenge") {
      const payload = frame.payload as { nonce: string };
      this.connectNonce = payload.nonce;
      this.sendConnect();
      return;
    }

    if (frame.type === "event") {
      // Ignore other events (ticks, etc.)
      return;
    }

    if (frame.type === "res" || frame.type === "hello-ok") {
      const id = frame.id as string;
      const p = this.pending.get(id);
      if (p) {
        clearTimeout(p.timeout);
        this.pending.delete(id);
        if (frame.ok === false) {
          const err = frame.error as { message?: string; code?: string } | undefined;
          p.reject(new Error(err?.message ?? `Gateway error: ${err?.code ?? "unknown"}`));
        } else {
          p.resolve(frame.payload ?? frame);
        }
      } else if (frame.type === "hello-ok" || (frame as Record<string, unknown>).features) {
        // This is the hello-ok response to our connect request
        this.handleHelloOk(frame);
      }
      return;
    }
  }

  private handleHelloOk(frame: Record<string, unknown>) {
    const features = frame.features as { methods?: string[] } | undefined;
    this.availableMethods = features?.methods ?? [];
    this.ready = true;
    this.reconnectAttempt = 0;
    this.readyResolve?.();
    process.stderr.write(
      `[clawdaemon] connected to gateway (${this.availableMethods.length} methods available)\n`
    );
  }

  private sendConnect() {
    if (!this.ws || !this.connectNonce) return;

    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "openclaw-tui",
        displayName: "ClawDaemon MCP",
        version: "0.1.0",
        platform: process.platform,
        mode: "cli",
      },
      caps: [],
      scopes: ["operator.read", "operator.write", "operator.approvals", "operator.admin"],
      auth: this.config.token ? { token: this.config.token } : undefined,
    };

    const id = randomUUID();
    const frame = { type: "req", id, method: "connect", params };

    const timeout = setTimeout(() => {
      this.pending.delete(id);
      this.readyReject?.(new Error("Gateway connect handshake timed out"));
    }, 15000);

    this.pending.set(id, {
      resolve: (value) => {
        this.handleHelloOk(value as Record<string, unknown>);
      },
      reject: (err) => this.readyReject?.(err),
      timeout,
    });

    this.ws.send(JSON.stringify(frame));
  }

  async request<T = Record<string, unknown>>(method: string, params?: unknown, _retries = 0): Promise<T> {
    if (!this.ready || !this.ws) {
      await this.connect();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (_retries < GatewayClient.MAX_REQUEST_RETRIES) {
        const delay = GatewayClient.BACKOFF_BASE * Math.pow(2, _retries);
        await new Promise((r) => setTimeout(r, delay));
        return this.request<T>(method, params, _retries + 1);
      }
      throw new Error("Gateway not connected");
    }

    const id = randomUUID();
    const frame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timeout for ${method}`));
      }, 30000);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject: (err) => {
          // Retry on connection-level failures
          if (_retries < GatewayClient.MAX_REQUEST_RETRIES && err.message.includes("connection closed")) {
            const delay = GatewayClient.BACKOFF_BASE * Math.pow(2, _retries);
            setTimeout(() => {
              this.request<T>(method, params, _retries + 1).then(resolve, reject);
            }, delay);
          } else {
            reject(err);
          }
        },
        timeout,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  isConnected(): boolean {
    return this.ready && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getMethods(): string[] {
    return this.availableMethods;
  }

  /** Invoke a tool via HTTP POST /tools/invoke (for tools not available over WebSocket) */
  async toolInvoke(tool: string, action: string, args?: Record<string, unknown>): Promise<unknown> {
    const httpUrl = this.config.url.replace(/^ws/, "http");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }
    const body = JSON.stringify({ tool, action, args: args ?? {} });
    const res = await fetch(`${httpUrl}/tools/invoke`, { method: "POST", headers, body });
    const json = await res.json() as Record<string, unknown>;
    if (!res.ok || json.ok === false) {
      const err = json.error as Record<string, string> | undefined;
      throw new Error(err?.message ?? `tools/invoke failed (${res.status})`);
    }
    return json.result;
  }

  close() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ready = false;
    this.ws?.close();
    this.ws = null;
  }
}

function loadTokenFromConfig(): string | undefined {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return config?.gateway?.auth?.token;
  } catch {
    return undefined;
  }
}

// Singleton instance
let client: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient {
  if (!client) {
    client = new GatewayClient();
  }
  return client;
}
