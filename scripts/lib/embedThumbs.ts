/**
 * embedThumbs.ts — サムネ画像URLを取得して base64 データURIに変換するヘルパー。
 *
 * IG/TikTok の CDN 画像URLは時間が経つと失効する（後でHTMLを開くとサムネが空に）。
 * 提案デックを配る前に、生成時点で画像を base64 化して inline しておけば、いつ・どこで開いても表示される。
 * `fetchThumbMap` は URL集合 → dataURI の Map を返す（並列・タイムアウト・失敗時はスキップ）。
 * スマホモック（device）と表は同じ cover URL を使うので、1回の取得で両方に適用できる。
 */

/** URL群を取得して `Map<url, "data:...base64,...">` を返す。失敗/タイムアウトのURLはMapに含めない（=元URLのまま使う）。 */
export async function fetchThumbMap(
  urls: Iterable<string>,
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, string>> {
  const concurrency = opts.concurrency ?? 8;
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const list = [...new Set([...urls].filter((u) => /^https?:\/\//.test(u)))];
  const map = new Map<string, string>();
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
        if (!res.ok) continue;
        const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        if (!ct.startsWith("image/")) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > 4_000_000) continue;
        map.set(u, `data:${ct};base64,${buf.toString("base64")}`);
      } catch {
        /* skip on failure */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  return map;
}

/** Map を使って URL を dataURI に置換（無ければ元のまま）。 */
export function applyThumbMap(url: string, map: Map<string, string>): string {
  return map.get(url) ?? url;
}
