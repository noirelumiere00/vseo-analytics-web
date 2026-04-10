import { useCallback, useRef, useState } from "react";
import { ChevronDown, Plus, X, Package, Upload, Image, FileText, Loader2, Link } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ProductContext } from "@/types/production-brief";

interface UploadedFile {
  url: string;
  filename: string;
}

interface ProductContextPanelProps {
  value: ProductContext;
  onChange: (value: ProductContext) => void;
}

async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "アップロードに失敗しました" }));
    throw new Error(err.error);
  }
  return res.json();
}

/* ---------- File attachment list ---------- */

function FileAttachmentField({
  label,
  accept,
  icon: Icon,
  files,
  onAdd,
  onRemove,
  uploading,
}: {
  label: string;
  accept: string;
  icon: typeof Image;
  files: UploadedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  uploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-stone-600">{label}</Label>

      {/* Existing files */}
      {files.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-sm border border-stone-200 bg-white px-3 py-1.5"
        >
          <Icon className="h-3.5 w-3.5 text-stone-400 shrink-0" />
          <span className="flex-1 text-xs text-stone-600 truncate">{f.filename}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0 text-stone-400 hover:text-red-500"
            onClick={() => onRemove(i)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      {/* Upload button */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          if (selected.length) onAdd(selected);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-stone-500 hover:text-amber-700 gap-1 px-2"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Upload className="h-3 w-3" />
        )}
        ファイルを添付
      </Button>
    </div>
  );
}

/* ---------- URL list (for reference URLs) ---------- */

function UrlListField({
  label,
  placeholder,
  urls,
  onChange,
}: {
  label: string;
  placeholder: string;
  urls: string[];
  onChange: (urls: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-stone-600">{label}</Label>
      {urls.map((url, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => {
              const next = [...urls];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="h-8 text-xs rounded-sm border-stone-200 bg-stone-50/50 focus:bg-white"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0 text-stone-400 hover:text-red-500"
            onClick={() => onChange(urls.filter((_, j) => j !== i))}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-stone-500 hover:text-amber-700 gap-1 px-2"
        onClick={() => onChange([...urls, ""])}
      >
        <Plus className="h-3 w-3" />
        追加
      </Button>
    </div>
  );
}

/* ---------- Main panel ---------- */

export default function ProductContextPanel({ value, onChange }: ProductContextPanelProps) {
  const [open, setOpen] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingPdfs, setUploadingPdfs] = useState(false);

  // Parse stored files: stored as { url, filename }[] in imageFiles / pdfFiles
  const imageFiles: UploadedFile[] = value.imageFiles ?? [];
  const pdfFiles: UploadedFile[] = value.pdfFiles ?? [];

  const hasContent = !!(
    value.productName ||
    value.productDescription ||
    imageFiles.length ||
    pdfFiles.length ||
    (value.referenceUrls?.length && value.referenceUrls.some(u => u))
  );

  const handleUpload = useCallback(async (
    files: File[],
    field: "imageFiles" | "pdfFiles",
    setLoading: (v: boolean) => void,
  ) => {
    setLoading(true);
    try {
      const results = await Promise.all(files.map(uploadFile));
      const existing: UploadedFile[] = value[field] ?? [];
      onChange({ ...value, [field]: [...existing, ...results] });
    } catch (err: any) {
      console.error("Upload failed:", err);
    } finally {
      setLoading(false);
    }
  }, [value, onChange]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2 rounded-sm border border-dashed border-stone-300 px-4 py-2.5 text-left text-sm transition-colors hover:border-amber-400 hover:bg-amber-50/40"
        >
          <Package className="h-4 w-4 text-stone-400 group-hover:text-amber-600 transition-colors" />
          <span className="flex-1 font-medium text-stone-600 group-hover:text-stone-800">
            商品情報を追加（任意）
          </span>
          {hasContent && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              入力済
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 text-stone-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-up-2 data-[state=open]:slide-down-2">
        <div className="mt-3 space-y-4 rounded-sm border border-stone-200 bg-stone-50/30 p-4">
          <p className="text-[11px] text-stone-400 leading-relaxed">
            商品情報を入力すると、ブリーフに商品名や特徴が反映されます
          </p>

          {/* 商品名 */}
          <div className="space-y-1.5">
            <Label htmlFor="pc-name" className="text-xs font-medium text-stone-600">
              商品名
            </Label>
            <Input
              id="pc-name"
              value={value.productName ?? ""}
              onChange={(e) => onChange({ ...value, productName: e.target.value })}
              placeholder="例: スキンケアセラムX"
              className="h-8 text-xs rounded-sm border-stone-200 bg-stone-50/50 focus:bg-white"
            />
          </div>

          {/* 商品説明 */}
          <div className="space-y-1.5">
            <Label htmlFor="pc-desc" className="text-xs font-medium text-stone-600">
              商品説明
            </Label>
            <Textarea
              id="pc-desc"
              value={value.productDescription ?? ""}
              onChange={(e) => onChange({ ...value, productDescription: e.target.value })}
              placeholder="商品の特徴、成分、使い方など"
              rows={3}
              className="text-xs rounded-sm border-stone-200 bg-stone-50/50 focus:bg-white resize-none"
            />
          </div>

          {/* 商品画像 */}
          <FileAttachmentField
            label="商品画像"
            accept="image/*"
            icon={Image}
            files={imageFiles}
            onAdd={(files) => handleUpload(files, "imageFiles", setUploadingImages)}
            onRemove={(i) => onChange({ ...value, imageFiles: imageFiles.filter((_, j) => j !== i) })}
            uploading={uploadingImages}
          />

          {/* PDF資料 */}
          <FileAttachmentField
            label="参考資料（PDF）"
            accept=".pdf,application/pdf"
            icon={FileText}
            files={pdfFiles}
            onAdd={(files) => handleUpload(files, "pdfFiles", setUploadingPdfs)}
            onRemove={(i) => onChange({ ...value, pdfFiles: pdfFiles.filter((_, j) => j !== i) })}
            uploading={uploadingPdfs}
          />

          {/* 参考URL */}
          <UrlListField
            label="参考URL"
            placeholder="https://example.com/product-page"
            urls={value.referenceUrls ?? []}
            onChange={(referenceUrls) => onChange({ ...value, referenceUrls })}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
