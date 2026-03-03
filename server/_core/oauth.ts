import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

export function registerOAuthRoutes(app: Express) {
  /**
   * POST /api/auth/login
   * Standalone local login – replaces external Manus OAuth.
   * Accepts { name, email? } and creates a session.
   */
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { name, email } = req.body ?? {};

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      // Derive a stable openId from the name (+ optional email).
      // For a simple standalone setup we hash the name to create a
      // deterministic identifier so the same person gets the same account.
      const identifier = email?.trim()
        ? email.trim().toLowerCase()
        : name.trim().toLowerCase();

      // Simple deterministic openId: prefix + base64 of identifier
      const openId = "local_" + Buffer.from(identifier).toString("base64url");

      await db.upsertUser({
        openId,
        name: name.trim(),
        email: email?.trim() || null,
        loginMethod: "local",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: name.trim(),
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, openId });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Keep legacy callback route for backwards-compatibility (no-op redirect)
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.redirect(302, "/login");
  });
}
