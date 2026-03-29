import { randomUUID, createHash } from "crypto";
import { db } from "../db/client.js";
import { events } from "../db/schema.js";
import { eq, and, lte, gte } from "drizzle-orm";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEDUP_WINDOW_MS = parseInt(process.env.CLAWDAEMON_DEDUP_WINDOW_MS ?? "60000", 10); // 60s

function contentHash(automationId: string, type: string, payload: unknown): string {
  return createHash("sha256")
    .update(`${automationId}:${type}:${JSON.stringify(payload)}`)
    .digest("hex");
}

export function pushEvent(automationId: string, type: string, payload: unknown): string | null {
  const hash = contentHash(automationId, type, payload);
  const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

  // Check for duplicate within the dedup window
  const dup = db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.contentHash, hash), gte(events.createdAt, windowStart)))
    .limit(1)
    .all();

  if (dup.length > 0) {
    process.stderr.write(`[clawdaemon] dedup: skipped duplicate event (hash=${hash.slice(0, 12)}…)\n`);
    return null;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const ttlMs = parseTtl(process.env.CLAWDAEMON_EVENT_TTL ?? "7d");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  db.insert(events).values({
    id,
    automationId,
    type,
    payload: JSON.stringify(payload),
    contentHash: hash,
    acknowledged: false,
    createdAt: now,
    expiresAt,
  }).run();

  return id;
}

export function pollEvents(limit = 50): typeof events.$inferSelect[] {
  return db
    .select()
    .from(events)
    .where(eq(events.acknowledged, false))
    .limit(limit)
    .orderBy(events.createdAt)
    .all();
}

export function acknowledgeEvent(eventId: string): boolean {
  const result = db
    .update(events)
    .set({ acknowledged: true, acknowledgedAt: new Date().toISOString() })
    .where(eq(events.id, eventId))
    .run();

  return result.changes > 0;
}

export function getEventHistory(limit = 50, offset = 0) {
  return db
    .select()
    .from(events)
    .limit(limit)
    .offset(offset)
    .orderBy(events.createdAt)
    .all();
}

export function pruneExpiredEvents(): number {
  const now = new Date().toISOString();
  const result = db
    .delete(events)
    .where(and(eq(events.acknowledged, true), lte(events.expiresAt, now)))
    .run();

  return result.changes;
}

function parseTtl(ttl: string): number {
  const match = ttl.match(/^(\d+)(d|h|m)$/);
  if (!match) return DEFAULT_TTL_MS;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "d": return value * 24 * 60 * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "m": return value * 60 * 1000;
    default: return DEFAULT_TTL_MS;
  }
}
