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

export const db = drizzle(sqlite, { schema });
export { sqlite };
