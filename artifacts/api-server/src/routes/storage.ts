import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function getUserId(req: Request): string | null {
  if (!("auth" in req) || typeof req.auth !== "function") return null;
  return req.auth().userId ?? null;
}

function getStorageDir(): string {
  return process.env.STORAGE_DIR || "/data/uploads";
}

function safeIdFromPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const match = normalized.match(/^\/objects\/uploads\/([a-f0-9-]+)$/i);
  if (!match) throw new Error("Invalid stored object path");
  return match[1];
}

function filePath(objectId: string): string {
  const root = resolve(getStorageDir());
  const target = resolve(join(root, objectId));
  if (!target.startsWith(`${root}/`)) throw new Error("Invalid storage path");
  return target;
}

export async function fetchStoredObject(objectPath: string): Promise<Buffer> {
  return readFile(filePath(safeIdFromPath(objectPath)));
}

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!getUserId(req)) {
    res.status(401).json({ error: "Sign in is required to upload a bot file." });
    return;
  }

  const { name, size, contentType } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || typeof size !== "number" || size <= 0) {
    res.status(400).json({ error: "File name and size are required." });
    return;
  }
  if (size > MAX_FILE_SIZE) {
    res.status(413).json({ error: "Bot files must be smaller than 25 MB." });
    return;
  }

  try {
    await mkdir(getStorageDir(), { recursive: true });
    const objectId = randomUUID();
    const objectPath = `/objects/uploads/${objectId}`;
    // The browser uploads directly to this Railway app using the returned URL.
    res.json({
      uploadURL: `${req.protocol}://${req.get("host")}/api/storage/objects/${objectId}`,
      objectPath,
      metadata: {
        name: name.trim(),
        size,
        contentType: typeof contentType === "string" ? contentType : "application/octet-stream",
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Error preparing local storage upload");
    res.status(500).json({ error: "Could not prepare file storage." });
  }
});

router.put("/storage/objects/:objectId", async (req: Request, res: Response) => {
  if (!getUserId(req)) {
    res.status(401).json({ error: "Sign in is required to upload bot files." });
    return;
  }
  try {
    const objectId = safeIdFromPath(`/objects/uploads/${req.params.objectId}`);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_FILE_SIZE) {
        res.status(413).json({ error: "Bot files must be smaller than 25 MB." });
        return;
      }
      chunks.push(buffer);
    }
    await mkdir(getStorageDir(), { recursive: true });
    await writeFile(filePath(objectId), Buffer.concat(chunks));
    res.status(201).json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Error writing uploaded bot file");
    res.status(500).json({ error: "Could not save bot file." });
  }
});

router.get("/storage/objects/:objectId", async (req: Request, res: Response) => {
  if (!getUserId(req)) {
    res.status(401).json({ error: "Sign in is required to access bot files." });
    return;
  }
  try {
    const data = await readFile(filePath(safeIdFromPath(`/objects/uploads/${req.params.objectId}`)));
    res.type("application/octet-stream").send(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ error: "Bot file not found." });
      return;
    }
    req.log.error({ err: error }, "Error serving stored bot file");
    res.status(500).json({ error: "Could not read bot file." });
  }
});

router.delete("/storage/objects/:objectId", async (req: Request, res: Response) => {
  if (!getUserId(req)) {
    res.status(401).json({ error: "Sign in is required to delete bot files." });
    return;
  }
  try {
    await unlink(filePath(safeIdFromPath(`/objects/uploads/${req.params.objectId}`))).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Error deleting stored bot file");
    res.status(500).json({ error: "Could not delete bot file." });
  }
});

export default router;
