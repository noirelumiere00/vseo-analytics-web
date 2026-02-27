import { FrequentWordsCloud } from "./FrequentWordsCloud";

interface Aspect {
  name: string;
  pos: number;
  neg: number;
  desc: string;
}

interface Proposal {
  area: string;
  action: string;
  priority: "高" | "中" | "低";
  icon: string;
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

function PriorityBadge({ priority }: { priority: "高" | "中" | "低" }) {
  const cls = {
    高: "bg-red-50 text-red-600 border-red-200",
    中: "bg-blue-50 text-blue-600 border-blue-200",
    低: "bg-gray-50 text-gray-500 border-gray-200",
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
}: ReportSectionProps) {
  const strengths = aspects.filter((a) => a.pos >= 75);
  const improvements = aspects.filter((a) => a.pos < 75);

  return (
    <div className="space-y-4 pt-2">

      {/* 側面分析・強み弱み分析 */}
      <div className="p-4 border rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">
            側面分析・強み弱み分析
          </h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {platform}上の #{keyword} 関連動画{videoCount}本を分析。各側面のポジティブ/ネガティブ比率。
        </p>
        <div className="flex gap-4 mb-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500" />ポジティブ
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400" />ネガティブ
          </span>
        </div>

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

        {aspects.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            分析データを取得できませんでした。LLMのトークン上限に達した可能性があります。後日再度お試しください。
          </p>
        )}
      </div>

      {/* 頻出ワード分析 */}
      <div className="p-4 border rounded-lg">
        <div className="mb-3">
          <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">
            頻出ワード分析
          </h4>
        </div>
        <FrequentWordsCloud
          positiveWords={positiveWords}
          negativeWords={negativeWords}
        />
      </div>

      {/* マーケティング施策提案 */}
      <div className="p-4 border rounded-lg">
        <div className="mb-3">
          <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide">
            マーケティング施策提案
          </h4>
        </div>
        <div className="space-y-2">
          {proposals.map((p, i) => (
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
              </div>
            </div>
          ))}
          {proposals.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              分析データを取得できませんでした。LLMのトークン上限に達した可能性があります。後日再度お試しください。
            </p>
          )}
        </div>
      </div>

    </div>
  );
}

export default ReportSection;
