#!/usr/bin/env bash
#
# Claude Code（リモートコンテナ）で VSEO Analytics をゼロから起動可能にする冪等セットアップ。
#
#   依存ライブラリ + Chromium / pnpm install / MariaDB 起動 + DB 作成 /
#   .env 生成 / スキーマ適用 / dev ユーザー seed
#
# 秘密情報（ANTHROPIC_API_KEY 等）はここで .env に書かず、コンテナの環境変数で注入する。
# 各ステップは「既に済んでいればスキップ」する。手動でもセッション開始フックでも実行可能。
#
set -uo pipefail
cd "$(dirname "$0")/.."

log() { echo "[dev-setup] $*"; }

# ---------------------------------------------------------------------------
# 1. システム依存（DB サーバーは必須 / Chromium ライブラリはベストエフォート）
#    ※ Ubuntu 24.04 では一部ライブラリが t64 名（libasound2t64 等）に改名されており、
#       1つでも欠けると一括 install が丸ごと失敗する。そのため DB は独立 install、
#       Chromium ライブラリは個別 install（|| true）にして堅牢化する。
# ---------------------------------------------------------------------------
if ! command -v mariadbd >/dev/null 2>&1 && ! command -v mysqld >/dev/null 2>&1; then
  log "MariaDB をインストール中..."
  apt-get update -y >/dev/null 2>&1 || log "apt-get update に失敗（続行）"
  apt-get install -y --no-install-recommends mariadb-server openssl ca-certificates wget >/dev/null 2>&1 \
    || log "mariadb-server のインストールに失敗（DB が必要なら手動確認）"
else
  log "MariaDB は導入済み"
fi

if ! dpkg -s libnss3 >/dev/null 2>&1; then
  log "Chromium 用システムライブラリを導入中（ベストエフォート）..."
  apt-get update -y >/dev/null 2>&1 || true
  for pkg in \
    fonts-liberation libasound2t64 libasound2 \
    libatk-bridge2.0-0t64 libatk-bridge2.0-0 libatk1.0-0t64 libatk1.0-0 \
    libcairo2 libcups2t64 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
    libgbm1 libglib2.0-0t64 libglib2.0-0 libgtk-3-0t64 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libdrm2 libxkbcommon0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    lsb-release xdg-utils; do
    apt-get install -y --no-install-recommends "$pkg" >/dev/null 2>&1 || true
  done
else
  log "Chromium 用システムライブラリは導入済み"
fi

# ---------------------------------------------------------------------------
# 2. JS 依存（pnpm install）
# ---------------------------------------------------------------------------
if [ ! -d node_modules ] || [ ! -d node_modules/@anthropic-ai/sdk ]; then
  log "JS 依存をインストール中（pnpm install）..."
  pnpm install || log "pnpm install に失敗（続行）"
else
  log "node_modules は導入済み"
fi

# ---------------------------------------------------------------------------
# 3. Puppeteer 用 Chromium（.cache/puppeteer に配置）
# ---------------------------------------------------------------------------
if ! ls ./.cache/puppeteer/chrome/*/chrome-linux*/chrome >/dev/null 2>&1; then
  log "Puppeteer 用 Chromium をインストール中..."
  npx puppeteer browsers install chrome >/dev/null 2>&1 || log "Chromium インストールに失敗（続行）"
else
  log "Chromium は導入済み"
fi

# ---------------------------------------------------------------------------
# 4. MariaDB 起動 + DB / ユーザー作成
# ---------------------------------------------------------------------------
run_sql() {
  if command -v mariadb >/dev/null 2>&1; then mariadb -u root "$@";
  elif command -v mysql >/dev/null 2>&1; then mysql -u root "$@";
  else return 1; fi
}

if command -v mariadbd >/dev/null 2>&1 || command -v mysqld >/dev/null 2>&1; then
  # 既に起動済みでなければ起動（コンテナでは systemd/service が使えないため直接起動）
  if ! run_sql -e "SELECT 1" >/dev/null 2>&1; then
    log "MariaDB を起動中..."
    mkdir -p /run/mysqld
    chown -R mysql:mysql /run/mysqld /var/lib/mysql 2>/dev/null || true

    # データディレクトリ未初期化なら初期化
    if [ ! -d /var/lib/mysql/mysql ]; then
      log "MariaDB データディレクトリを初期化中..."
      mariadb-install-db --user=mysql --datadir=/var/lib/mysql --auth-root-authentication-method=socket >/dev/null 2>&1 \
        || mysql_install_db --user=mysql --datadir=/var/lib/mysql >/dev/null 2>&1 || true
    fi

    # バックグラウンド起動
    if command -v mariadbd-safe >/dev/null 2>&1; then
      nohup mariadbd-safe --user=mysql --datadir=/var/lib/mysql >/tmp/mariadb-dev.log 2>&1 &
    elif command -v mysqld_safe >/dev/null 2>&1; then
      nohup mysqld_safe --user=mysql --datadir=/var/lib/mysql >/tmp/mariadb-dev.log 2>&1 &
    else
      service mariadb start >/dev/null 2>&1 || log "MariaDB 起動コマンドが見つかりません"
    fi

    # ソケットが上がるまで待機
    for _ in $(seq 1 60); do
      if run_sql -e "SELECT 1" >/dev/null 2>&1; then break; fi
      sleep 1
    done
  fi

  if ! run_sql -e "SELECT 1" >/dev/null 2>&1; then
    log "MariaDB に接続できません（/tmp/mariadb-dev.log を確認）"
  fi

  log "データベースとユーザーを作成中..."
  run_sql -e "CREATE DATABASE IF NOT EXISTS vseo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
              CREATE USER IF NOT EXISTS 'vseo'@'%' IDENTIFIED BY 'vseo';
              CREATE USER IF NOT EXISTS 'vseo'@'localhost' IDENTIFIED BY 'vseo';
              GRANT ALL PRIVILEGES ON vseo.* TO 'vseo'@'%';
              GRANT ALL PRIVILEGES ON vseo.* TO 'vseo'@'localhost';
              FLUSH PRIVILEGES;" >/dev/null 2>&1 \
    || log "DB/ユーザー作成に失敗（続行）"
else
  log "MariaDB が見つからないため DB 起動をスキップ"
fi

# ---------------------------------------------------------------------------
# 5. .env 生成（無ければ）— 秘密情報は書かない
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  log ".env を生成中..."
  JWT="$(openssl rand -base64 64 | tr -d '\n')"
  cat > .env <<EOF
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DATABASE_URL=mysql://vseo:vseo@127.0.0.1:3306/vseo
JWT_SECRET=${JWT}
VITE_APP_ID=vseo-analytics
OAUTH_SERVER_URL=http://localhost:3000
APP_URL=http://localhost:3000

# === 秘密情報はここに書かず、コンテナの環境変数として注入してください ===
#   ANTHROPIC_API_KEY=...        # 必須（LLM 分析）
#   ANTHROPIC_MODEL_ID=claude-haiku-4-5   # 任意（既定 Haiku 4.5。claude-sonnet-4-6 等に変更可）
#   APIFY_API_TOKEN=...          # 任意（数値計測の補完）
#   PROXY_SERVER=... PROXY_USERNAME=... PROXY_PASSWORD=...   # 任意（日本 IP 経由）
EOF
else
  log ".env は既に存在するため温存"
fi

# 以降のステップで DATABASE_URL 等を使うため .env を読み込む
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# ---------------------------------------------------------------------------
# 6. スキーマ適用（drizzle の既存マイグレーションを反映）
# ---------------------------------------------------------------------------
if [ -n "${DATABASE_URL:-}" ]; then
  log "DB スキーマを適用中（drizzle-kit migrate）..."
  pnpm exec drizzle-kit migrate >/dev/null 2>&1 \
    || pnpm exec drizzle-kit push --force >/dev/null 2>&1 \
    || log "スキーマ適用に失敗（DB 起動を確認してください）"
else
  log "DATABASE_URL 未設定のためスキーマ適用をスキップ"
fi

# ---------------------------------------------------------------------------
# 7. 開発用ユーザー seed
# ---------------------------------------------------------------------------
if [ -n "${DATABASE_URL:-}" ]; then
  log "開発用ユーザーを seed 中..."
  pnpm seed:dev-user || log "dev user seed に失敗（続行）"
fi

log "セットアップ完了。"
log "  起動: pnpm dev   →  http://localhost:3000"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  log "  ⚠ ANTHROPIC_API_KEY 未設定。分析を回す前に環境変数で注入してください。"
fi
