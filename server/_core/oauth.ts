import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { nanoid } from "nanoid";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { hashPassword, verifyPassword } from "./password";
import { sdk } from "./sdk";
import { authLimiter, registerLimiter, forgotPasswordLimiter } from "./rateLimit";
import { sendPasswordResetEmail } from "./email";
import { getGoogleAuthUrl, exchangeCodeForTokens, getGoogleUserInfo } from "./google";
import { SignJWT, jwtVerify } from "jose";

function getStateSecret() {
  if (!ENV.cookieSecret) {
    throw new Error("FATAL: JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

async function signState(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("10m")
    .sign(getStateSecret());
}

async function verifyState(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, getStateSecret());
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function registerOAuthRoutes(app: Express) {
  /**
   * POST /api/auth/login
   * Email or name-based login with password.
   */
  app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
    try {
      const { name, password } = req.body ?? {};

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "メールアドレスまたは名前を入力してください" });
        return;
      }
      if (!password || typeof password !== "string" || password.length === 0) {
        res.status(400).json({ error: "パスワードを入力してください" });
        return;
      }

      const trimmed = name.trim();

      // If input contains @, search by email; otherwise search by name (fallback)
      let existingUser;
      if (trimmed.includes("@")) {
        existingUser = await db.getUserByEmail(trimmed);
      } else {
        existingUser = await db.getUserByName(trimmed);
      }

      if (!existingUser) {
        res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
        return;
      }

      if (!existingUser.passwordHash) {
        res.status(401).json({ error: "パスワードが設定されていません。Googleログインをお試しください。" });
        return;
      }

      const valid = await verifyPassword(password, existingUser.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
        return;
      }

      await db.upsertUser({ openId: existingUser.openId, lastSignedIn: new Date() });

      const sessionToken = await sdk.createSessionToken(existingUser.openId, {
        name: existingUser.name || trimmed,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "ログインに失敗しました" });
    }
  });

  /**
   * POST /api/auth/register
   * Self-service registration with email/password.
   */
  app.post("/api/auth/register", registerLimiter, async (req: Request, res: Response) => {
    try {
      const { email, name, password, tosAccepted } = req.body ?? {};

      // Validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || typeof email !== "string" || !emailRegex.test(email) || email.length > 320) {
        res.status(400).json({ error: "有効なメールアドレスを入力してください" });
        return;
      }
      if (!name || typeof name !== "string" || name.trim().length === 0 || name.trim().length > 100) {
        res.status(400).json({ error: "名前を1〜100文字で入力してください" });
        return;
      }
      if (!password || typeof password !== "string" || password.length < 8 || password.length > 128) {
        res.status(400).json({ error: "パスワードは8〜128文字にしてください" });
        return;
      }
      if (!tosAccepted) {
        res.status(400).json({ error: "利用規約に同意してください" });
        return;
      }

      // Duplicate check
      const existing = await db.getUserByEmail(email.trim().toLowerCase());
      if (existing) {
        res.status(409).json({ error: "このメールアドレスは既に登録されています" });
        return;
      }

      const openId = nanoid();
      const passwordHash = await hashPassword(password);

      await db.createUser({
        openId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        loginMethod: "email",
        emailVerified: 0,
        tosAcceptedAt: new Date(),
      });

      // Get created user to obtain userId
      const newUser = await db.getUserByOpenId(openId);
      if (newUser) {
        await db.upsertSubscription({ userId: newUser.id, plan: "free", status: "active" });
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: name.trim(),
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Register failed", error);
      res.status(500).json({ error: "登録に失敗しました" });
    }
  });

  /**
   * POST /api/auth/forgot-password
   * Always returns success to prevent email enumeration.
   */
  app.post("/api/auth/forgot-password", forgotPasswordLimiter, async (req: Request, res: Response) => {
    try {
      const { email } = req.body ?? {};
      // Always return success
      res.json({ success: true, message: "リセットメールを送信しました" });

      if (!email || typeof email !== "string") return;
      const user = await db.getUserByEmail(email.trim().toLowerCase());
      if (!user) return;

      // Invalidate existing tokens
      await db.invalidateUserResetTokens(user.id);

      // Generate token
      const token = crypto.randomBytes(48).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.createPasswordResetToken(user.id, token, expiresAt);

      const resetUrl = `${ENV.appUrl}/reset-password?token=${token}`;
      await sendPasswordResetEmail(email.trim().toLowerCase(), resetUrl);
    } catch (error) {
      console.error("[Auth] Forgot password error", error);
      // Already sent success response
    }
  });

  /**
   * POST /api/auth/reset-password
   * Validates token and updates password.
   */
  app.post("/api/auth/reset-password", authLimiter, async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body ?? {};

      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "無効なリセットリンクです" });
        return;
      }
      if (!password || typeof password !== "string" || password.length < 8 || password.length > 128) {
        res.status(400).json({ error: "パスワードは8〜128文字にしてください" });
        return;
      }

      const record = await db.consumePasswordResetToken(token);
      if (!record) {
        res.status(400).json({ error: "リセットリンクが無効または期限切れです" });
        return;
      }

      const passwordHash = await hashPassword(password);
      await db.updateUserPassword(record.userId, passwordHash);

      res.json({ success: true, message: "パスワードを更新しました" });
    } catch (error) {
      console.error("[Auth] Reset password failed", error);
      res.status(500).json({ error: "パスワードリセットに失敗しました" });
    }
  });

  /**
   * GET /api/auth/google
   * Redirects to Google OAuth consent screen.
   */
  app.get("/api/auth/google", async (req: Request, res: Response) => {
    try {
      const tosAccepted = req.query.tosAccepted === "true";
      const nonce = crypto.randomBytes(16).toString("hex");

      const state = await signState({ nonce, tosAccepted });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie("google_oauth_state", nonce, {
        ...cookieOptions,
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      const authUrl = getGoogleAuthUrl(state);
      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[Auth] Google redirect failed", error);
      res.redirect(302, "/login?error=google_auth_failed");
    }
  });

  /**
   * GET /api/auth/google/callback
   * Handles Google OAuth callback.
   */
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    try {
      const { code, state: stateParam } = req.query;

      if (!code || !stateParam || typeof code !== "string" || typeof stateParam !== "string") {
        res.redirect(302, "/login?error=invalid_callback");
        return;
      }

      // Verify state (CSRF protection)
      const statePayload = await verifyState(stateParam);
      if (!statePayload) {
        res.redirect(302, "/login?error=invalid_state");
        return;
      }

      // Verify nonce from cookie
      const cookies = req.headers.cookie?.split(";").reduce((acc, c) => {
        const [k, v] = c.trim().split("=");
        acc[k] = v;
        return acc;
      }, {} as Record<string, string>) ?? {};

      if (cookies.google_oauth_state !== statePayload.nonce) {
        res.redirect(302, "/login?error=csrf_mismatch");
        return;
      }

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);
      const userInfo = await getGoogleUserInfo(tokens.access_token);

      // Clear state cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie("google_oauth_state", cookieOptions);

      // Try to find existing user
      let user = await db.getUserByGoogleId(userInfo.googleId);

      if (!user) {
        // Try by email
        user = await db.getUserByEmail(userInfo.email);
        if (user) {
          // Link Google account
          await db.linkGoogleAccount(user.id, userInfo.googleId);
          if (!user.tosAcceptedAt && statePayload.tosAccepted) {
            await db.setTosAccepted(user.id);
          }
        }
      }

      if (!user) {
        // New user
        if (!statePayload.tosAccepted) {
          res.redirect(302, "/login?error=tos_required");
          return;
        }

        const openId = nanoid();
        await db.createUser({
          openId,
          name: userInfo.name,
          email: userInfo.email,
          googleId: userInfo.googleId,
          emailVerified: 1,
          loginMethod: "google",
          tosAcceptedAt: new Date(),
        });

        user = await db.getUserByOpenId(openId);
        if (user) {
          await db.upsertSubscription({ userId: user.id, plan: "free", status: "active" });
        }
      }

      if (!user) {
        res.redirect(302, "/login?error=user_creation_failed");
        return;
      }

      // Update last sign in
      await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || userInfo.name,
        expiresInMs: ONE_YEAR_MS,
      });

      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Auth] Google callback failed", error);
      res.redirect(302, "/login?error=google_callback_failed");
    }
  });

  // Keep legacy callback route for backwards-compatibility (no-op redirect)
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.redirect(302, "/login");
  });
}
