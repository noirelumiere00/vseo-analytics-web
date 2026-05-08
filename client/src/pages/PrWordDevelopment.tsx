import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageTitle } from "@/hooks/usePageTitle";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";
import {
  Wand2, Loader2, CheckCircle2, AlertTriangle, Globe, Clock,
  ChevronRight, Hash, Zap, MessageSquareQuote,
  ArrowRight, Copy, Check, Sparkles, Target, LayoutGrid,
  Search, Building2, ShoppingBag,
} from "lucide-react";

// ================================================================
// Purpose Config
// ================================================================
const PURPOSE_OPTIONS = [
  { value: "awareness", label: "認知拡大", desc: "まだ知らない層に届ける" },
  { value: "consideration", label: "比較検討", desc: "競合と迷っている層を取り込む" },
  { value: "conversion", label: "購入促進", desc: "検討中の層を後押し" },
  { value: "loyalty", label: "リピート・ファン化", desc: "既存顧客の再購入・推奨" },
  { value: "branding", label: "ブランド構築", desc: "世界観・信頼の醸成" },
] as const;

const PURPOSE_LABELS: Record<string, string> = Object.fromEntries(
  PURPOSE_OPTIONS.map(o => [o.value, o.label])
);

// ================================================================
// History List
// ================================================================
function PrWordHistoryList({ onSelect }: { onSelect: (id: number) => void }) {
  const { data, isLoading } = trpc.prWordDeveloper.list.useQuery({ limit: 20 });

  if (isLoading) return <div className="text-sm text-muted-foreground py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />読み込み中...</div>;
  if (!data?.items.length) return null;

  const statusConfig: Record<string, { label: string; cls: string }> = {
    completed: { label: "完了", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
    analyzing: { label: "分析中", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400" },
    collecting: { label: "収集中", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
    pending: { label: "待機中", cls: "bg-slate-100 text-slate-600" },
    failed: { label: "失敗", cls: "bg-red-100 text-red-700" },
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5"><Clock className="h-4 w-4" />分析履歴</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.items.map(item => {
          const sc = statusConfig[item.status] || statusConfig.pending;
          return (
            <button key={item.id} onClick={() => onSelect(item.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left group">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.productName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {PURPOSE_LABELS[item.purpose] || item.purpose} · {new Date(item.createdAt).toLocaleDateString("ja-JP")}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${sc.cls}`}>{sc.label}</Badge>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ================================================================
// Status Polling
// ================================================================
function PrWordStatusView({ analysisId, onComplete }: { analysisId: number; onComplete: () => void }) {
  const { data } = trpc.prWordDeveloper.getStatus.useQuery(
    { analysisId },
    { refetchInterval: (query) => {
      const s = query.state.data?.status;
      return (s === "pending" || s === "collecting" || s === "analyzing") ? 2500 : false;
    }}
  );

  useEffect(() => {
    if (data?.status === "completed") onComplete();
  }, [data?.status, onComplete]);

  const phases = [
    { key: "pending", label: "待機中", icon: Clock },
    { key: "collecting", label: "データ収集中", icon: Globe },
    { key: "analyzing", label: "AI分析中", icon: Sparkles },
    { key: "completed", label: "完了", icon: CheckCircle2 },
  ];
  const currentIdx = phases.findIndex(p => p.key === data?.status);

  if (data?.status === "failed") {
    return (
      <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20">
        <CardContent className="py-8 text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-red-400 mx-auto" />
          <p className="text-sm font-medium text-red-700 dark:text-red-400">分析に失敗しました</p>
          {data.errorMessage && <p className="text-xs text-red-500">{data.errorMessage}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
          <p className="text-sm font-medium">検索ワードを設計中です...</p>
        </div>
        <div className="flex items-center justify-between max-w-md mx-auto">
          {phases.map((phase, i) => {
            const Icon = phase.icon;
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <div key={phase.key} className="flex flex-col items-center gap-1.5 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-violet-500 text-white animate-pulse" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <span className={`text-[11px] font-medium ${active ? "text-violet-600" : done ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {phase.label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ================================================================
// Copy Button Helper
// ================================================================
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ================================================================
// Format helpers
// ================================================================
function formatPostCount(count: number | null): string | null {
  if (count == null) return null;
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}億件`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万件`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}件`;
}

// ================================================================
// V2 Search Word Card
// ================================================================
type SearchWordItem = { word: string; reason: string; tiktokPostCount: number | null };

function SearchWordCard({ item, index }: { item: SearchWordItem; index: number }) {
  const postCount = formatPostCount(item.tiktokPostCount);
  return (
    <div className="group relative border rounded-xl p-4 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-950 dark:to-slate-900/50">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold tracking-tight">{item.word}</span>
            {postCount && (
              <Badge variant="secondary" className="text-[10px] bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800 px-1.5 py-0 font-mono">
                <Hash className="h-2.5 w-2.5 mr-0.5" />{postCount}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{item.reason}</p>
        </div>
        <CopyButton text={item.word} />
      </div>
    </div>
  );
}

// ================================================================
// V2 Result View
// ================================================================
function PrWordResultViewV2({ data }: { data: any }) {
  const profile = data.productProfile as any;
  const wordMapData = data.wordMap as any;
  const hashtagData = data.hashtagStructure as any;

  const brandedWords: SearchWordItem[] = wordMapData?.brandedSearchWords || [];
  const genericWords: SearchWordItem[] = hashtagData?.genericSearchWords || [];

  return (
    <div className="space-y-5">
      {/* Product Profile */}
      {profile && (
        <Card className="border-l-4 border-l-violet-500 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-violet-500" />
              商品プロフィール
            </CardTitle>
            <CardDescription>{data.productName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">カテゴリ</p>
                <p className="text-sm font-medium">{profile.category}</p>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">ターゲット</p>
                <p className="text-sm font-medium">{profile.targetAudience}</p>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">トーン</p>
                <p className="text-sm font-medium">{profile.toneOfVoice}</p>
              </div>
            </div>
            <div className="bg-muted/40 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">ポジショニング</p>
              <p className="text-sm leading-relaxed">{profile.positioning}</p>
            </div>
            {profile.uniqueSellingPoints?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">USP</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.uniqueSellingPoints.map((usp: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal py-0.5">{usp}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 指名検索ワード */}
      {brandedWords.length > 0 && (
        <Card className="border-l-4 border-l-blue-500 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-500" />
              指名検索ワード
            </CardTitle>
            <CardDescription>商品名・メーカー名・ブランド名など固有名詞の検索語</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {brandedWords.map((item, i) => (
                <SearchWordCard key={i} item={item} index={i} />
              ))}
            </div>
            <div className="pt-3 mt-3 border-t">
              <Button variant="outline" size="sm" className="text-xs gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(brandedWords.map(w => w.word).join("\n"));
                  toast.success("指名検索ワードをコピーしました");
                }}>
                <Copy className="h-3.5 w-3.5" />全ワード���コピー
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 一般検索ワード */}
      {genericWords.length > 0 && (
        <Card className="border-l-4 border-l-emerald-500 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-emerald-500" />
              一般検索ワード
            </CardTitle>
            <CardDescription>カテゴリ・用途・シーン・課題の一般名詞検索語</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {genericWords.map((item, i) => (
                <SearchWordCard key={i} item={item} index={i} />
              ))}
            </div>
            <div className="pt-3 mt-3 border-t">
              <Button variant="outline" size="sm" className="text-xs gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(genericWords.map(w => w.word).join("\n"));
                  toast.success("一般検索ワードをコピーしました");
                }}>
                <Copy className="h-3.5 w-3.5" />全ワードをコピー
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ================================================================
// V1 Result Display (legacy)
// ================================================================
function PrWordResultViewV1({ data }: { data: any }) {
  const profile = data.productProfile as any;
  const wordMap = data.wordMap as any;
  const rawHashtags = data.hashtagStructure as any;
  const phrases = (data.hookPhrases || []) as any[];

  // PR開示・広告系タグを除外（LLMが混入させるケースがある）
  const AD_NOISE_TAGS = new Set([
    "pr", "ad", "提供", "osina", "おしな", "案件",
    "gifted", "sponsored", "タイアップ", "promotion",
  ]);
  const isAdTag = (tag: string) => AD_NOISE_TAGS.has(tag.replace(/^#/, "").toLowerCase());

  const normalizeHashtags = (items: any): Array<{ tag: string; postCount: number | null }> => {
    if (!Array.isArray(items) || !items.length) return [];
    return items.map((item: any) => {
      if (typeof item === "string") return { tag: item, postCount: null };
      if (item && typeof item === "object") return { tag: String(item.tag ?? ""), postCount: typeof item.postCount === "number" ? item.postCount : null };
      return { tag: String(item ?? ""), postCount: null };
    }).filter(h => h.tag.length > 0 && !isAdTag(h.tag));
  };
  const hashtags = rawHashtags ? {
    big: normalizeHashtags(rawHashtags.big),
    mid: normalizeHashtags(rawHashtags.mid),
    niche: normalizeHashtags(rawHashtags.niche),
  } : null;

  const ensureHash = (t: string): string => t.startsWith("#") ? t : `#${t}`;

  const PHRASE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
    question: { label: "疑問型", color: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300" },
    number: { label: "数字型", color: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300" },
    contrast: { label: "対比型", color: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300" },
    confession: { label: "告白型", color: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300" },
    command: { label: "命令型", color: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300" },
  };

  const QUADRANT_CONFIG = [
    { key: "properNouns", label: "固有名詞", desc: "ブランド名・成分名・技術名", color: "from-blue-500/10 to-blue-600/5 border-blue-200 dark:border-blue-800" },
    { key: "categoryTerms", label: "カテゴリ用語", desc: "一般名詞・業界用語", color: "from-emerald-500/10 to-emerald-600/5 border-emerald-200 dark:border-emerald-800" },
    { key: "trendTerms", label: "時事・新規性", desc: "トレンド・話題性ワード", color: "from-amber-500/10 to-amber-600/5 border-amber-200 dark:border-amber-800" },
    { key: "actionTerms", label: "行動・活用", desc: "使い方・HOW TOワード", color: "from-rose-500/10 to-rose-600/5 border-rose-200 dark:border-rose-800" },
  ];

  return (
    <div className="space-y-5">
      {/* Product Profile */}
      {profile && (
        <Card className="border-l-4 border-l-violet-500 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-violet-500" />
              商品プロフィール
            </CardTitle>
            <CardDescription>{data.productName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">カテゴリ</p>
                <p className="text-sm font-medium">{profile.category}</p>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">ターゲット</p>
                <p className="text-sm font-medium">{profile.targetAudience}</p>
              </div>
              <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-xl p-3 space-y-1">
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider">トーン</p>
                <p className="text-sm font-medium">{profile.toneOfVoice}</p>
              </div>
            </div>
            <div className="bg-muted/40 rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">ポジショニング</p>
              <p className="text-sm leading-relaxed">{profile.positioning}</p>
            </div>
            {profile.uniqueSellingPoints?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">USP</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.uniqueSellingPoints.map((usp: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal py-0.5">{usp}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 4象限ワードマップ */}
      {wordMap && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-blue-500" />
              4象限ワードマップ
            </CardTitle>
            <CardDescription>PR素材として活用できるワード群を4軸で整理</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QUADRANT_CONFIG.map(q => {
                const words: string[] = wordMap[q.key] || [];
                return (
                  <div key={q.key} className={`bg-gradient-to-br ${q.color} border rounded-xl p-4 space-y-2`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold">{q.label}</p>
                        <p className="text-[10px] text-muted-foreground">{q.desc}</p>
                      </div>
                      <CopyButton text={words.join(", ")} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {words.map((w, i) => (
                        <span key={i} className="text-xs bg-white/70 dark:bg-white/10 border rounded-full px-2.5 py-1 font-medium">
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ハッシュタグ三層 */}
      {hashtags && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Hash className="h-4 w-4 text-pink-500" />
              ハッシュタグ三層構造
            </CardTitle>
            <CardDescription>投稿時のハッシュタグセットをコピーして使えます</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { items: hashtags.big, label: "BIG", desc: "10万件以上級（2個）", cls: "bg-pink-500", tagCls: "text-sm font-semibold text-pink-600 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800" },
              { items: hashtags.mid, label: "MID", desc: "1-10万件級（5個）", cls: "bg-orange-400", tagCls: "text-sm font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800" },
              { items: hashtags.niche, label: "NICHE", desc: "1万件未満（3個）", cls: "bg-slate-400", tagCls: "text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800" },
            ].map(tier => (
              <div key={tier.label} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge className={`${tier.cls} text-white text-[10px]`}>{tier.label}</Badge>
                  <span className="text-[10px] text-muted-foreground">{tier.desc}</span>
                  <CopyButton text={tier.items.map(h => ensureHash(h.tag)).join(" ")} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tier.items.map((h, i) => (
                    <span key={i} className={`inline-flex items-center gap-1 border rounded-full px-2.5 py-0.5 ${tier.tagCls}`}>
                      {ensureHash(h.tag)}
                      {formatPostCount(h.postCount) && (
                        <span className="text-[10px] font-normal opacity-60">{formatPostCount(h.postCount)}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <div className="pt-2 border-t">
              <Button variant="outline" size="sm" className="text-xs gap-1.5"
                onClick={() => {
                  const all = [...hashtags.big, ...hashtags.mid, ...hashtags.niche]
                    .map(h => ensureHash(h.tag)).join(" ");
                  navigator.clipboard.writeText(all);
                  toast.success("全ハッシュタグをコピーしました");
                }}>
                <Copy className="h-3.5 w-3.5" />全ハッシュタグをコピー
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ショート動画フレーズ案 */}
      {phrases.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquareQuote className="h-4 w-4 text-amber-500" />
              ショート動画フレーズ案
            </CardTitle>
            <CardDescription>冒頭1秒でスクロール停止させるフック5型</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3">
              {phrases.map((p, i) => {
                const typeCfg = PHRASE_TYPE_LABELS[p.type] || { label: p.type, color: "bg-slate-100 text-slate-600" };
                return (
                  <div key={i} className="group relative border rounded-xl p-4 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2 flex-1">
                        <Badge className={`text-[10px] border ${typeCfg.color}`}>{typeCfg.label}</Badge>
                        <p className="text-base font-bold leading-snug">「{p.phrase}」</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{p.explanation}</p>
                      </div>
                      <CopyButton text={p.phrase} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

// ================================================================
// Result Display (version router)
// ================================================================
function PrWordResultView({ analysisId }: { analysisId: number }) {
  const { data, isLoading } = trpc.prWordDeveloper.getResult.useQuery({ analysisId });

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-8">結果がありません</p>;

  // V2 detection: wordMap has version: 2
  const isV2 = (data.wordMap as any)?.version === 2;

  if (isV2) {
    return <PrWordResultViewV2 data={data} />;
  }

  return <PrWordResultViewV1 data={data} />;
}

// ================================================================
// Main Page
// ================================================================
export default function PrWordDevelopment() {
  usePageTitle("検索ワード開発");

  const [, setLocation] = useLocation();
  const [, params] = useRoute("/pr-word/:id");
  const analysisId = params?.id ? parseInt(params.id, 10) : null;

  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [purpose, setPurpose] = useState<string>("awareness");
  const [showResult, setShowResult] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(analysisId);

  const utils = trpc.useUtils();
  const createMutation = trpc.prWordDeveloper.analyze.useMutation({
    onSuccess: (data) => {
      toast.success("検索ワード開発を開始しました");
      setActiveId(data.analysisId);
      setShowResult(false);
      setProductName("");
      setProductUrl("");
      utils.prWordDeveloper.list.invalidate();
      setLocation(`/pr-word/${data.analysisId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Check status if URL has id
  const { data: statusData } = trpc.prWordDeveloper.getStatus.useQuery(
    { analysisId: analysisId! },
    { enabled: !!analysisId },
  );

  useEffect(() => {
    if (analysisId) {
      setActiveId(analysisId);
      if (statusData?.status === "completed") setShowResult(true);
      else setShowResult(false);
    }
  }, [analysisId, statusData?.status]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) return;
    createMutation.mutate({
      productName: productName.trim(),
      productUrl: productUrl.trim() || undefined,
      purpose: purpose as any,
    });
  };

  const handleSelectHistory = (id: number) => {
    setActiveId(id);
    setShowResult(false);
    setLocation(`/pr-word/${id}`);
  };

  const handleComplete = useCallback(() => {
    setShowResult(true);
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Search className="h-5 w-5 text-violet-500" />
            検索ワード開発
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            商品名を入力すると、検索データ・サジェスト・Web評判から「指名検索ワード」と「一般検索ワード」を自動設計します。
          </p>
        </div>

        {/* Input Form */}
        {!activeId && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" />新しい検索ワード開発</CardTitle>
              <CardDescription>商品名と施策目的を入力してください</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <Input
                  value={productName}
                  onChange={e => setProductName(e.target.value)}
                  placeholder="商品名 / サービス名（例: フルーティス、楽天カード）"
                  className="text-sm"
                  autoFocus
                  disabled={createMutation.isPending}
                />
                <Input
                  value={productUrl}
                  onChange={e => setProductUrl(e.target.value)}
                  placeholder="商品ページURL（任意）"
                  className="text-sm"
                  type="url"
                  disabled={createMutation.isPending}
                />
                <Select value={purpose} onValueChange={setPurpose}>
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="施策目的を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {PURPOSE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-muted-foreground ml-1.5">— {opt.desc}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={!productName.trim() || createMutation.isPending} className="w-full">
                  {createMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />開始中...</>
                  ) : (
                    <><Search className="mr-2 h-4 w-4" />検索ワード開発を開始</>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Back to input button when viewing result */}
        {activeId && (
          <Button variant="ghost" size="sm" className="text-xs gap-1"
            onClick={() => { setActiveId(null); setShowResult(false); setLocation("/pr-word"); }}>
            <ArrowRight className="h-3 w-3 rotate-180" />新しい分析
          </Button>
        )}

        {/* Active Analysis: Status or Result */}
        {activeId && !showResult && (
          <PrWordStatusView analysisId={activeId} onComplete={handleComplete} />
        )}
        {activeId && showResult && (
          <PrWordResultView analysisId={activeId} />
        )}

        {/* History */}
        <PrWordHistoryList onSelect={handleSelectHistory} />
      </div>
    </DashboardLayout>
  );
}
