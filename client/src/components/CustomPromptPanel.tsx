import { useState, useEffect } from "react";
import { ChevronDown, MessageSquarePlus, Save, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const MAX_LENGTH = 2000;

export default function CustomPromptPanel() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  const { data, isLoading } = trpc.auth.getBriefCustomPrompt.useQuery();
  const mutation = trpc.auth.updateBriefCustomPrompt.useMutation();

  // Sync fetched value into draft
  useEffect(() => {
    if (data?.prompt != null) {
      setDraft(data.prompt);
    }
  }, [data?.prompt]);

  const savedPrompt = data?.prompt ?? null;
  const hasSaved = !!savedPrompt;

  function handleSave() {
    const value = draft.trim() || null;
    mutation.mutate({ prompt: value }, {
      onSuccess: () => setDirty(false),
    });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2 rounded-sm border border-dashed border-stone-300 px-4 py-2.5 text-left text-sm transition-colors hover:border-amber-400 hover:bg-amber-50/40"
        >
          <MessageSquarePlus className="h-4 w-4 text-stone-400 group-hover:text-amber-600 transition-colors" />
          <span className="flex-1 font-medium text-stone-600 group-hover:text-stone-800">
            カスタム指示を追加（任意）
          </span>
          {hasSaved && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              設定済
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-stone-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-up-2 data-[state=open]:slide-down-2">
        <div className="mt-3 space-y-3 rounded-sm border border-stone-200 bg-stone-50/30 p-4">
          <p className="text-[11px] text-stone-400 leading-relaxed">
            ブリーフ生成時に常に適用されるカスタムルールを設定できます（例:「激安という表現は使わない」「ターゲットは20代女性」）
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
            </div>
          ) : (
            <>
              <Textarea
                value={draft}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.length <= MAX_LENGTH) {
                    setDraft(v);
                    setDirty(true);
                  }
                }}
                placeholder="例: 「激安」「爆安」等の安売り表現は使わない&#10;ターゲットは20代後半〜30代前半の女性&#10;語尾は「〜だよ」「〜してみて」で統一"
                rows={4}
                className="text-xs rounded-sm border-stone-200 bg-stone-50/50 focus:bg-white resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-stone-400 tabular-nums">
                  {draft.length}/{MAX_LENGTH}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 rounded-sm"
                  onClick={handleSave}
                  disabled={!dirty || mutation.isPending}
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  保存
                </Button>
              </div>
              {mutation.isSuccess && !dirty && (
                <p className="text-[11px] text-emerald-600">保存しました</p>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
