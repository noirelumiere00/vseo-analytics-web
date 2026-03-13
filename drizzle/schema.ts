import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
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
  status: mysqlEnum("status", ["pending", "queued", "processing", "completed", "failed"]).default("pending").notNull(),
  queuedAction: varchar("queuedAction", { length: 32 }), // "execute" | "reAnalyzeLLM"
  progress: json("progress").$type<{ message: string; percent: number; failedVideos?: Array<{tiktokVideoId: string; error: string}>; totalTarget?: number; processedCount?: number; phase?: string }>(),
  cancelRequested: int("cancelRequested").default(0),
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
  isAd: int("isAd").default(0), // TikTok APIの広告フラグ（0=通常, 1=広告/有償パートナーシップ）

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
  
  // 頻出ワード（後方互換のため残存）
  positiveWords: json("positiveWords").$type<string[]>(),
  negativeWords: json("negativeWords").$type<string[]>(),

  // 感情ワードマップ（LLMアノテーション済み 2D感情座標）
  // valence: Y軸 -1(悲/怒) → +1(喜/楽)
  // arousal: X軸 -1(穏/受動) → +1(興奮/能動)
  // sources: ワードの語源（将来的にOCR/音声/モーダル分析にも対応）
  emotionWords: json("emotionWords").$type<Array<{
    word: string;
    count: number;
    valence: number;
    arousal: number;
    sources: Array<"keyword" | "ocr" | "transcription" | "modal">;
  }>>(),
  
  // 自動インサイト（LLM生成）
  autoInsight: text("autoInsight"),

  // 主要示唇
  keyInsights: json("keyInsights").$type<Array<{
    category: "avoid" | "caution" | "leverage";
    title: string;
    description: string;
    analysis?: string;
    strategicAdvice?: string;
    sourceVideoIds?: string[];
   }>>(),
  
  // 動画個別メタキーワード（生データ）
  videoMetaKeywords: json("videoMetaKeywords").$type<Array<{
    videoUrl: string;
    videoId: string;
    accountId: string;
    keywords: string[];
  }>>(),

  // ハッシュタグ戦略分析
  hashtagStrategy: json("hashtagStrategy").$type<{
    topCombinations: Array<{ tags: string[]; count: number; avgER: number }>;
    recommendations: string[];
  }>(),

  // 側面分析（ビジネス視点）
  facets: json("facets").$type<Array<{
    aspect: string;
    positive_percentage: number;
    negative_percentage: number;
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
  commonalityAnalysis: json("commonalityAnalysis").$type<{
    summary: string;
    keyHook: string;
    contentTrend: string;
    formatFeatures: string;
    hashtagStrategy: string;
    vseoTips: string;
  }>(),
  losePatternAnalysis: json("losePatternAnalysis").$type<{
    summary: string;
    badHook: string;
    contentWeakness: string;
    formatProblems: string;
    hashtagMistakes: string;
    avoidTips: string;
  }>(),
  commonalityAnalysisAd: json("commonalityAnalysisAd").$type<{
    summary: string;
    keyHook: string;
    contentTrend: string;
    formatFeatures: string;
    hashtagStrategy: string;
    vseoTips: string;
  }>(),
  losePatternAnalysisAd: json("losePatternAnalysisAd").$type<{
    summary: string;
    badHook: string;
    contentWeakness: string;
    formatProblems: string;
    hashtagMistakes: string;
    avoidTips: string;
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TripleSearchResult = typeof tripleSearchResults.$inferSelect;
export type InsertTripleSearchResult = typeof tripleSearchResults.$inferInsert;

/**
 * トレンド発見ジョブ（ペルソナ → KW/ハッシュタグ拡張 → 横断集計）
 * 既存のVSEO分析とは完全分離。OCR/音声文字起こし不要のためJSONカラムに格納。
 */
export const trendDiscoveryJobs = mysqlTable("trend_discovery_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  persona: varchar("persona", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["pending", "queued", "processing", "completed", "failed"]).default("pending").notNull(),
  queuedAction: varchar("queuedAction", { length: 32 }), // "execute" | "recompute"
  progress: json("progress").$type<{ message: string; percent: number; phase?: string }>(),
  expandedKeywords: json("expandedKeywords").$type<string[]>(),
  expandedHashtags: json("expandedHashtags").$type<string[]>(),
  scrapedVideos: json("scrapedVideos").$type<Array<{
    query: string;
    queryType: "keyword" | "hashtag";
    videoId: string;
    desc: string;
    createTime: number;
    duration: number;
    coverUrl: string;
    authorUniqueId: string;
    authorNickname: string;
    authorAvatarUrl: string;
    followerCount: number;
    playCount: number;
    diggCount: number;
    commentCount: number;
    shareCount: number;
    collectCount: number;
    hashtags: string[];
    isAd: boolean;
  }>>(),
  crossAnalysis: json("crossAnalysis").$type<{
    trendingHashtags: Array<{
      tag: string;
      videoCount: number;
      queryCount: number;
      avgER: number;
    }>;
    topVideos: Array<{
      videoId: string;
      desc: string;
      authorUniqueId: string;
      authorNickname: string;
      playCount: number;
      diggCount: number;
      commentCount: number;
      shareCount: number;
      collectCount: number;
      er: number;
      coverUrl: string;
      hashtags: string[];
    }>;
    coOccurringTags: Array<{
      tagA: string;
      tagB: string;
      count: number;
    }>;
    keyCreators: Array<{
      uniqueId: string;
      nickname: string;
      avatarUrl: string;
      followerCount: number;
      videoCount: number;
      queryCount: number;
      totalPlays: number;
    }>;
    summary: string;
    statistics?: Record<string, unknown>;
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type TrendDiscoveryJob = typeof trendDiscoveryJobs.$inferSelect;
export type InsertTrendDiscoveryJob = typeof trendDiscoveryJobs.$inferInsert;

// ============================
// 施策効果レポート（キャンペーン）
// ============================

/**
 * キャンペーン（施策前後の効果測定の単位）
 */
export const campaigns = mysqlTable("campaigns", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  clientName: varchar("clientName", { length: 255 }),

  // 計測対象
  keywords: json("keywords").$type<string[]>().notNull(),
  ownAccountIds: json("ownAccountIds").$type<string[]>().notNull(),
  ownVideoIds: json("ownVideoIds").$type<string[]>(),
  campaignHashtags: json("campaignHashtags").$type<string[]>(),

  // 競合
  competitors: json("competitors").$type<Array<{
    name: string;
    account_id: string;
  }>>(),

  // ブランド関連ワード（オマージュ検出用）
  brandKeywords: json("brandKeywords").$type<string[]>(),

  // スナップショットリンク
  baselineSnapshotId: int("baselineSnapshotId"),
  measurementSnapshotId: int("measurementSnapshotId"),

  status: mysqlEnum("status", ["draft", "baseline_captured", "measurement_captured", "report_ready"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

/**
 * キャンペーンスナップショット（ベースライン or 効果測定）
 */
export const campaignSnapshots = mysqlTable("campaign_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  snapshotType: mysqlEnum("snapshotType", ["baseline", "measurement"]).notNull(),
  status: mysqlEnum("status", ["pending", "queued", "processing", "completed", "failed"]).default("pending").notNull(),
  progress: json("progress").$type<{ message: string; percent: number; phase?: string }>(),

  // KW別検索結果
  searchResults: json("searchResults").$type<Record<string, {
    total_results: number;
    all_videos: Array<{
      video_id: string;
      video_url: string;
      creator_username: string;
      description: string;
      hashtags: string[];
      view_count: number;
      like_count: number;
      comment_count: number;
      share_count: number;
      search_rank: number;
      created_at: string;
    }>;
    own_videos: Array<{
      video_id: string;
      video_url: string;
      creator_username: string;
      description: string;
      hashtags: string[];
      view_count: number;
      like_count: number;
      comment_count: number;
      share_count: number;
      search_rank: number;
      created_at: string;
      er: number;
    }>;
    competitor_positions: Array<{
      competitor_name: string;
      competitor_id: string;
      best_rank: number | null;
      video_count_in_top30: number;
    }>;
    share_of_voice: {
      own_count: number;
      total_count: number;
      percentage: string;
    };
    screenshot_key: string | null;
  }>>(),

  // 競合プロフィール
  competitorProfiles: json("competitorProfiles").$type<Record<string, {
    name: string;
    follower_count: number;
    video_count: number;
    recent_post_dates: string[];
  }>>(),

  // 波及効果
  rippleEffect: json("rippleEffect").$type<Record<string, {
    total_post_count: number;
    other_post_count: number;
    other_total_views: number;
    other_avg_views: number;
    omaage_videos: Array<{
      video_url: string;
      creator: string;
      views: number;
      likes: number;
      description: string;
      hashtags: string[];
      posted_at: string;
    }>;
  }>>(),

  capturedAt: timestamp("capturedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CampaignSnapshot = typeof campaignSnapshots.$inferSelect;
export type InsertCampaignSnapshot = typeof campaignSnapshots.$inferInsert;

/**
 * キャンペーンレポート（2スナップショット比較結果）
 */
export const campaignReports = mysqlTable("campaign_reports", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull().unique(),

  baselineDate: timestamp("baselineDate"),
  measurementDate: timestamp("measurementDate"),

  // サマリー
  summary: json("summary").$type<{
    primary_keyword: string;
    rank_before: number | null;
    rank_after: number | null;
    rank_change: number | null;
    views_before: number;
    views_after: number;
    er_before: number;
    er_after: number;
    sov_before: string;
    sov_after: string;
    related_posts_before: number;
    related_posts_after: number;
    omaage_count: number;
  }>(),

  // 自社ポジション
  positionReport: json("positionReport").$type<Array<{
    keyword: string;
    before_rank: number | null;
    after_rank: number | null;
    rank_change: number | null;
    before_views: number;
    after_views: number;
    views_change_pct: string | null;
    before_er: number;
    after_er: number;
  }>>(),

  // 競合比較
  competitorReport: json("competitorReport").$type<Record<string, {
    own_rank: number | null;
    competitors: Array<{
      competitor_name: string;
      competitor_id: string;
      best_rank: number | null;
      video_count_in_top30: number;
    }>;
    is_top: boolean;
  }>>(),

  // シェア・オブ・ボイス
  sovReport: json("sovReport").$type<Record<string, {
    before: { own_count: number; total_count: number; percentage: string };
    after: { own_count: number; total_count: number; percentage: string };
  }>>(),

  // 競合投稿頻度
  competitorFrequencyReport: json("competitorFrequencyReport").$type<Array<{
    name: string;
    is_own: boolean;
    frequency: {
      avg_interval_days: number;
      posts_per_week: number;
      sample_size: number;
    } | null;
  }>>(),

  // 波及効果
  rippleReport: json("rippleReport").$type<Record<string, {
    before_posts: number;
    after_posts: number;
    posts_change: number;
    posts_change_pct: string | null;
    before_total_views: number;
    after_total_views: number;
    omaage_videos: Array<{
      video_url: string;
      creator: string;
      views: number;
      likes: number;
      description: string;
      hashtags: string[];
      posted_at: string;
    }>;
    omaage_count: number;
  }>>(),

  // スクリーンショット
  screenshots: json("screenshots").$type<Record<string, {
    before: string | null;
    after: string | null;
  }>>(),

  notes: json("notes").$type<string[]>(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CampaignReport = typeof campaignReports.$inferSelect;
export type InsertCampaignReport = typeof campaignReports.$inferInsert;
