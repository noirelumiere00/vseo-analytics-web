#!/usr/bin/env bash
# TikTok提案資料スキル 一式インストーラ（macOS / Linux）
#
# 失敗を「OK」と表示しない。最後に手順ごとの結果を並べ、1つでも失敗していれば終了コード1で終わる。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills"
SKILLS="tiktok-intake tiktok-acquire tiktok-analyze tiktok-deck review-scraper"
FAILED=0
RESULTS=()
ok()   { RESULTS+=("  ✅ $1"); }
ng()   { RESULTS+=("  ❌ $1"); FAILED=1; }

mkdir -p "$DEST"
echo "▶ スキルを $DEST に配置します"
if [ "$HERE" = "$DEST" ]; then
  # ZIPを ~/.claude/skills に直接展開した場合。消してからコピーすると元が消える
  echo "  （すでに $DEST にあるので配置は省略）"
  ok "配置（展開先がそのまま配置先）"
else
  for s in $SKILLS; do
    if [ ! -d "$HERE/$s" ]; then
      ng "配置: $s がZIPの中にありません"
      continue
    fi
    echo "  - $s"
    # 一時名にコピーしてから差し替える。途中で失敗しても既存のスキルを消さない
    rm -rf "$DEST/.$s.tmp"
    if cp -R "$HERE/$s" "$DEST/.$s.tmp"; then
      rm -rf "$DEST/$s" && mv "$DEST/.$s.tmp" "$DEST/$s" && ok "配置: $s" || ng "配置: $s（差し替えに失敗）"
    else
      rm -rf "$DEST/.$s.tmp"
      ng "配置: $s（コピーに失敗）"
    fi
  done
fi

echo "▶ Node の依存（Node.js 20 以上）"
if command -v npm >/dev/null 2>&1; then
  for d in "tiktok-acquire/scripts" "tiktok-deck"; do
    if (cd "$DEST/$d" && npm install --silent); then ok "npm: $d"; else ng "npm: $d（後で cd $DEST/$d && npm install）"; fi
  done
else
  ng "Node.js が見つかりません（https://nodejs.org から 20 以上を入れて、各フォルダで npm install）"
fi

echo "▶ Python の依存（Python 3.10〜3.12 の venv を1つ作って全スキルで共有）"
PY=""
for c in python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1 && \
     "$c" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then
    PY="$c"; break
  fi
done
if [ -z "$PY" ]; then
  ng "Python 3.10〜3.12 が見つかりません（3.13 以上や 3.9 では計測モジュールが動きません）"
else
  if "$PY" -m venv "$DEST/.venv" && \
     "$DEST/.venv/bin/python" -m pip install -q -r "$DEST/tiktok-analyze/scripts/requirements.txt"; then
    ok "pip: $DEST/.venv（$("$DEST/.venv/bin/python" -V 2>&1)）"
  else
    ng "pip: 依存を入れられませんでした（$DEST/.venv/bin/python -m pip install -r $DEST/tiktok-analyze/scripts/requirements.txt を手で実行）"
  fi
fi

echo
echo "結果:"
printf '%s\n' "${RESULTS[@]}"
echo
echo "Python のツールは $DEST/.venv/bin/python で実行してください（初訪の一覧シートは Pillow を使います）。"
echo "review-scraper は追加インストール不要。PDF が要るときだけ LibreOffice を入れてください。"
if [ "$FAILED" -ne 0 ]; then
  echo "⚠ 失敗した手順があります（上の ❌）。直してから Claude Code を再起動してください。"
  exit 1
fi
echo "✅ 完了。Claude Code を再起動してください。"
