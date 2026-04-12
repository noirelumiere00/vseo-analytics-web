import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  analysis?: string;
  strategicAdvice?: string;
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
  videoMetaKeywords?: Array<{
    videoUrl: string;
    videoId: string;
    accountId: string;
    keywords: string[];
  }>;
}

function AspectRow({ aspect }: { aspect: Aspect }) {
  const total = aspect.pos + aspect.neg;
  const posWidth = total > 0 ? (aspect.pos / total) * 100 : 50;
  return (
    <div className="py-1.5 border-b border-border/30 last:border-b-0">
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="font-semibold text-[13px]">{aspect.name}</span>
        <div className="flex items-center gap-2" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>
          <span className="text-[11px] font-bold text-foreground">{aspect.pos}%</span>
          <span className="text-[9px] text-muted-foreground/40">/</span>
          <span className="text-[11px] font-medium text-muted-foreground/60">{aspect.neg}%</span>
        </div>
      </div>
      <div className="h-[3px] rounded-full overflow-hidden bg-black/[0.04] flex">
        <div
          className="h-full bg-foreground/80 rounded-full"
          style={{ width: `${posWidth}%`, transition: 'width 600ms var(--md-ease-emphasized-decel)' }}
        />
      </div>
      {aspect.desc && (
        <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-snug line-clamp-1">{aspect.desc}</p>
      )}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: "回避" | "注意" | "活用" }) {
  const cls = {
    回避: "bg-foreground text-background",
    注意: "bg-transparent text-foreground border border-foreground/30",
    活用: "bg-foreground/[0.06] text-foreground/70 border border-transparent",
  }[priority];
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded-sm ${cls}`} style={{ fontFamily: "'Space Mono', monospace" }}>
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
  videoMetaKeywords,
}: ReportSectionProps) {
  const strengths = aspects.filter((a) => a.pos >= 75);
  const improvements = aspects.filter((a) => a.pos < 75);

  const cleanKeyword = keyword.replace(/^#+/, "");

  return (
    <div>
      <Tabs defaultValue="facets" className="w-full">
        <TabsList className="w-full h-8">
          <TabsTrigger value="facets" className="flex-1 text-xs py-1">側面分析</TabsTrigger>
          <TabsTrigger value="words" className="flex-1 text-xs py-1">頻出ワード分析</TabsTrigger>
        </TabsList>

        <TabsContent value="facets" className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-muted-foreground">
              {cleanKeyword} — {videoCount}本分析
            </p>
            <div className="flex gap-3 text-[9px] uppercase tracking-wider text-muted-foreground/60" style={{ fontFamily: "'Space Mono', monospace" }}>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-[2px] rounded-full bg-foreground/80" />Pos
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-[2px] rounded-full bg-foreground/15" />Neg
              </span>
            </div>
          </div>

          {strengths.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/40 mb-0.5" style={{ fontFamily: "'Space Mono', monospace" }}>
                Strengths
              </div>
              {strengths.map((a) => (
                <AspectRow key={a.name} aspect={a} />
              ))}
            </div>
          )}

          {improvements.length > 0 && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/40 mb-0.5" style={{ fontFamily: "'Space Mono', monospace" }}>
                Needs Improvement
              </div>
              {improvements.map((a) => (
                <AspectRow key={a.name} aspect={a} />
              ))}
            </div>
          )}

          {aspects.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              分析データがありません
            </p>
          )}
        </TabsContent>

        <TabsContent value="words" className="mt-2">
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

// 動画ミクロ分析（施策提案）
export function MicroAnalysisSection({ proposals, videos }: { proposals: Proposal[]; videos?: VideoRef[] }) {
  const refMap = new Map<string, number>((videos ?? []).map((v, i) => [v.videoId, i + 1]));
  const accountMap = new Map<string, string>((videos ?? []).map(v => [v.videoId, v.accountId]));
  const replaceVideoIds = (text: string): string => {
    return text.replace(/動画\[(\d+)\]|\[(\d+)\]/g, (_match, id1, id2) => {
      const vid = id1 || id2;
      const account = accountMap.get(vid);
      return account ? `@${account}` : _match;
    });
  };
  return (
    <div>
      {proposals.map((p, i) => {
        const refs = (p.sourceVideoIds ?? [])
          .map(id => ({ id, num: refMap.get(id), video: (videos ?? []).find(v => v.videoId === id) }))
          .filter(r => r.num !== undefined);
        return (
          <div
            key={i}
            className="border-b border-border/30 last:border-b-0 py-2"
          >
            <div className="flex items-start gap-2">
              <span className="text-[9px] font-bold text-muted-foreground/30 mt-0.5 shrink-0 w-4 text-right tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[13px] font-semibold leading-tight">{p.area}</span>
                  <PriorityBadge priority={p.priority} />
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{p.action}</p>
              </div>
            </div>

            {p.analysis && (
              <p className="text-[11px] text-muted-foreground/70 leading-snug pl-6 mt-1 line-clamp-2">{replaceVideoIds(p.analysis)}</p>
            )}

            {p.strategicAdvice && (
              <details className="pl-6 mt-1">
                <summary className="text-[9px] font-bold uppercase tracking-widest text-foreground/30 cursor-pointer hover:text-foreground/50 transition-colors select-none" style={{ fontFamily: "'Space Mono', monospace" }}>
                  Strategic Advice
                </summary>
                <p className="text-[11px] text-muted-foreground/70 leading-snug mt-0.5 pl-3 border-l border-foreground/10">{replaceVideoIds(p.strategicAdvice)}</p>
              </details>
            )}

            {refs.length > 0 && (
              <div className="flex flex-wrap gap-1 pl-6 mt-1">
                {refs.map(r => (
                  <a
                    key={r.id}
                    href={`https://www.tiktok.com/@${r.video?.accountId}/video/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={r.video?.title || r.id}
                    className="text-[9px] font-medium text-foreground/30 hover:text-foreground/60 transition-colors"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    [{r.num}]
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {proposals.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">
          分析データがありません
        </p>
      )}
    </div>
  );
}

export function SeoMetaKeywordsSection({ videoMetaKeywords }: { videoMetaKeywords?: Array<{ videoUrl: string; videoId: string; accountId: string; keywords: string[] }> }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-2">
        再生数上位動画のTikTok自動生成SEOメタキーワード
      </p>
      {videoMetaKeywords && videoMetaKeywords.length > 0 ? (
        <div className="space-y-1.5">
          {videoMetaKeywords.map((vm) => (
            <div key={vm.videoId || vm.videoUrl} className="rounded-md border border-border/40 p-2">
              <div className="flex items-center gap-2 mb-1.5">
                <a
                  href={vm.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-foreground/60 hover:text-foreground transition-colors"
                >
                  @{vm.accountId || "unknown"}
                </a>
                <span className="text-[9px] text-muted-foreground/40" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{vm.videoId}</span>
              </div>
              {vm.keywords.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {vm.keywords.map((kw, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-px rounded bg-foreground/[0.04] text-foreground/60 border border-border/30">
                      {kw}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/50">—</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-3">
          メタキーワードデータがありません
        </p>
      )}
    </div>
  );
}

export default ReportSection;
