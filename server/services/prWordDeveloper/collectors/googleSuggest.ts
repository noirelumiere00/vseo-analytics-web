/**
 * Google Suggest collector
 *
 * Fetches autocomplete suggestions from Google Suggest API.
 * No Puppeteer needed — plain HTTP fetch.
 */

const SUGGEST_BASE = "https://suggestqueries.google.com/complete/search";

async function fetchSuggestions(query: string): Promise<string[]> {
  const url = `${SUGGEST_BASE}?client=firefox&hl=ja&q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[GoogleSuggest] HTTP ${res.status} for "${query}"`);
      return [];
    }

    // Response format: ["query", ["suggestion1", "suggestion2", ...]]
    const data = await res.json();
    return Array.isArray(data?.[1]) ? data[1] : [];
  } catch (e) {
    console.warn(`[GoogleSuggest] Fetch failed for "${query}":`, e);
    return [];
  }
}

export interface GoogleSuggestOptions {
  category?: string;   // 商品カテゴリ (JSON-LD or パンくず由来)
  brand?: string;      // ブランド/メーカー名
  siteName?: string;   // og:site_name
}

/**
 * Collect Google Suggest keywords for a product name.
 * Runs multiple query variations and deduplicates results.
 */
export async function collectGoogleSuggest(
  productName: string,
  options?: GoogleSuggestOptions,
): Promise<string[]> {
  const variations = [
    productName,
    `${productName} とは`,
    `${productName} 使い方`,
    `${productName} おすすめ`,
    // 追加: 比較・口コミ・効果系
    `${productName} 口コミ`,
    `${productName} 比較`,
    `${productName} アレンジ`,
  ];

  // 商品ページから得た情報で追加クエリ生成
  if (options?.category) {
    variations.push(`${options.category} おすすめ`);
    variations.push(`${productName} ${options.category}`);
  }
  if (options?.brand && options.brand !== productName) {
    variations.push(`${options.brand} ${productName}`);
  }
  if (options?.siteName && options.siteName !== productName && options.siteName !== options?.brand) {
    variations.push(`${options.siteName} ${productName}`);
  }

  const results: string[] = [];
  for (const query of variations) {
    const suggestions = await fetchSuggestions(query);
    results.push(...suggestions);
    // Polite delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  // Deduplicate
  return [...new Set(results)];
}
