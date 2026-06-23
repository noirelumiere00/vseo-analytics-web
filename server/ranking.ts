/**
 * 表示順位（ランキング）算出ロジック。
 *
 * 3シークレット検索の「各セッションでの出現順（searchData）」から、
 * 各動画の順位情報（avgRank / dominanceScore / appearanceCount）を求める純粋関数。
 *
 * server/routers.ts（API getById）と scripts/scrape-ranking.ts（CLI）で共有し、
 * 順位ロジックの二重実装を避ける。ネットワーク/DB/LLM 非依存。
 */

export interface RankSearchSession {
  sessionIndex: number;
  videoIds: string[];
}

export interface RankInfo {
  /** 各セッションでの順位（1始まり）。出現しなかったセッションは null */
  ranks: (number | null)[];
  /** 出現したセッションでの平均順位（未出現は 999） */
  avgRank: number;
  /** Σ(1/rank) / numSessions × 100。高いほど上位に安定して表示される */
  dominanceScore: number;
  /** 出現したセッション数（1..numSessions） */
  appearanceCount: number;
}

/**
 * 各動画の「出現したセッション数」を数える。
 * 1セッション内に同じ動画が複数回出ても 1 回として扱う。
 */
export function computeVideoAppearanceCount(
  searchData: RankSearchSession[],
): Map<string, number> {
  const count = new Map<string, number>();
  for (const session of searchData) {
    const seen = new Set<string>();
    for (const vid of session.videoIds) {
      if (!seen.has(vid)) {
        seen.add(vid);
        count.set(vid, (count.get(vid) || 0) + 1);
      }
    }
  }
  return count;
}

/**
 * 出現回数別に videoId をグループ化（numSessions..1）。
 * routers.ts の API 返却 appearanceCountMap と同じ形。
 */
export function computeAppearanceCountMap(
  appearanceCount: Map<string, number>,
  numSessions: number,
): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  for (let c = numSessions; c >= 1; c--) {
    map[c] = [];
  }
  for (const [videoId, count] of appearanceCount.entries()) {
    const clamped = Math.min(count, numSessions || count);
    if (!map[clamped]) map[clamped] = [];
    map[clamped].push(videoId);
  }
  return map;
}

/**
 * 各動画の順位情報を算出する。
 *
 * @param searchData    各セッションの順序付き videoIds
 * @param allVideoIds   順位を出す対象の videoId 一覧（出現回数降順などの並びでよい）
 * @param numSessions   セッション数
 * @param appearanceCount 事前計算済みの出現回数 Map（省略時は内部で計算）
 */
export function computeRankInfo(
  searchData: RankSearchSession[],
  allVideoIds: string[],
  numSessions: number,
  appearanceCount?: Map<string, number>,
): Record<string, RankInfo> {
  const rankInfo: Record<string, RankInfo> = {};
  if (!searchData || numSessions <= 0) return rankInfo;

  const counts = appearanceCount ?? computeVideoAppearanceCount(searchData);

  for (const videoId of allVideoIds) {
    const ranks: (number | null)[] = new Array(numSessions).fill(null);
    for (const session of searchData) {
      const idx = session.videoIds.indexOf(videoId);
      if (idx !== -1 && session.sessionIndex < numSessions) {
        ranks[session.sessionIndex] = idx + 1;
      }
    }
    const presentRanks = ranks.filter((r): r is number => r !== null);
    const avgRank =
      presentRanks.length > 0
        ? presentRanks.reduce((a, b) => a + b, 0) / presentRanks.length
        : 999;
    const dominanceScore =
      (presentRanks.reduce((sum, r) => sum + 1 / r, 0) / numSessions) * 100;
    rankInfo[videoId] = {
      ranks,
      avgRank,
      dominanceScore,
      appearanceCount: counts.get(videoId) ?? 0,
    };
  }
  return rankInfo;
}
