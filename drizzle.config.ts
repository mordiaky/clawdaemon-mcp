import { defineConfig } from "drizzle-kit";
import path from "path";
import os from "os";

const dbPath = process.env.CLAWDAEMON_DB ?? path.join(os.homedir(), ".clawdaemon", "events.db");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: dbPath,
  },
});
