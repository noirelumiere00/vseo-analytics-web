import { useState } from "react";
import { Sparkles, AlertTriangle, Clock, Camera, Hash } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/CopyButton";
import type { ProductionBrief as ProductionBriefType } from "@/types/production-brief";

const CAPTION_SECTIONS = [
  { key: "hook", label: "フック" },
  { key: "empathy", label: "共感" },
  { key: "product", label: "商品紹介" },
  { key: "benefit", label: "ベネフィット" },
  { key: "cta", label: "CTA" },
] as const;

function formatCaptionText(
  caption: ProductionBriefType["appealAxes"][number]["captionTemplate"],
): string {
  return CAPTION_SECTIONS.map(
    ({ key, label }) => `【${label}】\n${caption[key]}`,
  ).join("\n\n");
}

function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

/* ---------- Tab: 台本テンプレート ---------- */

function AppealAxesTab({
  axes,
}: {
  axes: ProductionBriefType["appealAxes"];
}) {
  return (
    <div className="grid gap-4">
      {axes.slice(0, 3).map((axis, i) => {
        const fullCaption = formatCaptionText(axis.captionTemplate);

        return (
          <Card key={i} className="relative overflow-hidden">
            <div className="absolute top-0 left-0 h-full w-1 bg-amber-500/70" />

            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge
                    variant="secondary"
                    className="shrink-0 bg-amber-100 text-amber-800 border-amber-200"
                  >
                    {axis.type}
                  </Badge>
                  <CardTitle className="text-base truncate">
                    {axis.titleIdea}
                  </CardTitle>
                </div>
                <CopyButton value={fullCaption} className="shrink-0" />
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {/* キャプション構成 */}
              <div className="rounded-sm border border-stone-200 bg-stone-50/60 divide-y divide-stone-200">
                {CAPTION_SECTIONS.map(({ key, label }, si) => (
                  <div key={key} className="flex gap-3 px-3 py-2 text-sm">
                    <span className="shrink-0 w-20 font-medium text-stone-500">
                      {si > 0 && (
                        <span className="text-stone-300 mr-1">→</span>
                      )}
                      {label}
                    </span>
                    <span className="text-stone-800">
                      {axis.captionTemplate[key]}
                    </span>
                  </div>
                ))}
              </div>

              {/* 選定理由 */}
              <p className="text-xs text-muted-foreground leading-relaxed">
                {axis.rationale}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------- Tab: ハッシュタグセット ---------- */

function HashtagSetsTab({
  sets,
}: {
  sets: ProductionBriefType["hashtagSets"];
}) {
  return (
    <div className="grid gap-4">
      {sets.map((tags, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-muted-foreground">
                セット {i + 1}
              </CardTitle>
              <CopyButton value={tags.join(" ")} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs bg-stone-100 text-stone-700 border-stone-200"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Tab: チェックリスト ---------- */

function ChecklistTab({
  items,
}: {
  items: ProductionBriefType["shootingChecklist"];
}) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <label
          key={i}
          className="flex items-start gap-3 rounded-sm border border-stone-200 bg-white px-4 py-3 cursor-pointer transition-colors hover:bg-stone-50"
        >
          <Checkbox
            checked={checked[i] ?? false}
            onCheckedChange={(v) =>
              setChecked((prev) => ({ ...prev, [i]: !!v }))
            }
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-medium ${checked[i] ? "line-through text-muted-foreground" : "text-stone-900"}`}
              >
                {item.recommendation}
              </span>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-stone-400 border-stone-200"
              >
                {item.source}
              </Badge>
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}

/* ---------- Tab: NG集 ---------- */

function NgListTab({ items }: { items: ProductionBriefType["ngList"] }) {
  return (
    <div className="grid gap-3">
      {items.map((ng, i) => (
        <Card
          key={i}
          className="relative overflow-hidden border-amber-200 bg-amber-50/40"
        >
          <div className="absolute top-0 left-0 h-full w-1 bg-amber-500" />
          <CardContent className="py-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span className="text-sm font-semibold text-amber-900">
                {ng.item}
              </span>
            </div>
            <p className="text-sm text-stone-700 pl-6">{ng.reason}</p>
            <p className="text-xs text-muted-foreground pl-6 italic">
              根拠: {ng.evidence}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Tab: 投稿スケジュール ---------- */

function PostingScheduleTab({
  schedule,
}: {
  schedule: ProductionBriefType["postingSchedule"];
}) {
  return (
    <div className="space-y-5">
      {/* TOP3 推奨時間 */}
      <div className="grid gap-3 sm:grid-cols-3">
        {schedule.top3.map((slot, i) => (
          <Card key={i} className="text-center">
            <CardContent className="py-5 space-y-2">
              <div className="flex items-center justify-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-600" />
                <span className="text-lg font-bold tracking-tight text-stone-900">
                  {slot.day}
                </span>
                <span className="text-lg font-bold text-amber-600">
                  {formatHour(slot.hour)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {slot.reason}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 避けるべき時間帯 */}
      {schedule.avoid.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            避けるべき時間帯
          </h4>
          <div className="flex flex-wrap gap-2">
            {schedule.avoid.map((slot, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-xs text-stone-400 border-stone-200"
                title={slot.reason}
              >
                {slot.day} {formatHour(slot.hour)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Main Component ---------- */

interface ProductionBriefProps {
  brief: ProductionBriefType | null | undefined;
  onGenerate?: (extra?: { productName?: string; productUrl?: string; customPrompt?: string; imageBase64?: string }) => void;
  isGenerating?: boolean;
}

export default function ProductionBrief({
  brief,
  onGenerate,
  isGenerating,
}: ProductionBriefProps) {
  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("5MB以下の画像を選択してください"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImageBase64(result);
      setImagePreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = () => {
    const extra = {
      productName: productName || undefined,
      productUrl: productUrl || undefined,
      customPrompt: customPrompt || undefined,
      imageBase64: imageBase64 || undefined,
    };
    onGenerate?.(Object.values(extra).some(Boolean) ? extra : undefined);
  };

  if (!brief) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
        <div className="rounded-full bg-amber-100 p-4">
          <Sparkles className="h-8 w-8 text-amber-600" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-stone-700">制作ブリーフが未作成です</p>
          <p className="text-xs text-muted-foreground">AIが台本・ハッシュタグを自動生成します</p>
        </div>

        {/* カスタム入力トグル */}
        <button onClick={() => setShowOptions(!showOptions)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {showOptions ? "▲ オプションを閉じる" : "▼ 商品情報・カスタム指示を追加"}
        </button>

        {showOptions && (
          <div className="w-full max-w-md space-y-3 text-left">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">商品名</label>
              <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="例: キュキュット 食器用洗剤"
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">商品URL</label>
              <input value={productUrl} onChange={e => setProductUrl(e.target.value)} placeholder="https://..."
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">AIへの追加指示</label>
              <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} placeholder="例: 20代女性向けに、コスパを強調してください"
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background resize-none h-20" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">参考画像</label>
              <div className="mt-1 flex items-center gap-3">
                <label className="cursor-pointer px-3 py-2 text-xs border rounded-md hover:bg-muted transition-colors">
                  📎 ファイルを選択
                  <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
                </label>
                {imagePreview && (
                  <div className="relative">
                    <img src={imagePreview} alt="" className="w-12 h-12 rounded object-cover border" />
                    <button onClick={() => { setImageBase64(null); setImagePreview(null); }}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center">×</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <Button onClick={handleGenerate} disabled={isGenerating} className="bg-amber-600 hover:bg-amber-700 text-white rounded-sm">
          {isGenerating ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              生成中…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              ブリーフを生成
            </span>
          )}
        </Button>
      </div>
    );
  }

  return (
    <Tabs defaultValue="script" className="w-full">
      <TabsList className="w-full justify-start overflow-x-auto rounded-sm bg-stone-100">
        <TabsTrigger value="script" className="rounded-sm text-xs gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          台本テンプレート
        </TabsTrigger>
        <TabsTrigger value="hashtags" className="rounded-sm text-xs gap-1.5">
          <Hash className="h-3.5 w-3.5" />
          ハッシュタグセット
        </TabsTrigger>
        <TabsTrigger value="schedule" className="rounded-sm text-xs gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          投稿スケジュール
        </TabsTrigger>
      </TabsList>

      <TabsContent value="script" className="mt-4">
        <AppealAxesTab axes={brief.appealAxes} />
      </TabsContent>

      <TabsContent value="hashtags" className="mt-4">
        <HashtagSetsTab sets={brief.hashtagSets} />
      </TabsContent>


      <TabsContent value="schedule" className="mt-4">
        <PostingScheduleTab schedule={brief.postingSchedule} />
      </TabsContent>
    </Tabs>
  );
}
