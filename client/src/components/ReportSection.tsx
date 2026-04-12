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
    <div className="py-3 border-b border-border/40 last:border-b-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-semibold text-sm">{aspect.name}</span>
        <div className="flex items-center gap-3" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>
          <span className="text-xs font-bold text-foreground">{aspect.pos}%</span>
          <span className="text-[10px] text-muted-foreground/60">/</span>
          <span className="text-xs font-medium text-muted-foreground">{aspect.neg}%</span>
        </div>
      </div>
      <div className="h-1 rounded-full overflow-hidden bg-black/[0.04] flex">
        <div
          className="h-full bg-foreground/80 rounded-full"
          style={{ width: `${posWidth}%`, transition: 'width 600ms var(--md-ease-emphasized-decel)' }}
        />
      </div>
      {aspect.desc && (
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{aspect.desc}</p>
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
    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm ${cls}`} style={{ fontFamily: "'Space Mono', monospace" }}>
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
          <div className="flex gap-4 mb-4 text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: "'Space Mono', monospace" }}>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[3px] rounded-full bg-foreground/80" />Positive
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-[3px] rounded-full bg-foreground/15" />Negative
            </span>
          </div>

          {strengths.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/50 mb-1" style={{ fontFamily: "'Space Mono', monospace" }}>
                Strengths
              </div>
              {strengths.map((a) => (
                <AspectRow key={a.name} aspect={a} />
              ))}
            </div>
          )}

          {improvements.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/50 mb-1" style={{ fontFamily: "'Space Mono', monospace" }}>
                Needs Improvement
              </div>
              {improvements.map((a) => (
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
  // videoId → accountId マップ（テキスト中の[videoId]をアカウント名に置換用）
  const accountMap = new Map<string, string>((videos ?? []).map(v => [v.videoId, v.accountId]));
  // テキスト中の 動画[videoId] や [videoId] をアカウント名に置換
  const replaceVideoIds = (text: string): string => {
    return text.replace(/動画\[(\d+)\]|\[(\d+)\]/g, (_match, id1, id2) => {
      const vid = id1 || id2;
      const account = accountMap.get(vid);
      return account ? `@${account}` : _match;
    });
  };
  return (
    <div className="space-y-px">
      {proposals.map((p, i) => {
        const refs = (p.sourceVideoIds ?? [])
          .map(id => ({ id, num: refMap.get(id), video: (videos ?? []).find(v => v.videoId === id) }))
          .filter(r => r.num !== undefined);
        return (
          <div
            key={i}
            className="border-b border-border/40 last:border-b-0 py-3"
          >
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-bold text-muted-foreground/40 mt-0.5 shrink-0 w-5 text-center tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold">{p.area}</span>
                  <PriorityBadge priority={p.priority} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{p.action}</p>
              </div>
            </div>

            {p.analysis && (
              <div className="pl-8 mt-2">
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{replaceVideoIds(p.analysis)}</p>
              </div>
            )}

            {p.strategicAdvice && (
              <div className="ml-8 mt-2 pl-3 border-l-2 border-foreground/10">
                <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/40 mb-1" style={{ fontFamily: "'Space Mono', monospace" }}>Strategic Advice</div>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{replaceVideoIds(p.strategicAdvice)}</p>
              </div>
            )}

            {refs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-8 mt-2">
                {refs.map(r => (
                  <a
                    key={r.id}
                    href={`https://www.tiktok.com/@${r.video?.accountId}/video/${r.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={r.video?.title || r.id}
                    className="text-[10px] font-medium text-foreground/40 hover:text-foreground transition-colors"
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
        <p className="text-xs text-muted-foreground text-center py-4">
          分析データを取得できませんでした。LLMのトークン上限に達した可能性があります。後日再度お試しください。
        </p>
      )}
    </div>
  );
}

export function SeoMetaKeywordsSection({ videoMetaKeywords }: { videoMetaKeywords?: Array<{ videoUrl: string; videoId: string; accountId: string; keywords: string[] }> }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        再生数上位5動画のページから取得した、TikTokが自動生成するSEOメタキーワード（生データ）。
      </p>
      {videoMetaKeywords && videoMetaKeywords.length > 0 ? (
        <div className="space-y-3">
          {videoMetaKeywords.map((vm) => (
            <div key={vm.videoId || vm.videoUrl} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 mb-2">
                <a
                  href={vm.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  @{vm.accountId || "unknown"}
                </a>
                <span className="text-[10px] text-muted-foreground">{vm.videoId}</span>
              </div>
              {vm.keywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {vm.keywords.map((kw, i) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">
                      {kw}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">キーワードなし</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-4">
          メタキーワードデータがありません。新規分析を実行すると取得されます。
        </p>
      )}
    </div>
  );
}

export default ReportSection;
