import React from "react";

interface Facet {
  facet: string;
  positiveRate: number;
  negativeRate: number;
}

interface FacetAnalysisProps {
  facets: Facet[];
}

export function FacetAnalysis({ facets }: FacetAnalysisProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-foreground">側面分析</h3>
      <div className="space-y-3">
        {facets.map((facet, idx) => (
          <div key={idx} className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-foreground">{facet.facet}</span>
              <div className="flex gap-2 text-xs">
                <span className="text-green-500">ポジ {facet.positiveRate}%</span>
                <span className="text-red-500">ネガ {facet.negativeRate}%</span>
              </div>
            </div>
            <div className="flex h-6 rounded-sm overflow-hidden bg-gray-200">
              {/* ポジティブバー（緑） */}
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${facet.positiveRate}%` }}
              />
              {/* ネガティブバー（赤） */}
              <div
                className="bg-red-500 transition-all"
                style={{ width: `${facet.negativeRate}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
