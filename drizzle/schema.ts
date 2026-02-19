import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * 分析ジョブ（1回の分析リクエスト）
 */
export const analysisJobs = mysqlTable("analysis_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  keyword: varchar("keyword", { length: 255 }),
  manualUrls: json("manualUrls").$type<string[]>(), // 手動入力されたURL配列
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type InsertAnalysisJob = typeof analysisJobs.$inferInsert;

/**
 * 動画データ（収集された動画の基本情報）
 */
export const videos = mysqlTable("videos", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull(),
  platform: mysqlEnum("platform", ["tiktok", "youtube_shorts"]).notNull(),
  videoUrl: varchar("videoUrl", { length: 512 }).notNull(),
  videoId: varchar("videoId", { length: 128 }).notNull(),
  title: text("title"),
  description: text("description"),
  thumbnailUrl: varchar("thumbnailUrl", { length: 512 }),
  duration: int("duration"), // 秒
  
  // エンゲージメント数値
  viewCount: bigint("viewCount", { mode: "number" }),
  likeCount: bigint("likeCount", { mode: "number" }),
  commentCount: bigint("commentCount", { mode: "number" }),
  shareCount: bigint("shareCount", { mode: "number" }),
  saveCount: bigint("saveCount", { mode: "number" }),
  
  // KOL（インフルエンサー）情報
  accountName: varchar("accountName", { length: 255 }),
  accountId: varchar("accountId", { length: 128 }),
  followerCount: bigint("followerCount", { mode: "number" }),
  accountAvatarUrl: varchar("accountAvatarUrl", { length: 512 }),
  
  // 分析結果
  sentiment: mysqlEnum("sentiment", ["positive", "neutral", "negative"]),
  keyHook: text("keyHook"), // キーフック（動画の主要な訴求ポイント）
  keywords: json("keywords").$type<string[]>(), // 抽出されたキーワード配列
  hashtags: json("hashtags").$type<string[]>(), // ハッシュタグ配列
  
  duplicateCount: int("duplicateCount").default(0), // 3アカウント間での重複出現回数
  postedAt: timestamp("postedAt"), // 投稿日時
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Video = typeof videos.$inferSelect;
export type InsertVideo = typeof videos.$inferInsert;

/**
 * OCR解析結果（2秒/1フレーム）
 */
export const ocrResults = mysqlTable("ocr_results", {
  id: int("id").autoincrement().primaryKey(),
  videoId: int("videoId").notNull(),
  frameTimestamp: int("frameTimestamp").notNull(), // フレームのタイムスタンプ（秒）
  extractedText: text("extractedText"),
  confidence: int("confidence"), // OCR信頼度（0-100）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OcrResult = typeof ocrResults.$inferSelect;
export type InsertOcrResult = typeof ocrResults.$inferInsert;

/**
 * 音声文字起こし結果（Whisper API）
 */
export const transcriptions = mysqlTable("transcriptions", {
  id: int("id").autoincrement().primaryKey(),
  videoId: int("videoId").notNull(),
  fullText: text("fullText").notNull(), // 全文テキスト
  segments: json("segments").$type<Array<{ start: number; end: number; text: string }>>(), // タイムスタンプ付きセグメント
  language: varchar("language", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Transcription = typeof transcriptions.$inferSelect;
export type InsertTranscription = typeof transcriptions.$inferInsert;

/**
 * 分析スコア（各要素の重要度）
 */
export const analysisScores = mysqlTable("analysis_scores", {
  id: int("id").autoincrement().primaryKey(),
  videoId: int("videoId").notNull(),
  thumbnailScore: int("thumbnailScore").default(0), // サムネイルスコア（0-100）
  textScore: int("textScore").default(0), // テキスト要素スコア（0-100）
  audioScore: int("audioScore").default(0), // 音声スコア（0-100）
  durationScore: int("durationScore").default(0), // 尺スコア（0-100）
  overallScore: int("overallScore").default(0), // 総合スコア（0-100）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AnalysisScore = typeof analysisScores.$inferSelect;
export type InsertAnalysisScore = typeof analysisScores.$inferInsert;

/**
 * 分析レポート（キーワード全体の分析結果）
 */
export const analysisReports = mysqlTable("analysis_reports", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull().unique(),
  
  // サマリー情報
  totalVideos: int("totalVideos").default(0),
  totalViews: bigint("totalViews", { mode: "number" }).default(0),
  totalEngagement: bigint("totalEngagement", { mode: "number" }).default(0),
  
  // センチメント構成比
  neutralCount: int("neutralCount").default(0),
  neutralPercentage: int("neutralPercentage").default(0),
  positiveCount: int("positiveCount").default(0),
  positivePercentage: int("positivePercentage").default(0),
  negativeCount: int("negativeCount").default(0),
  negativePercentage: int("negativePercentage").default(0),
  
  // ポジネガ比較（Neutralを除く）
  posNegPositiveCount: int("posNegPositiveCount").default(0),
  posNegPositivePercentage: int("posNegPositivePercentage").default(0),
  posNegNegativeCount: int("posNegNegativeCount").default(0),
  posNegNegativePercentage: int("posNegNegativePercentage").default(0),
  
  // インパクト分析
  positiveViewsShare: int("positiveViewsShare").default(0), // %
  negativeViewsShare: int("negativeViewsShare").default(0), // %
  positiveEngagementShare: int("positiveEngagementShare").default(0), // %
  negativeEngagementShare: int("negativeEngagementShare").default(0), // %
  
  // 頻出ワード
  positiveWords: json("positiveWords").$type<string[]>(),
  negativeWords: json("negativeWords").$type<string[]>(),
  
  // 主要示唆
  keyInsights: json("keyInsights").$type<Array<{
    category: "risk" | "urgent" | "positive";
    title: string;
    description: string;
  }>>(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AnalysisReport = typeof analysisReports.$inferSelect;
export type InsertAnalysisReport = typeof analysisReports.$inferInsert;

/**
 * 3シークレットブラウザ検索結果（永続化）
 */
export const tripleSearchResults = mysqlTable("triple_search_results", {
  id: int("id").autoincrement().primaryKey(),
  jobId: int("jobId").notNull().unique(),
  searchData: json("searchData").$type<Array<{
    sessionIndex: number;
    totalFetched: number;
    videoIds: string[];
  }>>(),
  appearedInAll3Ids: json("appearedInAll3Ids").$type<string[]>(),
  appearedIn2Ids: json("appearedIn2Ids").$type<string[]>(),
  appearedIn1OnlyIds: json("appearedIn1OnlyIds").$type<string[]>(),
  overlapRate: int("overlapRate").default(0), // percentage * 10 for decimal precision
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TripleSearchResult = typeof tripleSearchResults.$inferSelect;
export type InsertTripleSearchResult = typeof tripleSearchResults.$inferInsert;
