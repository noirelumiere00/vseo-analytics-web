/**
 * ownMatch.ts — ランキング中の「自社動画」を判定するマッチャ。
 *
 * `--own @handle1,@handle2,<videoURL>` のような入力（アカウント名 or 動画URL/ID）を
 * handles（小文字）と videoIds に分解し、ランキング動画が自社かどうかを返す。
 * 判定ロジックは server/campaignSnapshot.ts の isCampaignVideo を踏襲。
 */
import { extractTikTokUsername, extractTikTokVideoId } from "../../shared/tiktokUrl";
import type { TikTokVideo } from "../../server/tiktokScraper";

export interface OwnMatcher {
  /** その動画が自社のものか */
  isOwn: (v: TikTokVideo) => boolean;
  /** 指定された自社アカウント名（小文字） */
  handles: Set<string>;
  /** 指定された自社動画ID */
  videoIds: Set<string>;
  /** 何も指定されていない（ハイライト対象なし） */
  isEmpty: boolean;
}

/**
 * @param ownArgs カンマ分割済み or 個別の文字列配列（@handle / handle / 動画URL / 動画ID）
 */
export function buildOwnMatcher(ownArgs: string[]): OwnMatcher {
  const handles = new Set<string>();
  const videoIds = new Set<string>();

  for (const raw of ownArgs.flatMap((a) => a.split(","))) {
    const arg = raw.trim();
    if (!arg) continue;

    // 「/video/<id>」を含む動画URL、または 15-25桁の動画ID → 特定動画として扱う
    const vid = extractTikTokVideoId(arg);
    if (vid) {
      videoIds.add(vid);
      continue;
    }
    // それ以外（@handle / handle / プロフィールURL）→ アカウント単位で扱う
    const handle = extractTikTokUsername(arg);
    if (handle) handles.add(handle.toLowerCase());
  }

  const isOwn = (v: TikTokVideo): boolean => {
    if (v.id && videoIds.has(v.id)) return true;
    const u = v.author?.uniqueId?.toLowerCase();
    return !!u && handles.has(u);
  };

  return { isOwn, handles, videoIds, isEmpty: handles.size === 0 && videoIds.size === 0 };
}
