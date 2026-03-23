/**
 * キャンペーンレポート生成ロジック
 * 2つのスナップショット（baseline + measurement）を比較してレポートを生成
 */

import type { Campaign, CampaignSnapshot, InsertCampaignReport } from "../drizzle/schema";
import { estimatePostingFrequency } from "./campaignSnapshot";
import { fetchGoogleTrends, aggregateVideosByDay, pearsonCorrelation } from "./googleTrends";
import { fetchKeywordVolume } from "./googleAds";
import { calculateScoresFromData } from "./videoAnalysis";
import { invokeLLM } from "./_core/llm";

function calcER(v: { view_count: number; like_count: number; comment_count: number; share_count: number }): number {
  if (!v.view_count || v.view_count === 0) return 0;
  return Number(
    ((v.like_count + v.comment_count + v.share_count) / v.view_count * 100).toFixed(2)
  );
}

export async function generateCampaignReport(
  campaign: Campaign,
  baseline: CampaignSnapshot,
  measurement: CampaignSnapshot,
): Promise<Omit<InsertCampaignReport, "id">> {
  const keywords = campaign.keywords || [];
  const competitors = campaign.competitors || [];
  const campaignHashtags = campaign.campaignHashtags || [];

  const positionReport: NonNullable<InsertCampaignReport["positionReport"]> = [];
  const competitorReport: NonNullable<InsertCampaignReport["competitorReport"]> = {};
  const sovReport: NonNullable<InsertCampaignReport["sovReport"]> = {};
  const rippleReport: NonNullable<InsertCampaignReport["rippleReport"]> = {};
  const screenshots: NonNullable<InsertCampaignReport["screenshots"]> = {};

  // ============================
  // 軸1: 自社ポジション変化
  // ============================
  for (const kw of keywords) {
    const before = baseline.searchResults?.[kw];
    const after = measurement.searchResults?.[kw];

    const beforeOwn = before?.own_videos?.[0];
    const afterOwn = after?.own_videos?.[0];

    const beforeER = beforeOwn ? calcER(beforeOwn) : 0;
    const afterER = afterOwn ? calcER(afterOwn) : 0;

    positionReport.push({
      keyword: kw,
      before_rank: beforeOwn?.search_rank ?? null,
      after_rank: afterOwn?.search_rank ?? null,
      rank_change: (beforeOwn?.search_rank != null && afterOwn?.search_rank != null)
        ? beforeOwn.search_rank - afterOwn.search_rank  // 正 = 改善
        : null,
      before_views: beforeOwn?.view_count || 0,
      after_views: afterOwn?.view_count || 0,
      views_change_pct: (beforeOwn?.view_count && beforeOwn.view_count > 0)
        ? (((afterOwn?.view_count || 0) - beforeOwn.view_count) / beforeOwn.view_count * 100).toFixed(1)
        : null,
      before_er: beforeER,
      after_er: afterER,
    });

    // スクリーンショット
    screenshots[kw] = {
      before: before?.screenshot_key || null,
      after: after?.screenshot_key || null,
    };
  }

  // ============================
  // 軸2: 競合比較（Before/After強化）
  // ============================
  for (const kw of keywords) {
    const before = baseline.searchResults?.[kw];
    const after = measurement.searchResults?.[kw];
    const beforeOwn = before?.own_videos?.[0];
    const afterOwn = after?.own_videos?.[0];

    const beforeCompPositions = before?.competitor_positions || [];
    const afterCompPositions = after?.competitor_positions || [];

    // 競合のBefore/After比較をマージ
    const compMap = new Map<string, any>();
    for (const c of afterCompPositions) {
      compMap.set(c.competitor_id, {
        competitor_name: c.competitor_name,
        competitor_id: c.competitor_id,
        best_rank: c.best_rank,
        video_count_in_top30: c.video_count_in_top30,
        before_best_rank: null as number | null,
        before_video_count_in_top30: 0,
        rank_change: null as number | null,
      });
    }
    for (const c of beforeCompPositions) {
      if (compMap.has(c.competitor_id)) {
        const entry = compMap.get(c.competitor_id)!;
        entry.before_best_rank = c.best_rank;
        entry.before_video_count_in_top30 = c.video_count_in_top30;
        if (c.best_rank != null && entry.best_rank != null) {
          entry.rank_change = c.best_rank - entry.best_rank; // 正=改善（順位下がった）
        }
      } else {
        compMap.set(c.competitor_id, {
          competitor_name: c.competitor_name,
          competitor_id: c.competitor_id,
          best_rank: null,
          video_count_in_top30: 0,
          before_best_rank: c.best_rank,
          before_video_count_in_top30: c.video_count_in_top30,
          rank_change: null,
        });
      }
    }

    competitorReport[kw] = {
      own_rank: afterOwn?.search_rank ?? null,
      own_rank_before: beforeOwn?.search_rank ?? null,
      competitors: Array.from(compMap.values()),
      is_top: afterOwn?.search_rank != null &&
        Array.from(compMap.values()).every(c =>
          c.best_rank == null || afterOwn.search_rank <= c.best_rank
        ),
    };

    // シェア・オブ・ボイス（前後比較）
    const beforeSov = baseline.searchResults?.[kw]?.share_of_voice;
    const afterSov = after?.share_of_voice;
    sovReport[kw] = {
      before: beforeSov || { own_count: 0, total_count: 0, percentage: "0" },
      after: afterSov || { own_count: 0, total_count: 0, percentage: "0" },
    };
  }

  // ownVideoData を先に取得（投稿頻度・動画メトリクスで使う）
  const ownVideoData = (campaign as any).ownVideoData as Array<{
    videoId: string; videoUrl: string; coverUrl: string; description: string;
    createTime: number;
    viewCount?: number; likeCount?: number; commentCount?: number;
    shareCount?: number; saveCount?: number;
  }> | undefined;

  // 競合の投稿頻度比較
  const competitorFrequencyReport: NonNullable<InsertCampaignReport["competitorFrequencyReport"]> = [];
  const ownAccountIds = campaign.ownAccountIds || [];

  // 自社の投稿頻度を自社アカウントのプロフィールデータから算出
  const ownPostDates: string[] = [];
  for (const ownId of ownAccountIds) {
    const ownProfile = measurement.competitorProfiles?.[ownId];
    if (ownProfile?.recent_post_dates) {
      ownPostDates.push(...ownProfile.recent_post_dates);
    }
  }
  // フォールバック: ownVideoDataのcreateTimeも使う
  if (ownPostDates.length < 2 && ownVideoData) {
    for (const v of ownVideoData) {
      if (v.createTime) ownPostDates.push(new Date(v.createTime * 1000).toISOString());
    }
  }
  competitorFrequencyReport.push({
    name: "自社",
    is_own: true,
    frequency: estimatePostingFrequency(ownPostDates.length >= 2 ? ownPostDates : null),
  });

  for (const comp of competitors) {
    const compProfile = measurement.competitorProfiles?.[comp.account_id];
    // URLではなく@usernameで表示
    const displayName = (comp.name.includes("tiktok.com") || comp.name.startsWith("http"))
      ? `@${comp.account_id}`
      : compProfile?.name || comp.name;
    competitorFrequencyReport.push({
      name: displayName,
      is_own: false,
      frequency: estimatePostingFrequency(compProfile?.recent_post_dates),
    });
  }

  // ============================
  // 軸3: 波及効果（施策KW/ハッシュタグの増減のみ）
  // ============================
  // keywords 由来のハッシュタグだけに絞る（日傘等の無関係タグを除外）
  const keywordHashtags = keywords
    .map(kw => kw.replace(/^#/, "").toLowerCase())
    .filter(Boolean);
  const brandKws = (campaign.brandKeywords || []).map((b: string) => b.toLowerCase());
  const campaignName = (campaign.name || "").toLowerCase();

  const isRelevantTag = (tag: string): boolean => {
    const lower = tag.toLowerCase();
    // keywords由来のハッシュタグ
    if (keywordHashtags.some(kh => lower.includes(kh) || kh.includes(lower))) return true;
    // ブランドキーワードに一致
    if (brandKws.some(bk => lower.includes(bk) || bk.includes(lower))) return true;
    // キャンペーン名に含まれる
    if (campaignName && (lower.includes(campaignName) || campaignName.includes(lower))) return true;
    // 自社アカウントIDに一致（公式タグ）
    const ownIds = (campaign.ownAccountIds || []).map((id: string) => id.toLowerCase());
    if (ownIds.some(id => lower.includes(id) || id.includes(lower))) return true;
    return false;
  };

  const allRippleTags = [...new Set([
    ...campaignHashtags,
    ...Object.keys(baseline.rippleEffect || {}),
    ...Object.keys(measurement.rippleEffect || {}),
  ])];
  const rippleTags = allRippleTags.filter(isRelevantTag);

  for (const tag of rippleTags) {
    const before = baseline.rippleEffect?.[tag];
    const after = measurement.rippleEffect?.[tag];

    const afterVideos = after?.third_party_videos || after?.omaage_videos || [];

    rippleReport[tag] = {
      before_posts: before?.other_post_count || 0,
      after_posts: after?.other_post_count || 0,
      posts_change: (after?.other_post_count || 0) - (before?.other_post_count || 0),
      posts_change_pct: (before?.other_post_count && before.other_post_count > 0)
        ? (((after?.other_post_count || 0) - before.other_post_count) / before.other_post_count * 100).toFixed(0)
        : null,
      before_total_views: before?.other_total_views || 0,
      after_total_views: after?.other_total_views || 0,
      third_party_videos: afterVideos,
      third_party_count: afterVideos.length,
    };
  }

  // ============================
  // 軸4: 施策動画メトリクス Before/After（Phase 1）
  // ============================
  let videoMetricsReport: InsertCampaignReport["videoMetricsReport"] = undefined;

  if (ownVideoData && ownVideoData.length > 0) {
    const baselineMetrics = baseline.ownVideoMetrics || {};
    const measurementMetrics = measurement.ownVideoMetrics || {};

    videoMetricsReport = ownVideoData.map(v => {
      const bm = baselineMetrics[v.videoId] || null;
      const am = measurementMetrics[v.videoId] || null;

      // ownVideoMetricsが空の場合、ownVideoData（URL登録時のスクレイプデータ）をフォールバック
      const fallbackMetrics = {
        viewCount: v.viewCount || 0,
        likeCount: v.likeCount || 0,
        commentCount: v.commentCount || 0,
        shareCount: v.shareCount || 0,
        saveCount: v.saveCount || 0,
      };

      const effectiveBefore = bm || fallbackMetrics;
      const effectiveAfter = am || fallbackMetrics;

      const beforeViews = effectiveBefore.viewCount || 0;
      const afterViews = effectiveAfter.viewCount || 0;

      // ER計算
      const afterLikes = effectiveAfter.likeCount || 0;
      const afterComments = effectiveAfter.commentCount || 0;
      const afterShares = effectiveAfter.shareCount || 0;
      const er = afterViews > 0
        ? Number(((afterLikes + afterComments + afterShares) / afterViews * 100).toFixed(2))
        : 0;

      return {
        videoId: v.videoId,
        videoUrl: v.videoUrl,
        coverUrl: v.coverUrl,
        description: v.description,
        postedAt: v.createTime ? new Date(v.createTime * 1000).toISOString() : "",
        hashtags: (v as any).hashtags || [],
        duration: (v as any).duration || 0,
        before: effectiveBefore,
        after: effectiveAfter,
        viewsChangePct: beforeViews > 0
          ? ((afterViews - beforeViews) / beforeViews * 100).toFixed(1)
          : null,
        er,
      };
    });
  }

  // ============================
  // 軸5: クロスプラットフォーム（Phase 4）
  // ============================
  let crossPlatformData: InsertCampaignReport["crossPlatformData"] = undefined;

  if (keywords.length > 0 && baseline.capturedAt && measurement.capturedAt) {
    try {
      const primaryKw = keywords[0];
      const startDate = new Date(baseline.capturedAt);
      startDate.setDate(startDate.getDate() - 30); // 30日前から
      const endDate = new Date(measurement.capturedAt);

      const trendsData = await fetchGoogleTrends(primaryKw, startDate, endDate);

      // ownVideoDataから日別集計（ownVideoMetricsが空の場合はownVideoDataのメトリクスをフォールバック）
      const videoTimeline = ownVideoData
        ? aggregateVideosByDay(
            ownVideoData.map(v => ({
              postedAt: v.createTime ? new Date(v.createTime * 1000) : null,
              viewCount: (measurement.ownVideoMetrics?.[v.videoId]?.viewCount) || v.viewCount || 0,
            }))
          )
        : [];

      // ownVideoDataからマーカー生成
      const videoMarkers = (ownVideoData || [])
        .filter(v => v.createTime)
        .map(v => ({
          date: new Date(v.createTime * 1000).toISOString().split("T")[0],
          videoId: v.videoId,
          videoUrl: v.videoUrl,
          description: v.description.slice(0, 50),
        }));

      // 相関係数算出
      let correlation: number | null = null;
      if (trendsData.length >= 3 && videoTimeline.length >= 3) {
        const trendMap = new Map(trendsData.map(t => [t.date, t.value]));
        const commonDates = videoTimeline.filter(v => trendMap.has(v.date)).map(v => v.date);
        if (commonDates.length >= 3) {
          correlation = pearsonCorrelation(
            commonDates.map(d => trendMap.get(d)!),
            commonDates.map(d => videoTimeline.find(v => v.date === d)!.totalViews),
          );
        }
      }

      crossPlatformData = { trendsData, videoTimeline, videoMarkers, correlation };

      // Google Ads キーワード検索ボリューム取得
      try {
        const keywordSearchVolumes = await fetchKeywordVolume(keywords);
        if (keywordSearchVolumes.length > 0) {
          crossPlatformData.keywordSearchVolumes = keywordSearchVolumes;
        }
      } catch (e) {
        console.error("Keyword volume fetch failed (non-fatal):", e);
      }
    } catch (e) {
      console.error("Cross-platform data generation failed:", e);
    }
  }

  // キーワード検索ボリューム単独フォールバック（Trends取得が失敗/スキップされた場合）
  if (keywords.length > 0 && (!crossPlatformData || !crossPlatformData.keywordSearchVolumes)) {
    try {
      const keywordSearchVolumes = await fetchKeywordVolume(keywords);
      if (keywordSearchVolumes.length > 0) {
        if (!crossPlatformData) {
          crossPlatformData = { trendsData: [], videoTimeline: [], videoMarkers: [], correlation: null, keywordSearchVolumes };
        } else {
          crossPlatformData.keywordSearchVolumes = keywordSearchVolumes;
        }
      }
    } catch (e) {
      console.error("Keyword volume standalone fetch failed (non-fatal):", e);
    }
  }

  // ============================
  // 軸7: 動画スコアリング + AI総合レポート（Phase 5）
  // ============================
  let videoScores: InsertCampaignReport["videoScores"] = undefined;
  let aiOverallReport: InsertCampaignReport["aiOverallReport"] = undefined;

  if (ownVideoData && ownVideoData.length > 0) {
    // 動画スコアリング
    const measurementMetrics2 = measurement.ownVideoMetrics || {};
    const scored = ownVideoData.map(v => {
      const metrics = measurementMetrics2[v.videoId];
      const score = calculateScoresFromData({
        desc: v.description,
        duration: (v as any).duration || 0,
        stats: {
          playCount: metrics?.viewCount || v.viewCount || 0,
          diggCount: metrics?.likeCount || v.likeCount || 0,
          commentCount: metrics?.commentCount || v.commentCount || 0,
          shareCount: metrics?.shareCount || v.shareCount || 0,
          collectCount: metrics?.saveCount || v.saveCount || 0,
        },
        hashtags: (v as any).hashtags || [],
        ocrTexts: [],
        transcriptionText: "",
      });
      return {
        videoId: v.videoId,
        videoUrl: v.videoUrl,
        overallScore: score.overallScore,
        aiEvaluation: "", // LLMで後から埋める
      };
    });

    // LLMで動画評価 + 総合レポート生成（1バッチ呼び出し）
    try {
      const videoSummaries = scored.map(s => {
        const v = ownVideoData.find(d => d.videoId === s.videoId);
        const metrics = measurementMetrics2[s.videoId];
        return {
          videoId: s.videoId,
          description: v?.description?.slice(0, 100) || "",
          score: s.overallScore,
          views: metrics?.viewCount || v?.viewCount || 0,
          likes: metrics?.likeCount || v?.likeCount || 0,
          comments: metrics?.commentCount || v?.commentCount || 0,
        };
      });

      const reportDataForLLM = {
        keywords,
        positionReport: positionReport.slice(0, 5),
        videos: videoSummaries,
      };

      const llmResult = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "あなたはTikTokマーケティングの専門アナリストです。施策効果レポートのデータを分析し、総合評価を生成してください。",
          },
          {
            role: "user",
            content: `以下の施策効果データを分析し、JSONで回答してください。

データ:
${JSON.stringify(reportDataForLLM, null, 2)}

以下のJSON形式で回答:
{
  "videoEvaluations": [{"videoId": "...", "evaluation": "30文字以内の一言評価"}],
  "grade": "S/A/B/C/Dのいずれか",
  "summary": "100文字以内の総合サマリー",
  "strengths": ["強み1", "強み2"],
  "weaknesses": ["弱み1", "弱み2"],
  "actionProposals": ["提案1", "提案2", "提案3"]
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 2048,
      });

      const llmContent = llmResult.choices[0]?.message?.content;
      const llmText = typeof llmContent === "string" ? llmContent : "";

      if (llmText) {
        const parsed = JSON.parse(llmText);

        // 動画評価をマージ
        if (parsed.videoEvaluations) {
          for (const ev of parsed.videoEvaluations) {
            const target = scored.find(s => s.videoId === ev.videoId);
            if (target) target.aiEvaluation = ev.evaluation || "";
          }
        }

        aiOverallReport = {
          grade: parsed.grade || "C",
          summary: parsed.summary || "",
          strengths: parsed.strengths || [],
          weaknesses: parsed.weaknesses || [],
          actionProposals: parsed.actionProposals || [],
        };
      }
    } catch (e) {
      console.error("AI report generation failed:", e);
    }

    videoScores = scored;
  }

  // ============================
  // 軸8: ビッグキーワード露出レポート
  // ============================
  let bigKeywordReport: InsertCampaignReport["bigKeywordReport"] = undefined;

  const bigKeywords = (campaign as any).bigKeywords as string[] | undefined;
  if (bigKeywords && bigKeywords.length > 0) {
    type BigKWSnapshot = {
      ownVideosInTop30: Array<{ videoId: string; rank: number; viewCount: number }>;
      competitorPositions?: Array<{ competitor_name: string; competitor_id: string; best_rank: number | null; video_count_in_top30: number }>;
      totalResults: number;
    };
    const baselineBigKW = (baseline as any).bigKeywordResults as Record<string, BigKWSnapshot> | undefined;
    const measurementBigKW = (measurement as any).bigKeywordResults as Record<string, BigKWSnapshot> | undefined;

    bigKeywordReport = bigKeywords.map(kw => {
      const bk = baselineBigKW?.[kw];
      const mk = measurementBigKW?.[kw];

      // 競合のBefore/After比較をマージ
      const compMap = new Map<string, any>();
      for (const c of mk?.competitorPositions || []) {
        compMap.set(c.competitor_id, {
          competitor_name: c.competitor_name,
          competitor_id: c.competitor_id,
          best_rank: c.best_rank,
          video_count_in_top30: c.video_count_in_top30,
          before_best_rank: null as number | null,
          before_video_count_in_top30: 0,
          rank_change: null as number | null,
        });
      }
      for (const c of bk?.competitorPositions || []) {
        if (compMap.has(c.competitor_id)) {
          const entry = compMap.get(c.competitor_id)!;
          entry.before_best_rank = c.best_rank;
          entry.before_video_count_in_top30 = c.video_count_in_top30;
          if (c.best_rank != null && entry.best_rank != null) {
            entry.rank_change = c.best_rank - entry.best_rank;
          }
        } else {
          compMap.set(c.competitor_id, {
            competitor_name: c.competitor_name,
            competitor_id: c.competitor_id,
            best_rank: null,
            video_count_in_top30: 0,
            before_best_rank: c.best_rank,
            before_video_count_in_top30: c.video_count_in_top30,
            rank_change: null,
          });
        }
      }

      return {
        keyword: kw,
        before: {
          ownVideoCount: bk?.ownVideosInTop30?.length || 0,
          bestRank: bk?.ownVideosInTop30?.[0]?.rank ?? null,
        },
        after: {
          ownVideoCount: mk?.ownVideosInTop30?.length || 0,
          bestRank: mk?.ownVideosInTop30?.[0]?.rank ?? null,
        },
        competitors: Array.from(compMap.values()),
      };
    });
  }

  // ============================
  // サマリー
  // ============================
  const mainKw = positionReport[0];
  const mainRipple = campaignHashtags[0] ? rippleReport[campaignHashtags[0]] : undefined;
  const mainSov = keywords[0] ? sovReport[keywords[0]] : undefined;

  const summary: NonNullable<InsertCampaignReport["summary"]> = {
    primary_keyword: keywords[0] || "",
    rank_before: mainKw?.before_rank ?? null,
    rank_after: mainKw?.after_rank ?? null,
    rank_change: mainKw?.rank_change ?? null,
    views_before: mainKw?.before_views || 0,
    views_after: mainKw?.after_views || 0,
    er_before: mainKw?.before_er || 0,
    er_after: mainKw?.after_er || 0,
    sov_before: mainSov?.before?.percentage || "0",
    sov_after: mainSov?.after?.percentage || "0",
    related_posts_before: mainRipple?.before_posts || 0,
    related_posts_after: mainRipple?.after_posts || 0,
    omaage_count: mainRipple?.third_party_count || mainRipple?.omaage_count || 0,
  };

  // ============================
  // 注記
  // ============================
  const notes = [
    "検索順位はスナップショット取得時点のものであり、TikTokの検索結果はリアルタイムに変動します。",
    "検索結果はシークレットモード（未ログイン状態）で取得しており、パーソナライズの影響を最小化していますが、完全に排除されるものではありません。",
    "第三者投稿は、キャンペーンハッシュタグ検索結果のうち自社投稿を除いた動画です。",
    "本レポートは「施策実施期間中の変化」を示すものであり、全ての変化が施策に起因することを保証するものではありません。",
  ];

  return {
    campaignId: campaign.id,
    baselineDate: baseline.capturedAt,
    measurementDate: measurement.capturedAt,
    summary,
    positionReport,
    competitorReport,
    sovReport,
    competitorFrequencyReport,
    rippleReport,
    screenshots,
    notes,
    videoMetricsReport,
    crossPlatformData,
    videoScores,
    aiOverallReport,
    bigKeywordReport,
  };
}

// ============================
// CSVエクスポート
// ============================

export function generateCampaignCsv(report: InsertCampaignReport): string {
  const lines: string[] = [];
  const BOM = "\uFEFF";

  // Header
  lines.push("セクション,キーワード/タグ,指標,施策前,施策後,変動");

  // サマリー
  const s = report.summary;
  if (s) {
    lines.push(`サマリー,${s.primary_keyword},検索順位,${s.rank_before ?? "-"},${s.rank_after ?? "-"},${s.rank_change != null ? (s.rank_change > 0 ? `+${s.rank_change}位改善` : `${s.rank_change}位`) : "-"}`);
    lines.push(`サマリー,${s.primary_keyword},再生数,${s.views_before},${s.views_after},${s.views_after - s.views_before}`);
    lines.push(`サマリー,${s.primary_keyword},ER,${s.er_before}%,${s.er_after}%,${(s.er_after - s.er_before).toFixed(2)}pt`);
    lines.push(`サマリー,${s.primary_keyword},SOV,${s.sov_before}%,${s.sov_after}%,`);
  }

  // 自社ポジション
  for (const p of report.positionReport || []) {
    lines.push(`自社ポジション,${p.keyword},検索順位,${p.before_rank ?? "圏外"},${p.after_rank ?? "圏外"},${p.rank_change != null ? `${p.rank_change > 0 ? "+" : ""}${p.rank_change}` : "-"}`);
    lines.push(`自社ポジション,${p.keyword},再生数,${p.before_views},${p.after_views},${p.views_change_pct ? `${p.views_change_pct}%` : "-"}`);
    lines.push(`自社ポジション,${p.keyword},ER,${p.before_er}%,${p.after_er}%,${(p.after_er - p.before_er).toFixed(2)}pt`);
  }

  // 競合比較
  for (const [kw, data] of Object.entries(report.competitorReport || {})) {
    lines.push(`競合比較,${kw},自社順位,,${data.own_rank ?? "圏外"},`);
    for (const comp of data.competitors) {
      lines.push(`競合比較,${kw},${comp.competitor_name}順位,,${comp.best_rank ?? "圏外"},Top30内${comp.video_count_in_top30}本`);
    }
  }

  // SOV
  for (const [kw, data] of Object.entries(report.sovReport || {})) {
    lines.push(`SOV,${kw},占有率,${data.before.percentage}%,${data.after.percentage}%,${data.before.own_count}/${data.before.total_count}→${data.after.own_count}/${data.after.total_count}`);
  }

  // 波及効果
  for (const [tag, data] of Object.entries(report.rippleReport || {})) {
    lines.push(`波及効果,${tag},関連投稿数,${data.before_posts},${data.after_posts},${data.posts_change_pct ? `${data.posts_change_pct}%` : "-"}`);
    lines.push(`波及効果,${tag},総再生数,${data.before_total_views},${data.after_total_views},`);
    lines.push(`波及効果,${tag},第三者投稿数,,${data.third_party_count || data.omaage_count || 0},`);
  }

  // 投稿頻度
  for (const entry of report.competitorFrequencyReport || []) {
    const freq = entry.frequency;
    lines.push(`投稿頻度,${entry.name},週あたり投稿数,,${freq ? freq.posts_per_week : "-"},${entry.is_own ? "自社" : "競合"}`);
  }

  // 施策動画メトリクス
  for (const v of report.videoMetricsReport || []) {
    lines.push(`施策動画,${v.videoId},再生数,${v.before?.viewCount ?? "-"},${v.after?.viewCount ?? "-"},${v.viewsChangePct ? `${v.viewsChangePct}%` : "-"}`);
    lines.push(`施策動画,${v.videoId},いいね,${v.before?.likeCount ?? "-"},${v.after?.likeCount ?? "-"},`);
  }

  // キーワード検索ボリューム
  const kwVolumes = (report.crossPlatformData as any)?.keywordSearchVolumes as Array<{ keyword: string; avgMonthlySearches: number; competition: string; competitionIndex: number }> | undefined;
  if (kwVolumes && kwVolumes.length > 0) {
    for (const kv of kwVolumes) {
      lines.push(`検索ボリューム,${kv.keyword},月間検索数,,${kv.avgMonthlySearches},競合性: ${kv.competition} (${kv.competitionIndex})`);
    }
  }

  // AI総合評価
  const ai = report.aiOverallReport;
  if (ai) {
    lines.push(`AI評価,,ランク,,${ai.grade},`);
    lines.push(`AI評価,,サマリー,,${ai.summary.replace(/,/g, "、")},`);
  }

  // Escape CSV values
  const csvContent = lines.map(line => {
    return line.split(",").map(cell => {
      if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(",");
  }).join("\n");

  return BOM + csvContent;
}
