import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Clerk authentication is required for API routes only.
// Do NOT run clerkMiddleware on the whole app: doing so makes Clerk
// redirect public/browser requests to its Frontend API handshake, which
// results in a blank page on Railway for development instances.
app.use(
  "/api",
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  }),
  router,
);

// Serve the built React app from the same Railway service.
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../telegram-bot-hosting/dist/public");
app.use(express.static(publicDir, { index: "index.html" }));
app.get(/.*/, (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"), (error) => {
    if (error) next(error);
  });
});

export default app;
