export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // AWS Bedrock
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
  adminEmail: process.env.ADMIN_EMAIL ?? "s-komata@vectorinc.co.jp",
};
