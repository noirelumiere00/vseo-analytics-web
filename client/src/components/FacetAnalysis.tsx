import React from "react";

interface Facet {
  aspect: string;
  positive_percentage: number;
  negative_percentage: number;
}

interface FacetAnalysisProps {
  facets: Facet[];
}

function BarSegment({ width, className, label, muted }: { width: number; className: string; label: string; muted?: boolean }) {
  if (width <= 0) return null;
  return (
    <div
      className={`${className} flex items-center justify-center transition-all duration-300 overflow-hidden`}
      style={{ width: `${width}%` }}
    >
      {width > 15 && (
        <span className={`text-[11px] font-semibold ${muted ? "text-muted-foreground" : "text-white drop-shadow-sm"}`}>
          {label}
        </span>
      )}
    </div>
  );
}

export function FacetAnalysis({ facets }: FacetAnalysisProps) {
  const sorted = [...facets].sort(
    (a, b) => (b.positive_percentage - b.negative_percentage) - (a.positive_percentage - a.negative_percentage)
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-foreground">側面分析</h3>
      <div className="space-y-3">
        {sorted.map((facet, idx) => {
          const neutral = Math.max(0, 100 - facet.positive_percentage - facet.negative_percentage);
          return (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-foreground">{facet.aspect}</span>
                <div className="flex gap-3 text-xs">
                  <span className="text-emerald-600">ポジ {facet.positive_percentage}%</span>
                  <span className="text-muted-foreground">中立 {neutral}%</span>
                  <span className="text-red-600">ネガ {facet.negative_percentage}%</span>
                </div>
              </div>
              <div className="flex h-8 rounded-sm overflow-hidden bg-muted">
                <BarSegment width={facet.positive_percentage} className="bg-emerald-600" label={`${facet.positive_percentage}%`} />
                <BarSegment width={neutral} className="bg-muted" label={`${neutral}%`} muted />
                <BarSegment width={facet.negative_percentage} className="bg-amber-600" label={`${facet.negative_percentage}%`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
