/**
 * embedThumbs.ts — 提案デックのサムネ（thumbUrl）を base64 データURIに置換して自己完結化する。
 *
 * IG/TikTok の CDN 画像URLは時間が経つと失効する（後でHTMLを開くとサムネが空になる）。
 * クライアント提案HTMLとして配る前に、生成時点で画像を取得して inline base64 にしておけば、
 * いつ・どこで開いても表示される（リンク切れしない）。phone タイルと表は同じ thumbUrl を使うので、
 * ユニークURLを1回ずつ取得すれば両方に反映される。失敗/タイムアウトは元URLのまま（=フォールバック）。
 */
import type { ProposalSlide } from "./proposalHtml";

export async function embedThumbsInSlides(
  slides: ProposalSlide[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<{ total: number; embedded: number; failed: number }> {
  const concurrency = opts.concurrency ?? 8;
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const urls = new Set<string>();
  for (const s of slides) {
    for (const it of s.items) {
      if (it.thumbUrl && /^https?:\/\//.test(it.thumbUrl)) urls.add(it.thumbUrl);
    }
  }
  const list = [...urls];
  const map = new Map<string, string>();
  let embedded = 0;
  let failed = 0;
  let idx = 0;

  async function worker() {
    while (idx < list.length) {
      const u = list[idx++];
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(u, {
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0", Accept: "image/avif,image/webp,image/*,*/*" },
        }).finally(() => clearTimeout(timer));
        if (!res.ok) { failed++; continue; }
        const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        if (!ct.startsWith("image/")) { failed++; continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > 4_000_000) { failed++; continue; }
        map.set(u, `data:${ct};base64,${buf.toString("base64")}`);
        embedded++;
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));

  for (const s of slides) {
    for (const it of s.items) {
      const d = map.get(it.thumbUrl);
      if (d) it.thumbUrl = d;
    }
  }

  return { total: list.length, embedded, failed };
}
