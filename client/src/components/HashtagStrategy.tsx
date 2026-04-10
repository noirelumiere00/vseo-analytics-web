import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ExternalLink } from "lucide-react";

type HashtagStrategyData = {
  topCombinations: Array<{ tags: string[]; count: number; avgER: number }>;
  recommendations: string[];
};

function fmtViews(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

export default function HashtagStrategy({ data, videos }: { data: HashtagStrategyData | null | undefined; videos?: any[] }) {
  if (!data || !data.topCombinations?.length) {
    return <p className="text-sm text-muted-foreground">ハッシュタグデータが不足しています</p>;
  }

  const maxViews = Math.max(...(data.topCombinations || []).map(c => c.avgER), 1);

  // タグ組み合わせに該当する動画を検索
  const findMatchingVideos = (tags: string[]) => {
    if (!videos || videos.length === 0) return [];
    const lowerTags = tags.map(t => t.toLowerCase());
    return videos.filter((v: any) => {
      const vTags = ((v.hashtags || []) as string[]).map((h: string) => h.toLowerCase());
      return lowerTags.every(t => vTags.includes(t));
    }).slice(0, 10);
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold mb-2">高再生 ハッシュタグ組み合わせ TOP10</h4>
      <Accordion type="single" collapsible className="space-y-1.5">
        {data.topCombinations.map((combo, i) => {
          const matching = findMatchingVideos(combo.tags);
          return (
            <AccordionItem key={i} value={`combo-${i}`} className="border rounded-lg overflow-hidden">
              <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-muted/40">
                <div className="flex items-center gap-2 w-full pr-2">
                  <span className="w-5 text-xs text-muted-foreground text-right shrink-0">{i + 1}.</span>
                  <div className="flex gap-1 min-w-[140px] shrink-0">
                    {combo.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">#{tag}</Badge>
                    ))}
                  </div>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(combo.avgER / maxViews) * 100}%` }} />
                  </div>
                  <span className="text-xs font-medium w-20 text-right shrink-0">{fmtViews(combo.avgER)}</span>
                  <span className="text-[10px] text-muted-foreground w-10 shrink-0">({combo.count}本)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3">
                {matching.length > 0 ? (
                  <div className="space-y-1.5 pt-1">
                    {matching.map((v: any, vi: number) => (
                      <a key={vi} href={v.videoUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate flex-1">@{v.accountId || v.accountName} — {(v.title || v.description || "").slice(0, 60)}</span>
                        <span className="shrink-0 font-mono text-[10px]">{fmtViews(v.viewCount || 0)}再生</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pt-1">該当動画なし</p>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
