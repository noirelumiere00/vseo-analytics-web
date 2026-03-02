import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FrequentWordsCloud, type EmotionWord } from "./FrequentWordsCloud";

interface Aspect {
  name: string;
  pos: number;
  neg: number;
  desc: string;
}

interface Proposal {
  area: string;
  action: string;
  priority: "回避" | "注意" | "活用";
  icon: string;
  sourceVideoIds?: string[];
}

interface WordData {
  word: string;
  count: number;
}

interface ReportSectionProps {
  keyword: string;
  date: string;
  videoCount: number;
  platform: string;
  aspects: Aspect[];
  proposals: Proposal[];
  sentimentData?: {
    positive: number;
    negative: number;
    neutral: number;
  };
  positiveWords?: WordData[];
  negativeWords?: WordData[];
  emotionWords?: EmotionWord[];
}

function AspectRow({ aspect }: { aspect: Aspect }) {
  const total = aspect.pos + aspect.neg;
  const posWidth = total > 0 ? (aspect.pos / total) * 100 : 50;
  const negWidth = total > 0 ? (aspect.neg / total) * 100 : 50;
  return (
    <div className="py-3 border-b last:border-b-0">
      <span className="font-semibold text-sm">{aspect.name}</span>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-green-600 font-bold text-xs w-10 text-right shrink-0">{aspect.pos}%</span>
        <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-muted flex">
          <div
            className="h-full bg-green-500 transition-all duration-700"
            style={{ width: `${posWidth}%` }}
          />
          <div
            className="h-full bg-red-400 transition-all duration-700"
            style={{ width: `${negWidth}%` }}
          />
        </div>
        <span className="text-red-500 font-bold text-xs w-10 shrink-0">{aspect.neg}%</span>
      </div>
      {aspect.desc && (
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{aspect.desc}</p>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: "回避" | "注意" | "活用" }) {
  const cls = {
    回避: "bg-red-50 text-red-600 border-red-200",
    注意: "bg-orange-50 text-orange-600 border-orange-200",
    活用: "bg-green-50 text-green-600 border-green-200",
  }[priority];
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${cls}`}>
      {priority}
    </span>
  );
}

export function ReportSection({
  keyword,
  date,
  videoCount,
  platform,
  aspects,
  proposals,
  positiveWords = [],
  negativeWords = [],
  emotionWords,
}: ReportSectionProps) {
  const [aspectSort, setAspectSort] = useState<"default" | "pos" | "neg">("default");

  const sortedAspects = useMemo(() => {
    if (aspectSort === "pos") return [...aspects].sort((a, b) => b.pos - a.pos);
    if (aspectSort === "neg") return [...aspects].sort((a, b) => b.neg - a.neg);
    return aspects;
  }, [aspects, aspectSort]);

  const strengths = sortedAspects.filter((a) => a.pos >= 75);
  const improvements = sortedAspects.filter((a) => a.pos < 75);

  const cleanKeyword = keyword.replace(/^#+/, "");

  return (
    <div className="pt-2">
      <Tabs defaultValue="facets" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="facets" className="flex-1 text-xs">側面分析</TabsTrigger>
          <TabsTrigger value="words" className="flex-1 text-xs">頻出ワード分析</TabsTrigger>
        </TabsList>

        <TabsContent value="facets" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3">
            {platform}上の {cleanKeyword} 関連動画{videoCount}本を分析。各側面のポジティブ/ネガティブ比率。
          </p>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />ポジティブ
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400" />ネガティブ
              </span>
            </div>
            <div className="flex gap-1">
              {([
                { key: "default", label: "強み/要改善" },
                { key: "pos", label: "ポジ順" },
                { key: "neg", label: "ネガ順" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setAspectSort(key)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    aspectSort === key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {aspectSort === "default" ? (
            <>
              {strengths.length > 0 && (
                <div className="mb-3">
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-0.5 rounded mb-2">
                    ● 強み
                  </span>
                  {strengths.map((a) => (
                    <AspectRow key={a.name} aspect={a} />
                  ))}
                </div>
              )}

              {improvements.length > 0 && (
                <div>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded mb-2">
                    ● 要改善
                  </span>
                  {improvements.map((a) => (
                    <AspectRow key={a.name} aspect={a} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div>
              {sortedAspects.map((a) => (
                <AspectRow key={a.name} aspect={a} />
              ))}
            </div>
          )}

          {aspects.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              分析データを取得できませんでした。LLMのトークン上限に達した可能性があります。後日再度お試しください。
            </p>
          )}
        </TabsContent>

        <TabsContent value="words" className="mt-4">
          <FrequentWordsCloud
            emotionWords={emotionWords}
            positiveWords={positiveWords}
            negativeWords={negativeWords}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface VideoRef {
  videoId: string;
  accountId: string;
  title?: string | null;
}

// 動画ミクロ分析（施策提案）を独立コンポーネントとしてエクスポート
export function MicroAnalysisSection({ proposals, videos }: { proposals: Proposal[]; videos?: VideoRef[] }) {
  // videoId → 参照番号マップ
  const refMap = new Map<string, number>((videos ?? []).map((v, i) => [v.videoId, i + 1]));
  return (
    <div className="space-y-2">
      {proposals.map((p, i) => {
        const refs = (p.sourceVideoIds ?? [])
          .map(id => ({ id, num: refMap.get(id), video: (videos ?? []).find(v => v.videoId === id) }))
          .filter(r => r.num !== undefined);
        return (
          <div
            key={i}
            className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border"
          >
            <span className="text-xl leading-none mt-0.5 shrink-0">{p.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold">{p.area}</span>
                <PriorityBadge priority={p.priority} />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{p.action}</p>
              {refs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {refs.map(r => (
                    <a
                      key={r.id}
                      href={`https://www.tiktok.com/@${r.video?.accountId}/video/${r.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={r.video?.title || r.id}
                      className="text-[10px] font-medium text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      [参照{r.num}]
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {proposals.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          分析データを取得できませんでした。LLMのトークン上限に達した可能性があります。後日再度お試しください。
        </p>
      )}
    </div>
  );
}

export default ReportSection;
