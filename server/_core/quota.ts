import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const PLAN_LIMITS: Record<string, number> = {
  free: 3,
  pro: 30,
  business: Infinity,
};

export async function getMonthlyUsage(userId: number) {
  const sub = await db.getSubscriptionByUserId(userId);
  const plan = sub?.plan ?? "free";
  const limit = PLAN_LIMITS[plan] ?? 3;

  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const used = await db.countMonthlyJobs(userId, since);

  return { used, limit, plan };
}

export async function checkQuota(userId: number): Promise<void> {
  // admin ロールは無制限
  const user = await db.getUserById(userId);
  if (user?.role === "admin") return;

  const { used, limit, plan } = await getMonthlyUsage(userId);

  if (used >= limit) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `月間利用上限（${limit}回）に達しました。プランをアップグレードしてください。`,
    });
  }
}
