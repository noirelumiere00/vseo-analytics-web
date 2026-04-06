import "dotenv/config";
import path from "path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleWebhookEvent } from "./stripe";
import { ENV, validateRequiredEnv } from "./env";

import { logBuffer } from "../logBuffer";

const MODE = process.env.SERVER_MODE || "all";
// "web"    → Webサーバーのみ
// "worker" → ワーカーのみ
// "all"    → 両方（後方互換、シングルサーバー構成用）

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // インメモリログバッファを初期化（console.log/error/warn をキャプチャ）
  logBuffer.init();

  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https://accounts.google.com", "https://oauth2.googleapis.com", "https://api.stripe.com"],
        frameSrc: ["'self'", "https://accounts.google.com", "https://js.stripe.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://accounts.google.com"],
      },
    },
  }));
  app.use(cors({ origin: ENV.appUrl, credentials: true }));
  const server = createServer(app);

  // Stripe webhook (must be before express.json to get raw body)
  if (ENV.stripeWebhookSecret) {
    app.post("/api/stripe/webhook",
      express.raw({ type: "application/json", limit: "1mb" }),
      async (req, res) => {
        try {
          const sig = req.headers["stripe-signature"] as string;
          await handleWebhookEvent(req.body, sig);
          res.json({ received: true });
        } catch (error) {
          console.error("[Stripe] Webhook error:", error);
          res.status(400).json({ error: "Webhook processing failed" });
        }
      }
    );
  }

  // Body parser
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  // Auth routes
  registerOAuthRoutes(app);
  // tRPC API (with rate limiting)
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(
    "/api/trpc",
    apiLimiter,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // サムネイル画像のローカル配信（CDN期限切れ対策）
  {
    const coversPath = path.resolve(import.meta.dirname, process.env.NODE_ENV === "development" ? "../../data/covers" : "../data/covers");
    app.use("/covers", express.static(coversPath, { maxAge: "30d", immutable: true }));
  }
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}/ (mode: ${MODE})`);
    console.log("[Startup] Puppeteer browser will be initialized on-demand (memory-saving mode)");
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`[Shutdown] Received ${signal}, closing server...`);
    server.close(() => {
      console.log("[Shutdown] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("[Shutdown] Forced exit after timeout");
      process.exit(1);
    }, 30_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main() {
  if (MODE !== "worker") {
    await startServer();
  }
  if (MODE !== "web") {
    const { startWorker } = await import("./worker");
    await startWorker();
  }
}

validateRequiredEnv();
main().catch((err) => {
  console.error("[Fatal] Server startup failed:", err);
  process.exit(1);
});
