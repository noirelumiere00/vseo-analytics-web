/**
 * trust-egress-ca.ts — クラウド(このコンテナ)の Chromium に egress gateway の CA を“正しく信頼”させる。
 *
 * なぜ: このコンテナの egress は Anthropic Egress Gateway が TLS を再署名する。その CA は OS の
 * トラストバンドル（/etc/ssl/certs/ca-certificates.crt）に入っているので curl / Node fetch は検証OKだが、
 * Chromium(Linux) は自前の NSS DB（~/.pki/nssdb）で検証するため CA を知らず ERR_CERT_AUTHORITY_INVALID に
 * なり Puppeteer が 0 件になる。→ その CA を NSS DB にも import すれば、TLS 検証を“無効化せず”に通る。
 *
 * 使い方: npx tsx scripts/trust-egress-ca.ts
 * （冪等。Linux 以外（Mac 等）では何もしない。scrape-ig-ranking から ensureEgressCaTrusted() でも呼ぶ）
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}
function trySh(cmd: string): string | null {
  try {
    return sh(cmd);
  } catch {
    return null;
  }
}

/** Chromium の NSS DB に egress CA を import 済みにする（冪等・Linux のみ）。戻り値=実施したか */
export function ensureEgressCaTrusted(opts: { verbose?: boolean } = {}): boolean {
  const log = (m: string) => opts.verbose && console.log(m);
  if (process.platform !== "linux") {
    log("[trust-egress-ca] Linux 以外のため何もしません（Mac 等は egress 傍受なし）");
    return false;
  }

  const home = process.env.HOME || os.homedir();
  const nssdb = path.join(home, ".pki", "nssdb");

  // certutil（libnss3-tools）が必要
  let hasCertutil = !!trySh("command -v certutil");
  if (!hasCertutil) {
    log("[trust-egress-ca] certutil 不在 → libnss3-tools を導入します…");
    trySh("apt-get update -y >/dev/null 2>&1 && apt-get install -y libnss3-tools >/dev/null 2>&1");
    hasCertutil = !!trySh("command -v certutil");
  }
  if (!hasCertutil) {
    console.warn("[trust-egress-ca] certutil を用意できませんでした（apt 不可）。SPKI-pin フォールバックを検討してください。");
    return false;
  }

  // 既に import 済みなら冪等スキップ
  fs.mkdirSync(nssdb, { recursive: true });
  if (!fs.existsSync(path.join(nssdb, "cert9.db"))) {
    trySh(`certutil -N --empty-password -d sql:${nssdb}`);
  }
  const existing = trySh(`certutil -L -d sql:${nssdb}`) || "";
  if (existing.includes("egress-ca-")) {
    log("[trust-egress-ca] 既に egress CA を信頼済み（スキップ）");
    return true;
  }

  // 生きている接続から CA chain を取得（leaf 以外＝CA を採用）
  const chain =
    trySh(
      "echo | openssl s_client -connect www.instagram.com:443 -servername www.instagram.com -showcerts 2>/dev/null",
    ) || "";
  const pems = chain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  if (pems.length <= 1) {
    console.warn("[trust-egress-ca] CA chain を取得できませんでした（傍受なし環境かもしれません）");
    return false;
  }

  let imported = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "egress-ca-"));
  // index 0 = leaf。1 以降が中間/ルート CA。
  for (let i = 1; i < pems.length; i++) {
    const pemPath = path.join(tmp, `ca-${i}.pem`);
    fs.writeFileSync(pemPath, pems[i] + "\n");
    const subject = trySh(`openssl x509 -noout -subject -in ${pemPath}`) || "";
    // egress gateway の CA だけを信頼（無関係な CA を入れない安全策）
    if (!/Egress Gateway|Anthropic/i.test(subject)) continue;
    const ok = trySh(`certutil -A -n "egress-ca-${i}" -t "C,," -d sql:${nssdb} -i ${pemPath}`);
    if (ok !== null) {
      imported++;
      log(`[trust-egress-ca] import: egress-ca-${i}  (${subject.trim()})`);
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (imported > 0) {
    log(`[trust-egress-ca] 完了: ${imported} 件の egress CA を Chromium(NSS) に信頼登録（TLS 検証は無効化していません）`);
    return true;
  }
  console.warn("[trust-egress-ca] egress CA を1件も import できませんでした");
  return false;
}

// 直接実行時
if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = ensureEgressCaTrusted({ verbose: true });
  process.exit(ok ? 0 : 1);
}
