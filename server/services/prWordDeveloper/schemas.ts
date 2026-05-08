/**
 * PR Word Developer — Zod schemas + JSON Schema for LLM response format
 */
import { z } from "zod";

// ── Product Profile ──
export const productProfileSchema = z.object({
  category: z.string(),
  positioning: z.string(),
  targetAudience: z.string(),
  uniqueSellingPoints: z.array(z.string()),
  toneOfVoice: z.string(),
});
export type ProductProfile = z.infer<typeof productProfileSchema>;

// ── 4象限ワードマップ ──
export const wordMapSchema = z.object({
  properNouns: z.array(z.string()),     // 固有名詞
  categoryTerms: z.array(z.string()),   // カテゴリ用語
  trendTerms: z.array(z.string()),      // 時事・新規性
  actionTerms: z.array(z.string()),     // 行動・活用
});
export type WordMap = z.infer<typeof wordMapSchema>;

// ── ハッシュタグ三層 ──
const hashtagItemSchema = z.object({
  tag: z.string(),
  postCount: z.number().nullable(),
});
export const hashtagStructureSchema = z.object({
  big: z.array(hashtagItemSchema),    // ビッグ2
  mid: z.array(hashtagItemSchema),    // ミドル5
  niche: z.array(hashtagItemSchema),  // ニッチ3
});
export type HashtagStructure = z.infer<typeof hashtagStructureSchema>;
export type HashtagItem = z.infer<typeof hashtagItemSchema>;

// ── ショート動画フレーズ ──
export const hookPhraseSchema = z.object({
  type: z.enum(["question", "number", "contrast", "confession", "command"]),
  phrase: z.string(),
  explanation: z.string(),
});
export type HookPhrase = z.infer<typeof hookPhraseSchema>;

// ── 推奨露出面 ──
export const recommendedChannelSchema = z.object({
  channel: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});
export type RecommendedChannel = z.infer<typeof recommendedChannelSchema>;

// ── Full LLM output ──
export const prWordResultSchema = z.object({
  productProfile: productProfileSchema,
  wordMap: wordMapSchema,
  hashtagStructure: hashtagStructureSchema,
  hookPhrases: z.array(hookPhraseSchema),
  recommendedChannels: z.array(recommendedChannelSchema),
});
export type PrWordResult = z.infer<typeof prWordResultSchema>;

// ── V2: 検索ワード（指名/一般共通） ──
export const searchWordSchema = z.object({
  word: z.string(),
  reason: z.string(),
  tiktokPostCount: z.number().nullable(),
});
export type SearchWord = z.infer<typeof searchWordSchema>;

export const prWordResultSchemaV2 = z.object({
  productProfile: productProfileSchema,
  brandedSearchWords: z.array(searchWordSchema),
  genericSearchWords: z.array(searchWordSchema),
});
export type PrWordResultV2 = z.infer<typeof prWordResultSchemaV2>;

// ── V2 JSON Schema for LLM response_format ──
export const PR_WORD_RESULT_JSON_SCHEMA_V2 = {
  name: "pr_word_result_v2",
  schema: {
    type: "object",
    required: ["productProfile", "brandedSearchWords", "genericSearchWords"],
    properties: {
      productProfile: {
        type: "object",
        required: ["category", "positioning", "targetAudience", "uniqueSellingPoints", "toneOfVoice"],
        properties: {
          category: { type: "string", description: "商品カテゴリ" },
          positioning: { type: "string", description: "市場でのポジショニング" },
          targetAudience: { type: "string", description: "主要ターゲット" },
          uniqueSellingPoints: { type: "array", items: { type: "string" }, description: "USP（3-5個）" },
          toneOfVoice: { type: "string", description: "推奨するトーン＆マナー" },
        },
      },
      brandedSearchWords: {
        type: "array",
        items: {
          type: "object",
          required: ["word", "reason", "tiktokPostCount"],
          properties: {
            word: { type: "string", description: "指名検索ワード" },
            reason: { type: "string", description: "選定理由" },
            tiktokPostCount: { type: ["number", "null"], description: "TikTok投稿数（不明ならnull）" },
          },
        },
        description: "指名検索ワード（商品名・メーカー名・ブランド名など固有名詞系）5-10個",
      },
      genericSearchWords: {
        type: "array",
        items: {
          type: "object",
          required: ["word", "reason", "tiktokPostCount"],
          properties: {
            word: { type: "string", description: "一般検索ワード" },
            reason: { type: "string", description: "選定理由" },
            tiktokPostCount: { type: ["number", "null"], description: "TikTok投稿数（不明ならnull）" },
          },
        },
        description: "一般検索ワード（カテゴリ・用途・シーン・課題の一般名詞系）5-10個",
      },
    },
  },
  strict: false,
};

// ── V1 JSON Schema for LLM response_format (legacy) ──
export const PR_WORD_RESULT_JSON_SCHEMA = {
  name: "pr_word_result",
  schema: {
    type: "object",
    required: ["productProfile", "wordMap", "hashtagStructure", "hookPhrases"],
    properties: {
      productProfile: {
        type: "object",
        required: ["category", "positioning", "targetAudience", "uniqueSellingPoints", "toneOfVoice"],
        properties: {
          category: { type: "string", description: "商品カテゴリ" },
          positioning: { type: "string", description: "市場でのポジショニング" },
          targetAudience: { type: "string", description: "主要ターゲット" },
          uniqueSellingPoints: { type: "array", items: { type: "string" }, description: "USP（3-5個）" },
          toneOfVoice: { type: "string", description: "推奨するトーン＆マナー" },
        },
      },
      wordMap: {
        type: "object",
        required: ["properNouns", "categoryTerms", "trendTerms", "actionTerms"],
        properties: {
          properNouns: { type: "array", items: { type: "string" }, description: "固有名詞（ブランド名・成分名・技術名など）5-8個" },
          categoryTerms: { type: "array", items: { type: "string" }, description: "カテゴリ用語（一般名詞・業界用語）5-8個" },
          trendTerms: { type: "array", items: { type: "string" }, description: "時事・新規性ワード（トレンド・話題性）5-8個" },
          actionTerms: { type: "array", items: { type: "string" }, description: "行動・活用ワード（使い方・HOW TO）5-8個" },
        },
      },
      hashtagStructure: {
        type: "object",
        required: ["big", "mid", "niche"],
        properties: {
          big: {
            type: "array",
            items: {
              type: "object",
              required: ["tag", "postCount"],
              properties: {
                tag: { type: "string", description: "ハッシュタグ（#付き）" },
                postCount: { type: ["number", "null"], description: "TikTok投稿数（不明ならnull）" },
              },
            },
            description: "ビッグハッシュタグ（2個、10万件以上級）",
          },
          mid: {
            type: "array",
            items: {
              type: "object",
              required: ["tag", "postCount"],
              properties: {
                tag: { type: "string", description: "ハッシュタグ（#付き）" },
                postCount: { type: ["number", "null"], description: "TikTok投稿数（不明ならnull）" },
              },
            },
            description: "ミドルハッシュタグ（5個、1-10万件級）",
          },
          niche: {
            type: "array",
            items: {
              type: "object",
              required: ["tag", "postCount"],
              properties: {
                tag: { type: "string", description: "ハッシュタグ（#付き）" },
                postCount: { type: ["number", "null"], description: "TikTok投稿数（不明ならnull）" },
              },
            },
            description: "ニッチハッシュタグ（3個、1万件未満のロングテール）",
          },
        },
      },
      hookPhrases: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "phrase", "explanation"],
          properties: {
            type: { type: "string", enum: ["question", "number", "contrast", "confession", "command"] },
            phrase: { type: "string", description: "ショート動画の冒頭フレーズ" },
            explanation: { type: "string", description: "なぜこのフレーズが効果的か" },
          },
        },
        description: "5型（疑問/数字/対比/告白/命令）各1個",
      },
    },
  },
  strict: false,
};
