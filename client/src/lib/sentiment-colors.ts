/**
 * Colorblind-safe sentiment color system.
 * Replaces red/green with blue/amber/gray for accessibility.
 */

export const SENTIMENT_COLORS = {
  positive: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-300",
    fill: "fill-blue-500",
  },
  negative: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-300",
    fill: "fill-amber-500",
  },
  neutral: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-300",
    fill: "fill-gray-400",
  },
} as const;

export type Sentiment = keyof typeof SENTIMENT_COLORS;

export function getSentimentColorClass(sentiment: Sentiment) {
  return SENTIMENT_COLORS[sentiment];
}

/**
 * Hex values for Recharts fills using an editorial vermillion palette.
 * Teal for positive, vermillion for negative, slate for neutral.
 * Generated from oklch values:
 *   positive  oklch(0.55 0.10 160) ≈ #2d8f7b
 *   negative  oklch(0.55 0.18 25)  ≈ #c44b2f
 *   neutral   slate                ≈ #94a3b8
 */
export const CHART_SENTIMENT_COLORS = {
  positive: "#2d8f7b",
  negative: "#c44b2f",
  neutral: "#94a3b8",
} as const;
