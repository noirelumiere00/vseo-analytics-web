/**
 * キャンペーンレポート生成ロジック
 * 2つのスナップショット（baseline + measurement）を比較してレポートを生成
 * baseline が null の場合は measurement のみで絶対値レポートを生成
 */

import type { Campaign, CampaignSnapshot, InsertCampaignReport, SovSlot } from "../drizzle/schema";
import { estimatePostingFrequency } from "./campaignSnapshot";
import { classifyVideoGenre, detectVideoLabels } from "../shared/const";
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

function buildSlots(
  resultData: any,
  campaignVideoIds: Set<string>,
  ownAccountIdsLower: Set<string>,
  campaignAuthorIds: Set<string>,
  competitorsMap: Map<string, string>,
): SovSlot[] {
  if (!resultData?.all_videos) return [];

  const allVideos = (resultData.all_videos as any[])
    .filter((v: any) => v.search_rank <= 10)
    .sort((a: any, b: any) => a.search_rank - b.search_rank);

  return allVideos.map((v: any): SovSlot => {
    const userLower = (v.creator_username || "").toLowerCase();
    const isOwnAccount = ownAccountIdsLower.has(userLower);
    const isCampaignVideo = campaignVideoIds.has(v.video_id) || campaignAuthorIds.has(userLower);
    const competitorName = competitorsMap.get(userLower);

    let owner: SovSlot["owner"] = "other";
    let ownerDetail: SovSlot["owner_detail"] = undefined;
    let ownerName: string | undefined = undefined;

    if (isOwnAccount || isCampaignVideo) {
      owner = "own";
      if (isOwnAccount && isCampaignVideo) {
        ownerDetail = ["official", "campaign"];
      } else if (isOwnAccount) {
        ownerDetail = "official";
      } else {
        ownerDetail = "campaign";
      }
    } else if (competitorName != null) {
      owner = "competitor";
      ownerName = competitorName;
    }

    return {
      rank: v.search_rank,
      video_id: v.video_id,
      video_url: v.video_url || `https://www.tiktok.com/@${v.creator_username}/video/${v.video_id}`,
      creator_username: v.creator_username || "",
      description: (v.description || "").slice(0, 80),
      hashtags: v.hashtags || [],
      view_count: v.view_count || 0,
      like_count: v.like_count || 0,
      comment_count: v.comment_count || 0,
      share_count: v.share_count || 0,
      owner,
      owner_name: ownerName,
      owner_detail: ownerDetail,
      genre: classifyVideoGenre(v.description || "", v.hashtags || []),
      tiktok_labels: detectVideoLabels(v.description || "", v.hashtags || [], v.is_ad, v.aigc_description),
      cover_url: v.cover_url || "",
    };
  });
}

export async function generateCampaignReport(
  campaign: Campaign,
  baseline: CampaignSnapshot | null,
  measurement: CampaignSnapshot,
): Promise<Omit<InsertCampaignReport, "id">> {
  const keywords = campaign.keywords || [];
  const competitors = campaign.competitors || [];
  const campaignHashtags = campaign.campaignHashtags || [];

  const positionReport: NonNullable<InsertCampaignReport["positionReport"]> = [];
  const competitorReport: NonNullable<InsertCampaignReport["competitorReport"]> = {};
  const sovReport: NonNullable<InsertCampaignReport["sovReport"]> = {};
  const rippleReport: NonNullable<InsertCampaignReport["rippleReport"]> = {};

  // 施策動画のビデオID集合（own_videosが空でもall_videosからマッチ可能にする）
  const ownVideoData = (campaign as any).ownVideoData as Array<{ videoId: string }> | undefined;
  const campaignVideoIds = new Set<string>([
    ...(campaign.ownVideoIds || []),
    ...(ownVideoData || []).map(v => v.videoId).filter(Boolean),
  ]);
  const ownAccountIdsLower = new Set((campaign.ownAccountIds || []).map((id: string) => id.toLowerCase()));

  // 施策動画の投稿者ID（buildSlots用）
  const ownVideoDataForAuthors = (campaign as any).ownVideoData as Array<{ videoId: string; authorUniqueId: string }> | undefined;
  const campaignAuthorIds = new Set<string>();
  if (ownVideoDataForAuthors) {
    for (const v of ownVideoDataForAuthors) {
      if (v.authorUniqueId) campaignAuthorIds.add(v.authorUniqueId.toLowerCase());
    }
  }
  // 競合のルックアップマップ（accountId → 表示名）
  const competitorsMap = new Map<string, string>();
  for (const c of competitors) {
    competitorsMap.set(c.account_id.toLowerCase(), c.name);
  }

  // all_videos から施策動画を検索するヘルパー
  const findCampaignVideosInResults = (resultData: any): any[] => {
    if (!resultData) return [];
    // まず own_videos を使う（新コードのスナップショット）
    if (resultData.own_videos?.length > 0) return resultData.own_videos;
    // フォールバック: all_videos からビデオID・アカウントIDでマッチ
    if (!resultData.all_videos) return [];
    return resultData.all_videos.filter((v: any) =>
      campaignVideoIds.has(v.video_id) || ownAccountIdsLower.has((v.creator_username || "").toLowerCase())
    );
  };

  // ============================
  // 軸1: 自社ポジション変化
  // ============================
  for (const kw of keywords) {
    const before = baseline?.searchResults?.[kw];
    const after = measurement.searchResults?.[kw];

    const beforeOwnAll = findCampaignVideosInResults(before);
    const afterOwnAll = findCampaignVideosInResults(after);
    const beforeOwn = beforeOwnAll[0];
    const afterOwn = afterOwnAll[0];

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
      videos: afterOwnAll.map((v: any) => ({
        video_id: v.video_id,
        username: v.creator_username || "",
        description: (v.description || "").slice(0, 40),
        search_rank: v.search_rank,
        view_count: v.view_count || 0,
      })),
    });

  }

  // ============================
  // 軸2: 競合比較（Before/After強化）
  // ============================
  for (const kw of keywords) {
    const before = baseline?.searchResults?.[kw];
    const after = measurement.searchResults?.[kw];
    const beforeOwn = findCampaignVideosInResults(before)[0];
    const afterOwn = findCampaignVideosInResults(after)[0];

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

    // シェア・オブ・ボイス（前後比較） — 保存値が不正確な場合はall_videosから再計算
    const recalcSov = (resultData: any) => {
      if (!resultData) return { own_count: 0, total_count: 0, percentage: "0" };
      const saved = resultData.share_of_voice;
      // saved.own_count > 0 なら信頼できる（新コードのスナップショット）
      if (saved && saved.own_count > 0) return saved;
      // all_videosから再計算
      const allVids = resultData.all_videos || [];
      const ownCount = allVids.filter((v: any) =>
        campaignVideoIds.has(v.video_id) || ownAccountIdsLower.has((v.creator_username || "").toLowerCase())
      ).length;
      const total = allVids.length;
      return {
        own_count: ownCount,
        total_count: total,
        percentage: total > 0 ? (ownCount / total * 100).toFixed(1) : "0",
      };
    };
    sovReport[kw] = {
      before: recalcSov(before),
      after: recalcSov(after),
      before_slots: before ? buildSlots(before, campaignVideoIds, ownAccountIdsLower, campaignAuthorIds, competitorsMap) : undefined,
      after_slots: buildSlots(after, campaignVideoIds, ownAccountIdsLower, campaignAuthorIds, competitorsMap),
    };
  }

  // ビッグKWのSOVスロット生成（施策動画がTop10に入っている場合のみ）
  const bigKws = (campaign as any).bigKeywords as string[] | undefined;
  const measurementBigKW = (measurement as any).bigKeywordResults as Record<string, any> | undefined;
  const baselineBigKW = (baseline as any)?.bigKeywordResults as Record<string, any> | undefined;
  if (bigKws && measurementBigKW) {
    for (const bkw of bigKws) {
      const mk = measurementBigKW[bkw];
      if (!mk?.all_videos) continue;
      const afterSlots = buildSlots(mk, campaignVideoIds, ownAccountIdsLower, campaignAuthorIds, competitorsMap);
      const hasOwnInTop10 = afterSlots.some(s => s.owner === "own");
      if (!hasOwnInTop10) continue;
      const bk = baselineBigKW?.[bkw];
      sovReport[bkw] = {
        before: recalcSov(bk),
        after: recalcSov(mk),
        before_slots: bk?.all_videos ? buildSlots(bk, campaignVideoIds, ownAccountIdsLower, campaignAuthorIds, competitorsMap) : undefined,
        after_slots: afterSlots,
        _isBigKeyword: true,
      };
    }
  }

  // ownVideoData は上部で取得済み（施策動画マッチ用）— 投稿頻度・動画メトリクスでも使う
  const ownVideoDataFull = (campaign as any).ownVideoData as Array<{
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
  if (ownPostDates.length < 2 && ownVideoDataFull) {
    for (const v of ownVideoDataFull) {
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
    ...Object.keys(baseline?.rippleEffect || {}),
    ...Object.keys(measurement.rippleEffect || {}),
  ])];
  const rippleTags = allRippleTags.filter(isRelevantTag);

  // 施策動画の最も早い公開日を取得（波及効果の日付フィルタ用）
  const ownCreateTimes = (ownVideoDataFull || [])
    .map(v => v.createTime)
    .filter((t): t is number => t != null && t > 0);
  const earliestOwnPublishMs = ownCreateTimes.length > 0
    ? Math.min(...ownCreateTimes) * 1000
    : 0;

  // 自社動画除外セット（ownAccountIds + ownVideoDataのauthorUniqueId/videoId）
  const ownAccountsForRipple = new Set([
    ...(campaign.ownAccountIds || []).map((id: string) => id.toLowerCase()),
    ...(ownVideoDataFull || []).map(v => (v as any).authorUniqueId?.toLowerCase()).filter(Boolean),
  ]);
  const ownVideoIdsForRipple = new Set(
    (ownVideoDataFull || []).map(v => v.videoId).filter(Boolean),
  );

  for (const tag of rippleTags) {
    const before = baseline?.rippleEffect?.[tag];
    const after = measurement.rippleEffect?.[tag];

    let afterVideos = after?.third_party_videos || after?.omaage_videos || [];

    // 自社動画を除外（スナップショット収集時に漏れたケースに対応）
    afterVideos = afterVideos.filter((v: any) => {
      const creatorLower = (v.creator || "").toLowerCase();
      if (ownAccountsForRipple.has(creatorLower)) return false;
      const urlVideoId = (v.video_url || "").match(/video\/(\d+)/)?.[1] || "";
      if (urlVideoId && ownVideoIdsForRipple.has(urlVideoId)) return false;
      return true;
    });

    // 施策動画公開日以降の第三者投稿のみに絞り込み
    if (earliestOwnPublishMs > 0) {
      afterVideos = afterVideos.filter((v: any) => {
        if (!v.posted_at) return true;
        return new Date(v.posted_at).getTime() >= earliestOwnPublishMs;
      });
    }

    const filteredViews = afterVideos.reduce((sum: number, v: any) => sum + (v.views || 0), 0);

    rippleReport[tag] = {
      before_posts: before?.other_post_count || 0,
      after_posts: afterVideos.length,
      posts_change: afterVideos.length - (before?.other_post_count || 0),
      posts_change_pct: (before?.other_post_count && before.other_post_count > 0)
        ? ((afterVideos.length - before.other_post_count) / before.other_post_count * 100).toFixed(0)
        : null,
      before_total_views: before?.other_total_views || 0,
      after_total_views: filteredViews,
      third_party_videos: afterVideos,
      third_party_count: afterVideos.length,
    };
  }

  // ============================
  // 軸4: 施策動画メトリクス Before/After（Phase 1）
  // ============================
  let videoMetricsReport: InsertCampaignReport["videoMetricsReport"] = undefined;

  if (ownVideoDataFull && ownVideoDataFull.length > 0) {
    const baselineMetrics = baseline?.ownVideoMetrics || {};
    const measurementMetrics = measurement.ownVideoMetrics || {};

    videoMetricsReport = ownVideoDataFull.map(v => {
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

      // baseline が null の場合は before も null（比較データなし）
      const effectiveBefore = baseline ? (bm || fallbackMetrics) : null;
      const effectiveAfter = am || fallbackMetrics;

      const beforeViews = effectiveBefore?.viewCount || 0;
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
        viewsChangePct: (baseline && beforeViews > 0)
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

  if (keywords.length > 0 && measurement.capturedAt) {
    try {
      const primaryKw = keywords[0];
      const startDate = baseline?.capturedAt
        ? new Date(baseline.capturedAt)
        : new Date(measurement.capturedAt);
      startDate.setDate(startDate.getDate() - 30); // 30日前から
      const endDate = new Date(measurement.capturedAt);

      const trendsData = await fetchGoogleTrends(primaryKw, startDate, endDate);

      // ownVideoDataから日別集計（ownVideoMetricsが空の場合はownVideoDataのメトリクスをフォールバック）
      const videoTimeline = ownVideoDataFull
        ? aggregateVideosByDay(
            ownVideoDataFull.map(v => ({
              postedAt: v.createTime ? new Date(v.createTime * 1000) : null,
              viewCount: (measurement.ownVideoMetrics?.[v.videoId]?.viewCount) || v.viewCount || 0,
            }))
          )
        : [];

      // ownVideoDataからマーカー生成
      const videoMarkers = (ownVideoDataFull || [])
        .filter(v => v.createTime)
        .map(v => ({
          date: new Date(v.createTime * 1000).toISOString().split("T")[0],
          videoId: v.videoId,
          videoUrl: v.videoUrl,
          description: v.description.slice(0, 50),
        }));

      // 相関係数算出（施策動画 + 第三者投稿の合算再生数 × Google Trends）
      let correlation: number | null = null;
      {
        const trendMap = new Map(trendsData.map(t => [t.date, t.value]));
        // 施策動画の日次再生数
        const combinedViewsMap = new Map<string, number>();
        for (const v of videoTimeline) {
          combinedViewsMap.set(v.date, (combinedViewsMap.get(v.date) || 0) + (v.totalViews || 0));
        }
        // 第三者投稿の日次再生数を加算（タグ間の重複除外）
        const rippleData = measurement.rippleEffect || {};
        const seenVideos = new Set<string>();
        for (const tagData of Object.values(rippleData)) {
          const videos = (tagData as any)?.third_party_videos || [];
          for (const v of videos) {
            if (!v.posted_at || !v.views) continue;
            const key = v.video_url || `${v.creator}:${v.description}`;
            if (seenVideos.has(key)) continue;
            seenVideos.add(key);
            const date = new Date(v.posted_at).toISOString().split("T")[0];
            combinedViewsMap.set(date, (combinedViewsMap.get(date) || 0) + (v.views || 0));
          }
        }
        const commonDates = [...combinedViewsMap.keys()].filter(d => trendMap.has(d)).sort();
        if (trendsData.length >= 3 && commonDates.length >= 3) {
          correlation = pearsonCorrelation(
            commonDates.map(d => trendMap.get(d)!),
            commonDates.map(d => combinedViewsMap.get(d)!),
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

  if (ownVideoDataFull && ownVideoDataFull.length > 0) {
    // 動画スコアリング
    const measurementMetrics2 = measurement.ownVideoMetrics || {};
    const scored = ownVideoDataFull.map(v => {
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
        const v = ownVideoDataFull.find(d => d.videoId === s.videoId);
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
    const baselineBigKW = (baseline as any)?.bigKeywordResults as Record<string, BigKWSnapshot> | undefined;
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

      // 動画詳細を付与（複数ソースからフォールバック）
      const videoDataMap = new Map((ownVideoDataFull || []).map(v => [v.videoId, v]));
      // searchResults.all_videos から videoId→username+description のルックアップ
      const allVideoLookup = new Map<string, { username: string; description: string }>();
      for (const srData of Object.values(measurement.searchResults || {})) {
        for (const v of (srData as any)?.all_videos || []) {
          if (v.video_id && v.creator_username && !allVideoLookup.has(v.video_id)) {
            allVideoLookup.set(v.video_id, { username: v.creator_username, description: v.description || "" });
          }
        }
      }
      // 施策KW関連フィルタ: 施策KW/ハッシュタグの内容が含まれる動画のみ
      const campaignTerms = [
        ...keywords.map(k => k.replace(/^#/, "").toLowerCase()),
        ...campaignHashtags.map(h => h.replace(/^#/, "").toLowerCase()),
      ].filter(Boolean);
      const ownVideos = (mk?.ownVideosInTop30 || []).map((ov: any) => {
        const vd = videoDataMap.get(ov.videoId);
        const srMatch = allVideoLookup.get(ov.videoId);
        const desc = (vd?.description || ov.description || srMatch?.description || "").toLowerCase();
        const username = (vd as any)?.authorUniqueId
          || vd?.videoUrl?.match(/@([^/]+)/)?.[1]
          || ov.username
          || srMatch?.username
          || (campaign.ownAccountIds || [])[0]
          || "";
        return {
          videoId: ov.videoId,
          username,
          description: (vd?.description || ov.description || srMatch?.description || "").slice(0, 40),
          rank: ov.rank,
          viewCount: ov.viewCount,
          _desc: desc, // フィルタ用
        };
      }).filter((v: any) => {
        // 登録済み施策動画はそのまま通す
        if (campaignVideoIds.has(v.videoId)) return true;
        // 施策KW検索結果にも出現した動画は関連性あり
        if (allVideoLookup.has(v.videoId)) return true;
        // descriptionがある場合は施策KW関連のコンテンツかチェック
        if (v._desc && campaignTerms.some(term => v._desc.includes(term))) return true;
        // いずれにも該当しない → 施策と無関係
        return false;
      }).map(({ _desc, ...rest }: any) => rest);

      return {
        keyword: kw,
        before: {
          ownVideoCount: bk?.ownVideosInTop30?.length || 0,
          bestRank: bk?.ownVideosInTop30?.[0]?.rank ?? null,
        },
        after: {
          ownVideoCount: ownVideos.length,
          bestRank: ownVideos.length > 0 ? Math.min(...ownVideos.map((v: any) => v.rank)) : null,
        },
        competitors: Array.from(compMap.values()),
        ownVideos,
      };
    });
  }

  // ============================
  // サマリー
  // ============================
  // 最もパフォーマンスが良いKW（after_rank があるものを優先、なければ after_views が最大）
  const mainKw = positionReport.find(p => p.after_rank != null)
    || positionReport.reduce((best, p) => (p.after_views > (best?.after_views || 0) ? p : best), positionReport[0]);
  const mainKwName = mainKw?.keyword || keywords[0] || "";
  const mainRipple = campaignHashtags[0] ? rippleReport[campaignHashtags[0]] : undefined;

  // 平均検索順位（ランクインしているKWのみ）
  const rankedKws = positionReport.filter(p => p.after_rank != null);
  const avgRankAfter = rankedKws.length > 0
    ? Number((rankedKws.reduce((s, p) => s + p.after_rank!, 0) / rankedKws.length).toFixed(1))
    : null;
  const rankedKwsBefore = positionReport.filter(p => p.before_rank != null);
  const avgRankBefore = rankedKwsBefore.length > 0
    ? Number((rankedKwsBefore.reduce((s, p) => s + p.before_rank!, 0) / rankedKwsBefore.length).toFixed(1))
    : null;

  // 施策動画全体の合算メトリクス
  let totalViewsAfter = 0, totalViewsBefore = 0;
  let totalLikesAfter = 0, totalCommentsAfter = 0, totalSharesAfter = 0;
  let totalLikesBefore = 0, totalCommentsBefore = 0, totalSharesBefore = 0;
  if (ownVideoDataFull && ownVideoDataFull.length > 0) {
    const mMetrics = measurement.ownVideoMetrics || {};
    const bMetrics = baseline?.ownVideoMetrics || {};
    for (const v of ownVideoDataFull) {
      const am = mMetrics[v.videoId];
      totalViewsAfter += am?.viewCount || v.viewCount || 0;
      totalLikesAfter += am?.likeCount || v.likeCount || 0;
      totalCommentsAfter += am?.commentCount || v.commentCount || 0;
      totalSharesAfter += am?.shareCount || v.shareCount || 0;
      if (baseline) {
        const bm = bMetrics[v.videoId];
        if (bm) {
          totalViewsBefore += bm.viewCount || 0;
          totalLikesBefore += bm.likeCount || 0;
          totalCommentsBefore += bm.commentCount || 0;
          totalSharesBefore += bm.shareCount || 0;
        }
      }
    }
  }
  const campaignErAfter = totalViewsAfter > 0
    ? Number(((totalLikesAfter + totalCommentsAfter + totalSharesAfter) / totalViewsAfter * 100).toFixed(2))
    : 0;
  const campaignErBefore = totalViewsBefore > 0
    ? Number(((totalLikesBefore + totalCommentsBefore + totalSharesBefore) / totalViewsBefore * 100).toFixed(2))
    : 0;

  // SOV: 最もSOVが高いKWを採用
  let bestSovEntry: { keyword: string; sov: any } | null = null;
  for (const [kw, sov] of Object.entries(sovReport)) {
    const pct = parseFloat(sov.after?.percentage || "0");
    if (!bestSovEntry || pct > parseFloat(bestSovEntry.sov.after?.percentage || "0")) {
      bestSovEntry = { keyword: kw, sov };
    }
  }

  // 第三者投稿の重複除外集計（施策動画が十分に上位表示されたタグのみ）
  // ブランド全体タグ（SOV own_count < 2）を除外し、施策KW固有の波及のみカウント
  const specificSovTags = new Set<string>();
  for (const [kw, sov] of Object.entries(sovReport)) {
    if ((sov.after?.own_count || 0) >= 2) {
      specificSovTags.add(kw.trim().toLowerCase());
    }
  }
  const seenRippleVideos = new Set<string>();
  let thirdPartyCount = 0, thirdPartyTotalViews = 0;
  for (const [tag, tagData] of Object.entries(rippleReport)) {
    const isSpecific = specificSovTags.size === 0 || specificSovTags.has(tag.trim().toLowerCase());
    for (const v of (tagData.third_party_videos || [])) {
      const key = v.video_url || `${v.creator}:${v.description}`;
      if (seenRippleVideos.has(key)) continue;
      seenRippleVideos.add(key);
      if (isSpecific) {
        thirdPartyCount++;
        thirdPartyTotalViews += v.views || 0;
      }
    }
  }

  const summary: NonNullable<InsertCampaignReport["summary"]> = {
    primary_keyword: mainKwName,
    rank_before: mainKw?.before_rank ?? null,
    rank_after: mainKw?.after_rank ?? null,
    rank_change: mainKw?.rank_change ?? null,
    views_before: totalViewsBefore || mainKw?.before_views || 0,
    views_after: totalViewsAfter || mainKw?.after_views || 0,
    er_before: campaignErBefore || mainKw?.before_er || 0,
    er_after: campaignErAfter || mainKw?.after_er || 0,
    sov_before: bestSovEntry?.sov?.before?.percentage || "0",
    sov_after: bestSovEntry?.sov?.after?.percentage || "0",
    related_posts_before: mainRipple?.before_posts || 0,
    related_posts_after: mainRipple?.after_posts || 0,
    omaage_count: mainRipple?.third_party_count || mainRipple?.omaage_count || 0,
    // 新フィールド
    avg_rank_after: avgRankAfter,
    avg_rank_before: avgRankBefore,
    ranked_keyword_count: rankedKws.length,
    total_keyword_count: positionReport.length,
    campaign_video_count: ownVideoDataFull?.length || 0,
    best_sov_keyword: bestSovEntry?.keyword || "",
    third_party_count_deduped: thirdPartyCount,
    third_party_total_views: thirdPartyTotalViews,
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
    baselineDate: baseline?.capturedAt ?? null,
    measurementDate: measurement.capturedAt,
    summary,
    positionReport,
    competitorReport,
    sovReport,
    competitorFrequencyReport,
    rippleReport,
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
