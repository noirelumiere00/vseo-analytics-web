# 調査引き継ぎ: 「Preview mode」バナー表示問題

## 事象
特定ユーザーが `vseoanalytics.com/campaigns/8/report` にアクセスすると、ページ下部に以下のバナーが表示される：

> **Preview mode**
> This page is not live and cannot be shared directly. Please publish to get a public link.

## 調査済み事項

### 1. コードベースに原因なし
- `client/index.html` にVercel関連スクリプトなし
- `package.json` にVercel系パッケージなし
- `vercel.json` / `.vercel/` ディレクトリ存在しない
- コード内に「Preview mode」「not live」等のメッセージは存在しない（AnalysisDetail.tsxにコメントアウトされた残骸のみ）

### 2. インフラ構成
- **フロントエンド配信**: AWS上のExpressサーバーからビルド済み静的ファイルを配信（`dist/public`）
- **バックエンド**: 同じAWS Express サーバー（tRPC API）
- **DB**: AWS上のMySQL
- **Vercelは本番配信に使っていない**（はず）

### 3. Vercelプロジェクトの状況
Vercel上に2つのプロジェクトが存在：
- `vseo-analytics-web` → ドメイン: `vseo-analytics-web.vercel.app`
- `vseo-analytics-web-part2` → ドメイン: `vseo-analytics-web-part2.vercel.app`

**どちらにも `vseoanalytics.com` カスタムドメインは設定されていない**（ユーザー確認済み）

### 4. バナーの正体
このメッセージはVercelの「Deployment Protection」機能が出すUI。Vercelのプレビューデプロイメントにアクセスした際、認証されていないユーザーに表示される標準バナー。

## 未解決の疑問

1. **`vseoanalytics.com` のDNSはどこを向いているか？**
   - AWSに直接向いているなら、Vercelのバナーが出るはずがない
   - 実はVercel経由（CNAMEがVercelを指している）の可能性がある
   - → `dig vseoanalytics.com` や `nslookup vseoanalytics.com` でDNS確認が必要

2. **ユーザーが開いているURLは本当に `vseoanalytics.com` か？**
   - `*.vercel.app` のブックマークを開いている可能性
   - → URLバーが見えるスクショをユーザーから取得して確認

3. **全ユーザーに出ているのか、特定ユーザーだけか？**
   - ブラウザ拡張機能の影響の可能性
   - → 別ブラウザ/シークレットモードで再現確認

## 調査の次ステップ

### 優先度高
1. **DNS確認**: `dig vseoanalytics.com` を実行し、Aレコード/CNAMEがどこを向いているか確認
2. **ユーザーにスクショ依頼**: URLバーが見える状態でバナー表示画面のスクショ取得
3. **自分で再現確認**: シークレットモードで `vseoanalytics.com/campaigns/8/report` にアクセス

### 優先度中
4. **Vercel Deployment Protection確認**: 両プロジェクトの Settings → Deployment Protection の設定状況
5. **Vercelプロジェクトの整理**: 2つあるプロジェクトのうちどちらが必要か、不要な方は削除検討

## 関連ファイル
- `client/index.html` — フロントエンドのエントリポイント
- `client/src/pages/SharedReport.tsx` — 共有レポートページ（`/share/:token`）
- `client/src/pages/CampaignReport.tsx` — レポートページ（`/campaigns/:id/report`）
