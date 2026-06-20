/**
 * 開発用ユーザーを seed する（Google OAuth 不要のローカルログイン用）。
 *
 * - email/password ログインができる admin ユーザーを1人作成する。
 * - role=admin なので quota チェックを回避（分析を何回でも実行可能）。
 * - subscriptions に business プランを1行作成する。
 * - 冪等: 既に同じ email のユーザーがいれば何もしない。
 *
 * 実行: pnpm seed:dev-user
 *   DEV_USER_EMAIL / DEV_USER_PASSWORD で上書き可能。
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { users, subscriptions } from "../drizzle/schema";
import { hashPassword } from "../server/_core/password";

const DEV_EMAIL = process.env.DEV_USER_EMAIL || "dev@local.test";
const DEV_PASSWORD = process.env.DEV_USER_PASSWORD || "devpassword123";
const DEV_NAME = process.env.DEV_USER_NAME || "Dev User";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[seed] DATABASE_URL が未設定です（.env を確認してください）");
    process.exit(1);
  }

  const db = drizzle(url);

  const existing = await db.select().from(users).where(eq(users.email, DEV_EMAIL));
  if (existing.length > 0) {
    console.log(`[seed] dev user は既に存在します (id=${existing[0].id}, ${DEV_EMAIL})`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);
  const openId = `dev-${Date.now()}`;

  await db.insert(users).values({
    openId,
    name: DEV_NAME,
    email: DEV_EMAIL,
    passwordHash,
    loginMethod: "email",
    emailVerified: 1,
    tosAcceptedAt: new Date(),
    role: "admin",
  });

  const [created] = await db.select().from(users).where(eq(users.email, DEV_EMAIL));

  await db.insert(subscriptions).values({
    userId: created.id,
    plan: "business",
    status: "active",
  });

  console.log("[seed] dev user を作成しました:");
  console.log(`        id=${created.id}  email=${DEV_EMAIL}  password=${DEV_PASSWORD}`);
  console.log("        role=admin / plan=business（quota 無制限）");
  console.log("        → /login からこの email/password でログインできます");
  process.exit(0);
}

main().catch((e) => {
  console.error("[seed] 失敗:", e);
  process.exit(1);
});
