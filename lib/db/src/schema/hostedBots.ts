import { jsonb, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const hostedBotsTable = pgTable("hosted_bots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  username: text("username").notNull(),
  status: text("status").notNull().default("offline"),
  runtime: text("runtime").notNull(),
  entryFile: text("entry_file").notNull(),
  branch: text("branch").notNull().default("main"),
  version: text("version").notNull().default("v0.1.0"),
  uptime: text("uptime").notNull().default("—"),
  cpu: text("cpu").notNull().default("—"),
  memory: text("memory").notNull().default("—"),
  color: text("color").notNull().default("#9b74d5"),
  initials: text("initials").notNull(),
  requests: integer("requests").notNull().default(0),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  requirementsObjectPath: text("requirements_object_path"),
  requirementsFileName: text("requirements_file_name"),
  runtimeLogs: jsonb("runtime_logs").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type HostedBot = typeof hostedBotsTable.$inferSelect;
export type NewHostedBot = typeof hostedBotsTable.$inferInsert;