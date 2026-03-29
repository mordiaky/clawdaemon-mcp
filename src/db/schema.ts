import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull(),
  type: text("type").notNull(), // cron-trigger, webhook-hit, message-received, browser-result
  payload: text("payload").notNull(), // JSON string
  contentHash: text("content_hash"),   // SHA-256 of automationId+type+payload for dedup
  acknowledged: integer("acknowledged", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  acknowledgedAt: text("acknowledged_at"),
  expiresAt: text("expires_at").notNull(),
});

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // cron, webhook, monitor
  config: text("config").notNull(), // JSON string — schedule, URL, channel, etc.
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
