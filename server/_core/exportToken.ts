import crypto from "crypto";

interface ExportToken {
  token: string;
  jobId: number;
  userId: number;
  expiresAt: Date;
}

// メモリ内トークンストア（本番環境ではRedis推奨）
const tokenStore = new Map<string, ExportToken>();

/**
 * PDF エクスポート用の短命トークンを生成
 * @param jobId 分析ジョブID
 * @param userId ユーザーID
 * @param expirationSeconds トークンの有効期限（秒、デフォルト10分）
 * @returns 生成されたトークン
 */
export function generateExportToken(
  jobId: number,
  userId: number,
  expirationSeconds: number = 600 // 10分
): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

  tokenStore.set(token, {
    token,
    jobId,
    userId,
    expiresAt,
  });

  // 有効期限切れのトークンを定期的にクリーンアップ
  setTimeout(() => {
    tokenStore.delete(token);
  }, expirationSeconds * 1000 + 5000); // 5秒余裕を持たせる

  return token;
}

/**
 * トークンを検証し、有効な場合はジョブIDとユーザーIDを返す
 * @param token 検証するトークン
 * @returns { jobId, userId } または null（無効な場合）
 */
export function verifyExportToken(
  token: string
): { jobId: number; userId: number } | null {
  const exportToken = tokenStore.get(token);

  if (!exportToken) {
    return null;
  }

  // 有効期限チェック
  if (new Date() > exportToken.expiresAt) {
    tokenStore.delete(token);
    return null;
  }

  // トークンは一度使用したら削除（リプレイ攻撃対策）
  tokenStore.delete(token);

  return {
    jobId: exportToken.jobId,
    userId: exportToken.userId,
  };
}

/**
 * 全トークンをクリア（テスト用）
 */
export function clearAllTokens(): void {
  tokenStore.clear();
}
