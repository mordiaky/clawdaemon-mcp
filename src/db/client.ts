import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";
import * as schema from "./schema.js";

const dbDir = path.join(os.homedir(), ".clawdaemon");
const dbPath = process.env.CLAWDAEMON_DB ?? path.join(dbDir, "events.db");

if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const sqlite: BetterSqlite3.Database = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Auto-create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    content_hash TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Migrate: add content_hash column if missing (existing DBs)
try {
  sqlite.exec(`ALTER TABLE events ADD COLUMN content_hash TEXT`);
} catch {
  // Column already exists — ignore
}

export const db = drizzle(sqlite, { schema });
export { sqlite };
