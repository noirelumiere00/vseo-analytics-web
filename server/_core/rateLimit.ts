import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "ログイン試行回数の上限に達しました。しばらくお待ちください。" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: "パスワードリセットの試行回数の上限に達しました。しばらくお待ちください。" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "登録の試行回数の上限に達しました。しばらくお待ちください。" },
  standardHeaders: true,
  legacyHeaders: false,
});
