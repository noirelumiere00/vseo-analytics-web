/**
 * クライアント側のトークン検証ユーティリティ
 * サーバー側の exportToken.ts と同期して動作
 */

interface ExportToken {
  token: string;
  jobId: number;
  userId: number;
  expiresAt: Date;
}

// クライアント側のメモリ内トークンストア
const clientTokenStore = new Map<string, ExportToken>();

/**
 * クライアント側でトークンを検証
 * @param token 検証するトークン
 * @returns { jobId, userId } または null（無効な場合）
 */
export function verifyExportToken(
  token: string
): { jobId: number; userId: number } | null {
  const exportToken = clientTokenStore.get(token);

  if (!exportToken) {
    return null;
  }

  // 有効期限チェック
  if (new Date() > new Date(exportToken.expiresAt)) {
    clientTokenStore.delete(token);
    return null;
  }

  // トークンは一度使用したら削除（リプレイ攻撃対策）
  clientTokenStore.delete(token);

  return {
    jobId: exportToken.jobId,
    userId: exportToken.userId,
  };
}

/**
 * トークンを保存（サーバーから受け取った後に呼び出し）
 * @param token トークン文字列
 * @param jobId ジョブID
 * @param userId ユーザーID
 * @param expirationSeconds 有効期限（秒）
 */
export function storeExportToken(
  token: string,
  jobId: number,
  userId: number,
  expirationSeconds: number = 600
): void {
  const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

  clientTokenStore.set(token, {
    token,
    jobId,
    userId,
    expiresAt,
  });

  // 有効期限切れのトークンを定期的にクリーンアップ
  setTimeout(() => {
    clientTokenStore.delete(token);
  }, expirationSeconds * 1000 + 5000);
}

/**
 * 全トークンをクリア（テスト用）
 */
export function clearAllTokens(): void {
  clientTokenStore.clear();
}
