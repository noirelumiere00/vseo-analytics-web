/**
 * painAnalyzer/schemas.ts — Zod schemas for all pain analysis steps
 */
import { z } from "zod";

// ================================================================
// STEP 2: Product Features
// ================================================================

export const productFeaturesSchema = z.object({
  features: z.array(z.string()).min(1),
  targetAudience: z.string(),
  competitors: z.array(z.string()),
  productCategory: z.string(),
});

export type ProductFeatures = z.infer<typeof productFeaturesSchema>;

export const PRODUCT_FEATURES_JSON_SCHEMA = {
  name: "productFeatures",
  schema: {
    type: "object",
    properties: {
      features: { type: "array", items: { type: "string" }, description: "商品の主要な特徴・機能（5〜10個）" },
      targetAudience: { type: "string", description: "主要なターゲット層の説明" },
      competitors: { type: "array", items: { type: "string" }, description: "主な競合商品名" },
      productCategory: { type: "string", description: "商品カテゴリ" },
    },
    required: ["features", "targetAudience", "competitors", "productCategory"],
  },
};

// ================================================================
// STEP 3: Pain Hypotheses
// ================================================================

export const painHypothesisSchema = z.object({
  id: z.string(),
  pain: z.string(),
  feature: z.string(),
  searchQuery: z.string(),
  confidence: z.number().min(0).max(1),
  approved: z.boolean().default(true),
  userAdded: z.boolean().optional(),
});

export type PainHypothesis = z.infer<typeof painHypothesisSchema>;

export const painHypothesesArraySchema = z.object({
  hypotheses: z.array(painHypothesisSchema).min(3),
});

export const PAIN_HYPOTHESES_JSON_SCHEMA = {
  name: "painHypotheses",
  schema: {
    type: "object",
    properties: {
      hypotheses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "一意のID (pain_01, pain_02, ...)" },
            pain: { type: "string", description: "具体的なペイン文（ユーザーの悩み/不便/課題）" },
            feature: { type: "string", description: "このペインに関連する商品特徴" },
            searchQuery: { type: "string", description: "X/TikTokでこのペインを検証するための検索クエリ" },
            confidence: { type: "number", description: "仮説の確信度 (0.0〜1.0)" },
          },
          required: ["id", "pain", "feature", "searchQuery", "confidence"],
        },
      },
    },
    required: ["hypotheses"],
  },
};

// ================================================================
// STEP 4: Verification Data
// ================================================================

export const verifiedPainSchema = z.object({
  painId: z.string(),
  pain: z.string(),
  verificationScore: z.number().min(0).max(1),
  xPostCount: z.number(),
  ttVideoCount: z.number(),
  topEvidence: z.array(z.string()),
});

export type VerifiedPain = z.infer<typeof verifiedPainSchema>;

// ================================================================
// STEP 5: Segment Classification
// ================================================================

export const communitySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  representativeUsers: z.array(z.string()),
  size: z.enum(["large", "medium", "small"]),
  layer: z.enum(["core", "expansion"]).optional(),
  cultureCode: z.object({
    nicknames: z.array(z.string()),
    hashtags: z.array(z.string()),
    contentPatterns: z.array(z.string()),
  }).optional(),
  estimatedPopulation: z.number().optional(),
  populationFormula: z.string().optional(),
  populationSources: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
  officialGap: z.object({
    official: z.string(),
    reality: z.string(),
    insight: z.string(),
  }).optional(),
  keywordCandidates: z.array(z.object({
    keyword: z.string(),
    tiktokViews: z.number(),
    tiktokPostCount: z.number(),
    tiktokAvgER: z.number(),
    instagramPostCount: z.number(),
    trend: z.enum(["rising", "stable", "declining"]),
    selected: z.boolean(),
  })).optional(),
});

export const segmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  matchScore: z.number(),
  primaryPain: z.string(),
  appeals: z.array(z.string()),
  communityIds: z.array(z.string()),
  trendStats: z.object({
    avgER: z.number(),
    topHashtags: z.array(z.string()),
    postCount: z.number(),
    avgViews: z.number(),
  }).optional(),
});

export type Segment = z.infer<typeof segmentSchema>;

export const segmentClassificationSchema = z.object({
  communities: z.array(communitySchema).min(3).max(7),
  segments: z.array(segmentSchema).min(2),
});

export const SEGMENT_CLASSIFICATION_JSON_SCHEMA = {
  name: "segmentClassification",
  schema: {
    type: "object",
    properties: {
      communities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string", description: "界隈名（例: 子育てママ界隈, ビジネスマン界隈）" },
            description: { type: "string" },
            keywords: { type: "array", items: { type: "string" }, description: "界隈に関連するキーワード5つ" },
            representativeUsers: { type: "array", items: { type: "string" } },
            size: { type: "string", enum: ["large", "medium", "small"] },
            layer: { type: "string", enum: ["core", "expansion"], description: "Core(A-C)=熱量の高いコア層, Expansion(D-E)=拡大層" },
            cultureCode: {
              type: "object",
              properties: {
                nicknames: { type: "array", items: { type: "string" }, description: "ユーザーの自称（〇〇勢、〇〇民、〇〇沼）" },
                hashtags: { type: "array", items: { type: "string" }, description: "界隈特有のハッシュタグ" },
                contentPatterns: { type: "array", items: { type: "string" }, description: "よくある投稿構図・型（例: 開封動画、ビフォーアフター）" },
              },
              required: ["nicknames", "hashtags", "contentPatterns"],
            },
            estimatedPopulation: { type: "number", description: "推定人数（Web上のFactから算出）" },
            populationFormula: { type: "string", description: "人数の計算式・根拠" },
            officialGap: {
              type: "object",
              properties: {
                official: { type: "string", description: "メーカーの想定用途" },
                reality: { type: "string", description: "ユーザーの実際の使い方" },
                insight: { type: "string", description: "ズレから見えるインサイト" },
              },
              required: ["official", "reality", "insight"],
            },
          },
          required: ["id", "name", "description", "keywords", "representativeUsers", "size", "layer", "cultureCode", "officialGap"],
        },
      },
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string", description: "セグメント名（例: 子育てママ層）" },
            icon: { type: "string", description: "セグメントを表す絵文字アイコン1つ" },
            matchScore: { type: "number", description: "商品とのマッチ度 (0.0〜1.0)" },
            primaryPain: { type: "string", description: "このセグメントの主要ペイン" },
            appeals: { type: "array", items: { type: "string" }, description: "訴求ポイント" },
            communityIds: { type: "array", items: { type: "string" } },
          },
          required: ["id", "name", "icon", "matchScore", "primaryPain", "appeals", "communityIds"],
        },
      },
    },
    required: ["communities", "segments"],
  },
};

// ================================================================
// STEP 6: Purchase Attitudes
// ================================================================

export const purchaseAttitudeSchema = z.object({
  segmentId: z.string(),
  attitude: z.string(),
  priceRange: z.string(),
  purchaseDrivers: z.array(z.string()),
  purchaseBarriers: z.array(z.string()),
  evidence: z.array(z.string()),
});

export type PurchaseAttitude = z.infer<typeof purchaseAttitudeSchema>;

export const PURCHASE_ATTITUDE_JSON_SCHEMA = {
  name: "purchaseAttitudes",
  schema: {
    type: "object",
    properties: {
      attitudes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            segmentId: { type: "string" },
            attitude: { type: "string", description: "購買態度の要約（例: コスパ重視, 機能重視）" },
            priceRange: { type: "string", description: "許容価格帯（例: 中価格帯OK）" },
            purchaseDrivers: { type: "array", items: { type: "string" }, description: "購買を後押しする要因" },
            purchaseBarriers: { type: "array", items: { type: "string" }, description: "購買を妨げる要因" },
            evidence: { type: "array", items: { type: "string" }, description: "根拠となる投稿/行動の要約" },
          },
          required: ["segmentId", "attitude", "priceRange", "purchaseDrivers", "purchaseBarriers", "evidence"],
        },
      },
    },
    required: ["attitudes"],
  },
};

// ================================================================
// STEP 7: Proposals
// ================================================================

export const proposalSchema = z.object({
  segmentId: z.string(),
  segmentName: z.string(),
  copyProposals: z.array(z.object({
    headline: z.string(),
    body: z.string(),
    cta: z.string(),
    platform: z.enum(["x", "tiktok", "instagram"]),
  })),
  hashtagSets: z.array(z.string()),
  representativeContent: z.array(z.object({
    platform: z.enum(["x", "tiktok", "instagram"]),
    url: z.string(),
    description: z.string(),
    engagement: z.number(),
  })),
  priorityActions: z.array(z.object({
    action: z.string(),
    timeline: z.string(),
    expectedImpact: z.string(),
  })),
});

export type Proposal = z.infer<typeof proposalSchema>;

export const PROPOSAL_JSON_SCHEMA = {
  name: "proposals",
  schema: {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            segmentId: { type: "string" },
            segmentName: { type: "string" },
            copyProposals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  headline: { type: "string" },
                  body: { type: "string" },
                  cta: { type: "string" },
                  platform: { type: "string", enum: ["x", "tiktok", "instagram"] },
                },
                required: ["headline", "body", "cta", "platform"],
              },
            },
            hashtagSets: { type: "array", items: { type: "string" } },
            representativeContent: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  platform: { type: "string", enum: ["x", "tiktok", "instagram"] },
                  url: { type: "string" },
                  description: { type: "string" },
                  engagement: { type: "number" },
                },
                required: ["platform", "url", "description", "engagement"],
              },
            },
            priorityActions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  timeline: { type: "string" },
                  expectedImpact: { type: "string" },
                },
                required: ["action", "timeline", "expectedImpact"],
              },
            },
          },
          required: ["segmentId", "segmentName", "copyProposals", "hashtagSets", "representativeContent", "priorityActions"],
        },
      },
    },
    required: ["proposals"],
  },
};

// ================================================================
// STEP 7b: Kaiwai Creative (30 proposals: 5×3×right/left brain)
// ================================================================

export const kaiwaiCreativeSchema = z.object({
  communityId: z.string(),
  communityName: z.string(),
  keyword: z.string(),
  axis: z.enum(["right-brain", "left-brain"]),
  headline: z.string(),
  body: z.string(),
  visualConcept: z.string(),
});

export type KaiwaiCreative = z.infer<typeof kaiwaiCreativeSchema>;

export const KAIWAI_CREATIVE_JSON_SCHEMA = {
  name: "kaiwaiCreatives",
  schema: {
    type: "object",
    properties: {
      creatives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            communityId: { type: "string" },
            communityName: { type: "string" },
            keyword: { type: "string" },
            axis: { type: "string", enum: ["right-brain", "left-brain"], description: "right-brain=話口調(感情・直感), left-brain=説明口調(機能・論理)" },
            headline: { type: "string", description: "投稿のヘッドライン/フック" },
            body: { type: "string", description: "right-brain=話口調テキスト, left-brain=説明口調テキスト" },
            visualConcept: { type: "string", description: "映像/ビジュアルのコンセプト説明" },
          },
          required: ["communityId", "communityName", "keyword", "axis", "headline", "body", "visualConcept"],
        },
      },
    },
    required: ["creatives"],
  },
};

// ================================================================
// Final Result Summary
// ================================================================

export const analysisResultSummarySchema = z.object({
  executiveSummary: z.string(),
  totalPainsVerified: z.number(),
  totalSegments: z.number(),
  topSegment: z.string(),
  recommendations: z.array(z.string()),
  segmentBreakdown: z.array(z.object({
    segmentName: z.string(),
    percentage: z.number(),
    icon: z.string(),
  })),
});

export const ANALYSIS_RESULT_JSON_SCHEMA = {
  name: "analysisResult",
  schema: {
    type: "object",
    properties: {
      executiveSummary: { type: "string", description: "分析全体のエグゼクティブサマリー" },
      totalPainsVerified: { type: "number" },
      totalSegments: { type: "number" },
      topSegment: { type: "string", description: "最もマッチ度の高いセグメント名" },
      recommendations: { type: "array", items: { type: "string" }, description: "全体の戦略提言（3〜5個）" },
      segmentBreakdown: {
        type: "array",
        items: {
          type: "object",
          properties: {
            segmentName: { type: "string" },
            percentage: { type: "number", description: "推定比率 (%)" },
            icon: { type: "string" },
          },
          required: ["segmentName", "percentage", "icon"],
        },
      },
    },
    required: ["executiveSummary", "totalPainsVerified", "totalSegments", "topSegment", "recommendations", "segmentBreakdown"],
  },
};

// ================================================================
// Progress callback type
// ================================================================

export type PainAnalysisProgress = {
  message: string;
  percent: number;
  phase?: string;
};

export type ProgressFn = (progress: PainAnalysisProgress) => Promise<void>;
