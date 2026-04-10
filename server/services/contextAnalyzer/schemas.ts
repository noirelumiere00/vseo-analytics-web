/**
 * Context Analyzer — Zod schemas for input/output validation
 */
import { z } from "zod";

// ── Input schema ──
export const analyzeInputSchema = z.object({
  productName: z.string().min(1).max(255),
  productImageUrl: z.string().url().optional(),
});
export type AnalyzeInput = z.infer<typeof analyzeInputSchema>;

// ── Source reference ──
export const sourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
});

// ── S1: Client Intent ──
export const clientIntentSchema = z.object({
  mainMessage: z.string(),
  targetAudience: z.string(),
  keyPoints: z.array(z.string()),
  sources: z.array(sourceSchema),
});

// ── S2: Social Reaction (per-platform) ──
export const platformReactionSchema = z.object({
  dominantNarrative: z.string(),
  engagementPatterns: z.array(z.string()),
  topHashtags: z.array(z.string()),
  videoCount: z.number(),
  avgEngagementRate: z.number(),
});

export const socialReactionSchema = z.object({
  tiktok: platformReactionSchema.optional(),
  instagram: platformReactionSchema.optional(),
});

// ── S3: Web Reputation ──
export const webReputationSchema = z.object({
  overallSentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  comparisonContext: z.string(),
  sources: z.array(sourceSchema),
});

// ── Gap Analysis ──
export const reachedAudienceSchema = z.object({
  segment: z.string(),
  strength: z.enum(["high", "medium", "low"]),
  evidence: z.string(),
});

export const unreachedAudienceSchema = z.object({
  segment: z.string(),
  opportunity: z.string(),
  barrier: z.string(),
});

export const competitorGapSchema = z.object({
  competitor: z.string(),
  theirStrength: z.string(),
  ourWeakness: z.string(),
});

export const gapAnalysisSchema = z.object({
  reachedAudiences: z.array(reachedAudienceSchema),
  unreachedAudiences: z.array(unreachedAudienceSchema),
  competitorGaps: z.array(competitorGapSchema),
});

// ── Context Map entry ──
export const contextMapEntrySchema = z.object({
  context: z.string(),
  currentPresence: z.enum(["strong", "weak", "absent"]),
  relevantPlatform: z.enum(["tiktok", "instagram", "web"]),
  description: z.string(),
});

// ── Full analysis result ──
export const analysisResultSchema = z.object({
  productName: z.string(),
  summary: z.string(),
  segments: z.object({
    clientIntent: clientIntentSchema,
    socialReaction: socialReactionSchema,
    webReputation: webReputationSchema,
  }),
  gapAnalysis: gapAnalysisSchema,
  contextMap: z.array(contextMapEntrySchema),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// ── Collector raw data types ──
export type S1RawData = {
  query: string;
  results: Array<{ url: string; title: string; snippet: string; body?: string }>;
};

export type S2RawData = {
  tiktok: {
    videos: Array<{
      videoUrl: string;
      description: string;
      hashtags: string[];
      viewCount: number;
      likeCount: number;
      commentCount: number;
      shareCount: number;
      authorUsername: string;
    }>;
    totalCount: number;
  };
  instagram: {
    videos: Array<{
      videoUrl: string;
      caption: string;
      hashtags: string[];
      viewCount: number;
      likeCount: number;
      commentCount: number;
      authorUsername: string;
    }>;
    totalCount: number;
  };
};

export type S3RawData = {
  query: string;
  results: Array<{ url: string; title: string; snippet: string; body?: string }>;
};
