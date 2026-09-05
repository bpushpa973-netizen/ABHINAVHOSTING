import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

async function ensureDatabaseSchema() {
  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pool.query("SELECT 1");

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

      // Add any columns that may be missing from an older hosted_bots table.
      const columns = [
        ["user_id", "TEXT"],
        ["name", "TEXT"],
        ["username", "TEXT"],
        ["status", "TEXT"],
        ["runtime", "TEXT"],
        ["entry_file", "TEXT"],
        ["branch", "TEXT"],
        ["version", "TEXT"],
        ["uptime", "TEXT"],
        ["cpu", "TEXT"],
        ["memory", "TEXT"],
        ["color", "TEXT"],
        ["initials", "TEXT"],
        ["requests", "INTEGER"],
        ["object_path", "TEXT"],
        ["file_name", "TEXT"],
        ["file_size", "INTEGER"],
        ["requirements_object_path", "TEXT"],
        ["requirements_file_name", "TEXT"],
        ["runtime_logs", "JSONB"],
        ["created_at", "TIMESTAMPTZ"],
        ["updated_at", "TIMESTAMPTZ"],
      ] as const;

      for (const [column, type] of columns) {
        await pool.query(`ALTER TABLE hosted_bots ADD COLUMN IF NOT EXISTS "${column}" ${type}`);
      }

      return;
    } catch (err) {
      lastError = err;
      const e = err as { message?: string; code?: string; detail?: string; hint?: string };
      logger.error(
        {
          attempt,
          maxAttempts,
          code: e.code,
          message: e.message,
          detail: e.detail,
          hint: e.hint,
          databaseHost: process.env.DATABASE_URL
            ? (() => {
                try {
                  return new URL(process.env.DATABASE_URL).hostname;
                } catch {
                  return "invalid DATABASE_URL";
                }
              })()
            : "missing",
        },
        "Database initialization attempt failed",
      );

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Database initialization failed");
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
