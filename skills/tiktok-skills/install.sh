#!/usr/bin/env bash
# TikTok提案資料スキル 一式インストーラ（macOS / Linux）
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills"
mkdir -p "$DEST"
echo "▶ スキルを $DEST に配置します"
for s in tiktok-intake tiktok-acquire tiktok-analyze tiktok-deck review-scraper; do
  echo "  - $s"
  rm -rf "$DEST/$s"
  cp -R "$HERE/$s" "$DEST/$s"
done
echo "▶ 依存をインストールします（Node / Python が必要）"
if command -v npm >/dev/null; then
  ( cd "$DEST/tiktok-acquire/scripts" && npm install --silent ) && echo "  acquire: npm OK" || echo "  acquire: npm 失敗（後で手動実行）"
  ( cd "$DEST/tiktok-deck" && npm install --silent ) && echo "  deck: npm OK" || echo "  deck: npm 失敗（後で手動実行）"
else
  echo "  ! Node.js 20+ が見つかりません。https://nodejs.org からインストール後、各scriptsで npm install してください"
fi
PY=python3; command -v python3.12 >/dev/null && PY=python3.12
if command -v "$PY" >/dev/null; then
  "$PY" -m venv "$DEST/.venv" 2>/dev/null || true
  "$DEST/.venv/bin/pip" install -q -r "$DEST/tiktok-analyze/scripts/requirements.txt" && echo "  analyze: pip OK" || echo "  analyze: pip 失敗（後で手動実行）"
else
  echo "  ! Python 3.10〜3.12 が見つかりません"
fi
echo "✅ 完了。Claude Code を再起動してください（review-scraper は追加インストール不要）"
