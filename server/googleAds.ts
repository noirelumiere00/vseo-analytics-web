import { ENV } from "./_core/env";

// ── Types ──────────────────────────────────────────────

export interface MonthlyVolume {
  year: number;
  month: number; // 1-12
  volume: number;
}

export interface KeywordVolumeData {
  keyword: string;
  avgMonthlySearches: number;
  competition: string; // "LOW" | "MEDIUM" | "HIGH" | "UNSPECIFIED"
  competitionIndex: number; // 0-100
  lowTopOfPageBidMicros: number;
  highTopOfPageBidMicros: number;
  monthlyVolumes: MonthlyVolume[];
}

export interface KeywordVolumeResult {
  keywords: KeywordVolumeData[];
  fetchedAt: string;
}

// ── Token Cache ────────────────────────────────────────

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (5 min buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedAccessToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      refresh_token: ENV.googleAdsRefreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedAccessToken;
}

// ── Keyword Volume API ─────────────────────────────────

/**
 * Google Ads Keyword Planner API v18 で検索ボリュームを取得
 * https://developers.google.com/google-ads/api/rest/reference/rest/v18/customers/generateKeywordHistoricalMetrics
 */
export async function fetchKeywordVolume(
  keywords: string[],
): Promise<KeywordVolumeData[]> {
  if (keywords.length === 0) return [];

  const accessToken = await getAccessToken();
  const customerId = ENV.googleAdsCustomerId.replace(/-/g, "");

  const url = `https://googleads.googleapis.com/v18/customers/${customerId}:generateKeywordHistoricalMetrics`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": ENV.googleAdsDeveloperToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      keywords,
      geoTargetConstants: ["geoTargetConstants/2392"], // Japan
      keywordPlanNetwork: "GOOGLE_SEARCH",
      language: "languageConstants/1005", // Japanese
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Ads API failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      text: string;
      closeVariants?: string[];
      keywordMetrics?: {
        avgMonthlySearches?: string;
        competition?: string;
        competitionIndex?: string;
        lowTopOfPageBidMicros?: string;
        highTopOfPageBidMicros?: string;
        monthlySearchVolumes?: Array<{
          year: string;
          month: string;
          monthlySearches: string;
        }>;
      };
    }>;
  };

  if (!data.results) return [];

  return data.results.map((r) => {
    const m = r.keywordMetrics;
    return {
      keyword: r.text,
      avgMonthlySearches: Number(m?.avgMonthlySearches ?? 0),
      competition: m?.competition ?? "UNSPECIFIED",
      competitionIndex: Number(m?.competitionIndex ?? 0),
      lowTopOfPageBidMicros: Number(m?.lowTopOfPageBidMicros ?? 0),
      highTopOfPageBidMicros: Number(m?.highTopOfPageBidMicros ?? 0),
      monthlyVolumes: (m?.monthlySearchVolumes ?? []).map((mv) => ({
        year: Number(mv.year),
        month: monthEnumToNumber(mv.month),
        volume: Number(mv.monthlySearches ?? 0),
      })),
    };
  });
}

// Google Ads API returns month as enum string (JANUARY, FEBRUARY, ...)
function monthEnumToNumber(monthEnum: string): number {
  const months: Record<string, number> = {
    JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4,
    MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8,
    SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  };
  return months[monthEnum] ?? 0;
}
