import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, hostedBotsTable } from "@workspace/db";
import { fetchStoredObject } from "./storage";

const execFileAsync = promisify(execFile);
const router: IRouter = Router();
type BotJob = {
  userId: string;
  status: "starting" | "online" | "offline" | "error";
  logs: string[];
  process?: ChildProcessWithoutNullStreams;
  workDir?: string;
};
const jobs = new Map<string, BotJob>();

function getUserId(req: Request): string | null {
  if (!("auth" in req) || typeof req.auth !== "function") return null;
  return req.auth().userId ?? null;
}

function addLog(job: { logs: string[] }, message: string) {
  job.logs = [...job.logs, `${new Date().toISOString().slice(11, 19)} ${message}`].slice(-120);
}

function validateFileName(value: unknown, extension: string): string | null {
  if (typeof value !== "string" || basename(value) !== value || !value.endsWith(extension)) return null;
  return value;
}

function getBotId(req: Request): string {
  const value = req.params.botId;
  return Array.isArray(value) ? value[0] : value;
}

async function getOwnedBot(botId: string, userId: string) {
  const [bot] = await db.select().from(hostedBotsTable).where(and(eq(hostedBotsTable.id, botId), eq(hostedBotsTable.userId, userId)));
  return bot;
}

async function saveJob(botId: string, job: BotJob) {
  await db.update(hostedBotsTable)
    .set({ status: job.status === "starting" ? "deploying" : job.status, runtimeLogs: job.logs })
    .where(and(eq(hostedBotsTable.id, botId), eq(hostedBotsTable.userId, job.userId)));
}

router.get("/bots", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Sign in is required to view bots." }); return; }
  const bots = await db.select().from(hostedBotsTable).where(eq(hostedBotsTable.userId, userId));
  res.json(bots);
});

router.post("/bots", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Sign in is required to save a bot." }); return; }
  const body = req.body ?? {};
  const runtime = body.runtime === "Python" || body.runtime === "Java" ? body.runtime : null;
  const entryFile = validateFileName(body.entryFile, runtime === "Python" ? ".py" : ".java");
  if (typeof body.id !== "string" || !body.id || typeof body.name !== "string" || !body.name.trim() ||
      typeof body.username !== "string" || !body.username.trim() || !runtime || !entryFile ||
      typeof body.objectPath !== "string" || !body.objectPath.startsWith("/objects/uploads/") ||
      typeof body.fileName !== "string" || typeof body.fileSize !== "number") {
    res.status(400).json({ error: "Bot name, username, runtime, run file, and stored source file are required." });
    return;
  }
  if (body.requirementsObjectPath != null && (typeof body.requirementsObjectPath !== "string" || !body.requirementsObjectPath.startsWith("/objects/uploads/"))) {
    res.status(400).json({ error: "Invalid requirements file path." });
    return;
  }
  try {
    const [bot] = await db.insert(hostedBotsTable).values({
      id: body.id,
      userId,
      name: body.name.trim().slice(0, 120),
      username: body.username.trim().replace(/^@/, "").slice(0, 120),
      runtime,
      entryFile,
      initials: typeof body.initials === "string" && body.initials ? body.initials.slice(0, 2) : body.name.trim().slice(0, 2).toUpperCase(),
      color: typeof body.color === "string" ? body.color : "#9b74d5",
      objectPath: body.objectPath,
      fileName: body.fileName,
      fileSize: Math.max(0, Math.round(body.fileSize)),
      requirementsObjectPath: body.requirementsObjectPath ?? null,
      requirementsFileName: typeof body.requirementsFileName === "string" ? body.requirementsFileName : null,
      runtimeLogs: [],
    }).returning();
    res.status(201).json(bot);
  } catch (error) {
    req.log.error({ err: error }, "Error saving hosted bot");
    res.status(409).json({ error: "Could not save this bot. Try a different bot id." });
  }
});

router.patch("/bots/:botId", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Sign in is required to update a bot." }); return; }
  const botId = getBotId(req);
  const current = await getOwnedBot(botId, userId);
  if (!current) { res.status(404).json({ error: "Bot not found." }); return; }
  const status = ["online", "deploying", "offline", "error"].includes(req.body?.status) ? req.body.status : current.status;
  const runtimeLogs = Array.isArray(req.body?.runtimeLogs) ? req.body.runtimeLogs.filter((item: unknown): item is string => typeof item === "string").slice(-120) : current.runtimeLogs;
  const [bot] = await db.update(hostedBotsTable).set({ status, runtimeLogs }).where(and(eq(hostedBotsTable.id, botId), eq(hostedBotsTable.userId, userId))).returning();
  res.json(bot);
});

router.delete("/bots/:botId", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Sign in is required to delete a bot." }); return; }
  const botId = getBotId(req);
  const job = jobs.get(botId);
  if (job?.userId === userId && job.process && !job.process.killed) job.process.kill("SIGTERM");
  const [bot] = await db.delete(hostedBotsTable).where(and(eq(hostedBotsTable.id, botId), eq(hostedBotsTable.userId, userId))).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found." }); return; }
  jobs.delete(botId);
  res.status(204).end();
});

router.post("/bots/run", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in is required to run a bot." });
    return;
  }

  const { botId } = req.body ?? {};
  if (typeof botId !== "string" || !botId) {
    res.status(400).json({ error: "Bot id is required." });
    return;
  }
  const storedBot = await getOwnedBot(botId, userId);
  if (!storedBot) { res.status(404).json({ error: "Bot not found in your workspace." }); return; }
  const runtime = storedBot.runtime === "Python" || storedBot.runtime === "Java" ? storedBot.runtime : null;
  const entryFile = storedBot.entryFile;
  const sourceObjectPath = storedBot.objectPath;
  const requirementsObjectPath = storedBot.requirementsObjectPath;
  if (!runtime) { res.status(400).json({ error: "This bot has an unsupported runtime." }); return; }
  const extension = runtime === "Python" ? ".py" : ".java";
  const safeEntryFile = validateFileName(entryFile, extension);
  if (!safeEntryFile || typeof sourceObjectPath !== "string") {
    res.status(400).json({ error: `The run file must be a single ${extension} file.` });
    return;
  }
  const existing = jobs.get(botId);
  if (existing && existing.userId !== userId) {
    res.status(403).json({ error: "This bot belongs to another workspace." });
    return;
  }
  if (existing?.userId === userId && (existing.status === "starting" || existing.status === "online")) {
    res.status(409).json({ error: "This bot is already running.", status: existing.status, logs: existing.logs });
    return;
  }

  const job: BotJob = { userId, status: "starting", logs: [] };
  jobs.set(botId, job);
  addLog(job, `starting ${runtime} ${safeEntryFile}`);
  await saveJob(botId, job);
  try {
    const source = await fetchStoredObject(sourceObjectPath);
    const workDir = await mkdtemp(join(tmpdir(), "abhinav-bot-"));
    job.workDir = workDir;
    await writeFile(join(workDir, safeEntryFile), source);

    let command = runtime === "Python" ? "python3" : "java";
    let args: string[] = [];
    if (runtime === "Python") {
      if (requirementsObjectPath != null) {
        if (typeof requirementsObjectPath !== "string") throw new Error("Invalid requirements file path.");
        const requirements = await fetchStoredObject(requirementsObjectPath);
        await writeFile(join(workDir, "requirements.txt"), requirements);
        addLog(job, "installing Python packages from requirements.txt");
        const venvDir = join(workDir, ".venv");
        await execFileAsync("python3", ["-m", "venv", venvDir], { cwd: workDir, timeout: 120_000 });
        command = join(venvDir, "bin", "python");
        const isolatedPipEnv = {
          ...process.env,
          PIP_CONFIG_FILE: "/dev/null",
          PIP_USER: "false",
          PYTHONNOUSERSITE: "1",
          PYTHONPATH: "",
        };
        await execFileAsync(command, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"], { cwd: workDir, env: isolatedPipEnv, timeout: 180_000 });
        addLog(job, "requirements.txt installed");
      }
      args = [safeEntryFile];
    } else {
      addLog(job, "compiling Java source");
      await execFileAsync("javac", [safeEntryFile], { cwd: workDir, timeout: 120_000 });
      command = "java";
      args = [safeEntryFile.replace(/\.java$/, "")];
    }

    const child = spawn(command, args, { cwd: workDir, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    job.process = child;
    job.status = "online";
    addLog(job, `process online · pid=${child.pid ?? "unknown"}`);
    void saveJob(botId, job).catch((error) => req.log.error({ err: error }, "Error saving bot runtime state"));
    child.stdout.on("data", (chunk: Buffer) => { addLog(job, chunk.toString().trimEnd()); void saveJob(botId, job); });
    child.stderr.on("data", (chunk: Buffer) => { addLog(job, `[stderr] ${chunk.toString().trimEnd()}`); void saveJob(botId, job); });
    child.on("error", (error) => { job.status = "error"; addLog(job, `[error] ${error.message}`); void saveJob(botId, job); });
    child.on("exit", (code, signal) => {
      if (job.status !== "error") job.status = code === 0 ? "offline" : "error";
      addLog(job, `process exited · code=${code ?? "none"} signal=${signal ?? "none"}`);
      void saveJob(botId, job);
      void rm(job.workDir ?? "", { recursive: true, force: true }).catch(() => undefined);
      job.workDir = undefined;
    });
    res.status(202).json({ status: job.status, logs: job.logs });
  } catch (error) {
    job.status = "error";
    addLog(job, `[error] ${error instanceof Error ? error.message : "Could not start bot."}`);
    await saveJob(botId, job);
    await rm(job.workDir ?? "", { recursive: true, force: true }).catch(() => undefined);
    res.status(422).json({ error: "Bot could not start.", status: job.status, logs: job.logs });
  }
});

router.get("/bots/:botId/runtime", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Sign in is required to view bot runtime." }); return; }
  const botId = getBotId(req);
  const job = jobs.get(botId);
  if (job && job.userId === userId) { res.json({ status: job.status, logs: job.logs }); return; }
  const bot = await getOwnedBot(botId, userId);
  if (!bot) { res.status(404).json({ error: "Bot runtime not found.", status: "offline", logs: [] }); return; }
  res.json({ status: bot.status, logs: bot.runtimeLogs });
});

router.post("/bots/:botId/stop", async (req: Request, res: Response): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Sign in is required to stop a bot." }); return; }
  const botId = getBotId(req);
  const job = jobs.get(botId);
  const bot = await getOwnedBot(botId, userId);
  if (!bot) { res.status(404).json({ error: "Bot runtime not found." }); return; }
  if (!job || job.userId !== userId) {
    await db.update(hostedBotsTable).set({ status: "offline" }).where(and(eq(hostedBotsTable.id, botId), eq(hostedBotsTable.userId, userId)));
    res.json({ status: "offline", logs: bot.runtimeLogs });
    return;
  }
  if (job.process && !job.process.killed) job.process.kill("SIGTERM");
  job.status = "offline";
  addLog(job, "process stopped by user");
  await saveJob(botId, job);
  res.json({ status: job.status, logs: job.logs });
});

export default router;