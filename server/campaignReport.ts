/**
 * キャンペーンレポート生成ロジック
 * 2つのスナップショット（baseline + measurement）を比較してレポートを生成
 */

import type { Campaign, CampaignSnapshot, InsertCampaignReport } from "../drizzle/schema";
import { estimatePostingFrequency } from "./campaignSnapshot";

function calcER(v: { view_count: number; like_count: number; comment_count: number; share_count: number }): number {
  if (!v.view_count || v.view_count === 0) return 0;
  return Number(
    ((v.like_count + v.comment_count + v.share_count) / v.view_count * 100).toFixed(2)
  );
}

export function generateCampaignReport(
  campaign: Campaign,
  baseline: CampaignSnapshot,
  measurement: CampaignSnapshot,
): Omit<InsertCampaignReport, "id"> {
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
  // 軸2: 競合比較
  // ============================
  for (const kw of keywords) {
    const after = measurement.searchResults?.[kw];
    const afterOwn = after?.own_videos?.[0];

    const compPositions = after?.competitor_positions || [];

    competitorReport[kw] = {
      own_rank: afterOwn?.search_rank ?? null,
      competitors: compPositions,
      is_top: afterOwn?.search_rank != null &&
        compPositions.every(c =>
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

  // 競合の投稿頻度比較
  const competitorFrequencyReport: NonNullable<InsertCampaignReport["competitorFrequencyReport"]> = [];

  competitorFrequencyReport.push({
    name: "自社",
    is_own: true,
    frequency: null, // Phase1ではスキップ
  });

  for (const comp of competitors) {
    const compProfile = measurement.competitorProfiles?.[comp.account_id];
    competitorFrequencyReport.push({
      name: comp.name,
      is_own: false,
      frequency: estimatePostingFrequency(compProfile?.recent_post_dates),
    });
  }

  // ============================
  // 軸3: 波及効果
  // ============================
  for (const tag of campaignHashtags) {
    const before = baseline.rippleEffect?.[tag];
    const after = measurement.rippleEffect?.[tag];

    rippleReport[tag] = {
      before_posts: before?.other_post_count || 0,
      after_posts: after?.other_post_count || 0,
      posts_change: (after?.other_post_count || 0) - (before?.other_post_count || 0),
      posts_change_pct: (before?.other_post_count || 0) > 0
        ? (((after?.other_post_count || 0) - before.other_post_count) / before.other_post_count * 100).toFixed(0)
        : null,
      before_total_views: before?.other_total_views || 0,
      after_total_views: after?.other_total_views || 0,
      omaage_videos: after?.omaage_videos || [],
      omaage_count: (after?.omaage_videos || []).length,
    };
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
    omaage_count: mainRipple?.omaage_count || 0,
  };

  // ============================
  // 注記
  // ============================
  const notes = [
    "検索順位はスナップショット取得時点のものであり、TikTokの検索結果はリアルタイムに変動します。",
    "検索結果はシークレットモード（未ログイン状態）で取得しており、パーソナライズの影響を最小化していますが、完全に排除されるものではありません。",
    "オマージュ動画の判定はハッシュタグ・ブランドキーワードベースの簡易判定です。",
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
    lines.push(`波及効果,${tag},オマージュ動画数,,${data.omaage_count},`);
  }

  // 投稿頻度
  for (const entry of report.competitorFrequencyReport || []) {
    const freq = entry.frequency;
    lines.push(`投稿頻度,${entry.name},週あたり投稿数,,${freq ? freq.posts_per_week : "-"},${entry.is_own ? "自社" : "競合"}`);
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
