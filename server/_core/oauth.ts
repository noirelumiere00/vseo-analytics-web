import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { hashPassword, verifyPassword } from "./password";
import { sdk } from "./sdk";

export function registerOAuthRoutes(app: Express) {
  /**
   * POST /api/auth/login
   * Password-based local login.
   * Accepts { name, password, email? }.
   * - New user → register with hashed password
   * - Existing user → verify password
   * - Name matches adminName → role: admin
   */
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { name, password, email } = req.body ?? {};

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "名前を入力してください" });
        return;
      }
      if (!password || typeof password !== "string" || password.length === 0) {
        res.status(400).json({ error: "パスワードを入力してください" });
        return;
      }
      if (password.length < 4) {
        res.status(400).json({ error: "パスワードは4文字以上にしてください" });
        return;
      }

      const trimmedName = name.trim();

      // Check if user already exists
      const existingUser = await db.getUserByName(trimmedName);

      if (existingUser) {
        // Verify password
        if (!existingUser.passwordHash) {
          // Legacy user without password — reject (they need to be re-registered)
          res.status(401).json({ error: "パスワードが設定されていません。管理者にお問い合わせください。" });
          return;
        }
        const valid = await verifyPassword(password, existingUser.passwordHash);
        if (!valid) {
          res.status(401).json({ error: "パスワードが正しくありません" });
          return;
        }

        // Update last signed in
        await db.upsertUser({
          openId: existingUser.openId,
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(existingUser.openId, {
          name: trimmedName,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.json({ success: true, openId: existingUser.openId });
      } else {
        // New user registration
        const identifier = email?.trim()
          ? email.trim().toLowerCase()
          : trimmedName.toLowerCase();
        const openId = "local_" + Buffer.from(identifier).toString("base64url");

        const passwordHash = await hashPassword(password);
        const isAdmin = trimmedName === ENV.adminName;

        await db.upsertUser({
          openId,
          name: trimmedName,
          email: email?.trim() || null,
          passwordHash,
          loginMethod: "local",
          role: isAdmin ? "admin" : "user",
          lastSignedIn: new Date(),
        });

        const sessionToken = await sdk.createSessionToken(openId, {
          name: trimmedName,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.json({ success: true, openId });
      }
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "ログインに失敗しました" });
    }
  });

  // Keep legacy callback route for backwards-compatibility (no-op redirect)
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.redirect(302, "/login");
  });
}
