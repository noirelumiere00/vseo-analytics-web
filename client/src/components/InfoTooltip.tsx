import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

export function InfoTooltip({ term, explanation }: { term: string; explanation: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 cursor-help border-b border-dotted border-muted-foreground/40">
          {term}
          <HelpCircle className="h-3 w-3 text-muted-foreground/50" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p>{explanation}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export const GLOSSARY = {
  dominanceScore: "各動画が複数検索で上位に安定的に出現する度合い。高いほどTikTokのアルゴリズムに評価されている",
  erRate: "エンゲージメント率。(いいね+コメント+シェア+保存) ÷ 再生数 × 100",
  overlapRate: "複数セッションの検索結果で重複して出現した動画の割合。高いほどアルゴリズムに強く評価されている",
  winPattern: "全検索セッションで上位に出現した動画。アルゴリズムに強く評価されたコンテンツパターン",
  sentiment: "動画のコンテンツと視聴者反応をAIが分析したポジティブ/ネガティブ/中立の分類",
  tripleSearch: "3回の独立した検索を行い、結果の重複度からアルゴリズム評価の安定性を測定する手法",
};
