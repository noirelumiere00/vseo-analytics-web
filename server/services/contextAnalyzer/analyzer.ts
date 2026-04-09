/**
 * Context Analyzer — Bedrock LLM analysis
 *
 * Takes collected raw data from all 3 segments and sends to Bedrock
 * for structured context analysis.
 */
import { invokeLLM } from "../../_core/llm";
import { analysisResultSchema, type AnalysisResult, type S1RawData, type S2RawData, type S3RawData } from "./schemas";
import { CONTEXT_ANALYZER_SYSTEM_PROMPT, buildUserPrompt, ANALYSIS_RESULT_JSON_SCHEMA } from "./prompts";

const MAX_SEGMENT_CHARS = 3000;

/**
 * Truncate text to max characters
 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "... (truncated)";
}

/**
 * Format S1 raw data into text for the LLM prompt
 */
function formatS1(data: S1RawData[]): string {
  if (!data || data.length === 0) return "（データなし）";

  const parts: string[] = [];
  for (const entry of data) {
    for (const r of entry.results) {
      parts.push(`- [${r.title}](${r.url})\n  ${r.snippet}\n  ${r.body ? truncate(r.body, 500) : ""}`);
    }
  }
  return truncate(parts.join("\n\n"), MAX_SEGMENT_CHARS);
}

/**
 * Format S2 raw data into text for the LLM prompt
 */
function formatS2(data: S2RawData): string {
  if (!data) return "（データなし）";

  const parts: string[] = [];

  // TikTok summary
  if (data.tiktok.totalCount > 0) {
    const tt = data.tiktok;
    const totalViews = tt.videos.reduce((s, v) => s + v.viewCount, 0);
    const totalLikes = tt.videos.reduce((s, v) => s + v.likeCount, 0);
    const totalComments = tt.videos.reduce((s, v) => s + v.commentCount, 0);
    const avgER = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100).toFixed(2) : "0";

    // Collect hashtags
    const hashtagCounts = new Map<string, number>();
    for (const v of tt.videos) {
      for (const tag of v.hashtags) {
        hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
      }
    }
    const topHashtags = [...hashtagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, count]) => `#${tag}(${count})`)
      .join(", ");

    parts.push(`### TikTok (${tt.totalCount}本)
- 合計再生数: ${totalViews.toLocaleString()}
- 平均ER: ${avgER}%
- 人気ハッシュタグ: ${topHashtags}
- 代表的な動画内容:`);

    for (const v of tt.videos.slice(0, 10)) {
      parts.push(`  - @${v.authorUsername}: "${truncate(v.description, 100)}" (再生${v.viewCount.toLocaleString()})`);
    }
  } else {
    parts.push("### TikTok\n（該当データなし）");
  }

  // Instagram summary
  if (data.instagram.totalCount > 0) {
    const ig = data.instagram;
    parts.push(`### Instagram (${ig.totalCount}本)`);
    for (const v of ig.videos.slice(0, 10)) {
      parts.push(`  - @${v.authorUsername}: "${truncate(v.caption, 100)}" (再生${v.viewCount.toLocaleString()})`);
    }
  }

  return truncate(parts.join("\n"), MAX_SEGMENT_CHARS);
}

/**
 * Format S3 raw data into text for the LLM prompt
 */
function formatS3(data: S3RawData[]): string {
  if (!data || data.length === 0) return "（データなし）";

  const parts: string[] = [];
  for (const entry of data) {
    for (const r of entry.results) {
      parts.push(`- [${r.title}](${r.url})\n  ${r.snippet}\n  ${r.body ? truncate(r.body, 500) : ""}`);
    }
  }
  return truncate(parts.join("\n\n"), MAX_SEGMENT_CHARS);
}

/**
 * Run LLM analysis on collected data
 */
export async function analyzeWithBedrock(
  productName: string,
  s1Data: S1RawData[],
  s2Data: S2RawData,
  s3Data: S3RawData[],
): Promise<AnalysisResult> {
  const userPrompt = buildUserPrompt(
    productName,
    formatS1(s1Data),
    formatS2(s2Data),
    formatS3(s3Data),
  );

  console.log(`[Analyzer] Sending to Bedrock for "${productName}" (prompt ~${userPrompt.length} chars)`);

  const result = await invokeLLM({
    messages: [
      { role: "system", content: CONTEXT_ANALYZER_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 8192,
    responseFormat: {
      type: "json_schema",
      json_schema: ANALYSIS_RESULT_JSON_SCHEMA,
    },
  });

  const raw = result.choices[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";

  // Parse and validate with Zod
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("[Analyzer] Failed to parse LLM response as JSON:", text.slice(0, 500));
    throw new Error("LLM response is not valid JSON");
  }

  const validated = analysisResultSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[Analyzer] Zod validation failed:", validated.error.issues);
    // Return parsed result anyway — partial data is better than none
    return parsed as AnalysisResult;
  }

  return validated.data;
}
