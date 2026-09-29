#!/bin/bash
# render_pptx.sh — PPTX の全スライドを PNG 化する（macOS）
# BUILD_SPEC.md §10 の Render QA 用。LibreOffice 非導入環境向け。
#
# 経路: Keynote で PPTX を開く → PDF エクスポート → poppler(pdftoppm) で 1ページ1PNG
# 注意: レンダリングは Keynote の解釈による。PowerPoint 本体とごく細部が異なりうるため、
#       文字切れ・重なり・画像切れの検出には十分だが、最終提出前に PowerPoint でも開いて確認する。
#
# 使い方: tools/render_pptx.sh <input.pptx> <output_dir> [DPI]
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <input.pptx> <output_dir> [dpi]" >&2
  exit 2
fi

SRC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="$2"
DPI="${3:-110}"

[ -f "$SRC" ] || { echo "[ERROR] 入力が見つかりません: $SRC" >&2; exit 1; }
command -v pdftoppm >/dev/null || { echo "[ERROR] pdftoppm が必要です（brew install poppler）" >&2; exit 1; }

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
find "$OUT" -maxdepth 1 -name 'slide-*.png' -delete

PDF="$OUT/_render.pdf"
rm -f "$PDF"

# Keynote は起動していないと -609 になるため必ず activate してから開く
osascript -e 'tell application "Keynote" to activate' >/dev/null
sleep 2
osascript <<APPLESCRIPT >/dev/null
with timeout of 1800 seconds
tell application "Keynote"
    set theDoc to open POSIX file "$SRC"
    delay 2
    export theDoc to POSIX file "$PDF" as PDF
    close theDoc saving no
end tell
end timeout
APPLESCRIPT

[ -f "$PDF" ] || { echo "[ERROR] PDF書き出しに失敗しました" >&2; exit 1; }

pdftoppm -png -r "$DPI" "$PDF" "$OUT/slide"
# pdftoppm は slide-1.png / slide-01.png のように桁数が可変なので2桁へ正規化
python3 - "$OUT" <<'PY'
import os, re, sys
out = sys.argv[1]
for f in sorted(os.listdir(out)):
    m = re.fullmatch(r'slide-(\d+)\.png', f)
    if m:
        dst = f"slide-{int(m.group(1)):02d}.png"
        if f != dst:
            os.rename(os.path.join(out, f), os.path.join(out, dst))
n = len([f for f in os.listdir(out) if re.fullmatch(r'slide-\d+\.png', f)])
print(f"{n} 枚を書き出しました → {out}")
PY
rm -f "$PDF"
