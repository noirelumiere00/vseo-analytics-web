export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // 順位だけモード: LLM 分析（センチメント/レポート/パターン）をスキップし、
  // TikTok 収集＋表示順位の保存だけ行って job を完了扱いにする。
  // RANKING_ONLY=true、または ANTHROPIC_API_KEY 未設定時に有効化する（jobExecutor 側で判定）。
  rankingOnly: process.env.RANKING_ONLY === "true",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Anthropic Claude API（LLM 本体。Bedrock から移行）
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModelId: process.env.ANTHROPIC_MODEL_ID ?? "claude-haiku-4-5",
  // AWS（SES メール送信などで使用。LLM では未使用）
  awsRegion: process.env.AWS_REGION ?? "us-west-2",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001",
  // Stripe
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceIdPro: process.env.STRIPE_PRICE_ID_PRO ?? "",
  stripePriceIdBusiness: process.env.STRIPE_PRICE_ID_BUSINESS ?? "",
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
  // SES / App
  sesFromAddress: process.env.SES_FROM_ADDRESS ?? "",
  appUrl: process.env.APP_URL ?? "http://localhost:3001",
  // Admin
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  // 無制限ドメイン（カンマ区切り）
  unlimitedDomains: process.env.UNLIMITED_DOMAINS ?? "",
  // Google Ads API
  googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
  googleAdsRefreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
  googleAdsCustomerId: process.env.GOOGLE_ADS_CUSTOMER_ID ?? "",
  // Google Custom Search API
  googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY ?? "",
  googleSearchCx: process.env.GOOGLE_SEARCH_CX ?? "",
  // Apify
  apifyApiToken: process.env.APIFY_API_TOKEN ?? "",
  // YouTube Data API v3
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? "",
  // X MCP Server (Pain Analysis)
  xmcpBaseUrl: process.env.XMCP_BASE_URL ?? "",
};

/** 起動時に必須環境変数をバリデーション */
export function validateRequiredEnv() {
  const required: [string, string][] = [
    ["JWT_SECRET", ENV.cookieSecret],
    ["DATABASE_URL", ENV.databaseUrl],
    ["VITE_APP_ID", ENV.appId],
    ["OAUTH_SERVER_URL", ENV.oAuthServerUrl],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`FATAL: Missing required environment variables: ${missing.join(", ")}`);
  }

  // APP_URL の形式検証
  try {
    new URL(ENV.appUrl);
  } catch {
    throw new Error(`FATAL: APP_URL is not a valid URL: ${ENV.appUrl}`);
  }
}
