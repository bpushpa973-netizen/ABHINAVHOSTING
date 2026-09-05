import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hosted_bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      runtime TEXT NOT NULL,
      entry_file TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      version TEXT NOT NULL DEFAULT 'v0.1.0',
      uptime TEXT NOT NULL DEFAULT '—',
      cpu TEXT NOT NULL DEFAULT '—',
      memory TEXT NOT NULL DEFAULT '—',
      color TEXT NOT NULL DEFAULT '#9b74d5',
      initials TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      object_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      requirements_object_path TEXT,
      requirements_file_name TEXT,
      runtime_logs JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  await ensureDatabaseSchema();
  logger.info("Database schema ready");
} catch (err) {
  logger.error({ err }, "Failed to initialize database schema");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
