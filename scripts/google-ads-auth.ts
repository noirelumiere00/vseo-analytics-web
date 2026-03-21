/**
 * Google Ads API用 Refresh Token取得スクリプト
 *
 * 使い方:
 * 1. npx tsx scripts/google-ads-auth.ts
 * 2. 表示されるURLをブラウザで開く
 * 3. Googleアカウントで認証
 * 4. リダイレクト先URLの code= パラメータをコピー
 * 5. npx tsx scripts/google-ads-auth.ts exchange <コード>
 */

import "dotenv/config";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!; // 既存のWeb用リダイレクトURI

const SCOPE = "https://www.googleapis.com/auth/adwords";

const command = process.argv[2];

if (command === "exchange") {
  // Step 2: コードをトークンに交換
  const code = process.argv[3];
  if (!code) {
    console.error("使い方: npx tsx scripts/google-ads-auth.ts exchange <認証コード>");
    process.exit(1);
  }

  (async () => {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code.trim(),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const data = await res.json();

    if (data.refresh_token) {
      console.log("\n✅ 取得成功！以下を .env に追加してください:\n");
      console.log(`GOOGLE_ADS_DEVELOPER_TOKEN=A4aFjFVsTHTikr3gdlbEgA`);
      console.log(`GOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}`);
      console.log(`GOOGLE_ADS_CUSTOMER_ID=9716315717`);
      console.log("");
    } else {
      console.error("\n❌ エラー:", JSON.stringify(data, null, 2));
    }
  })();
} else {
  // Step 1: 認証URLを表示
  const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPE)}&response_type=code&access_type=offline&prompt=consent`;

  console.log("\n=== Google Ads API Refresh Token 取得 ===\n");
  console.log("Step 1: 以下のURLをブラウザで開いてください:\n");
  console.log(authUrl);
  console.log("\nStep 2: 認証後、リダイレクトされたURLの ?code=XXXX 部分をコピー");
  console.log("\nStep 3: 以下を実行:");
  console.log("  npx tsx scripts/google-ads-auth.ts exchange <コード>\n");
}
