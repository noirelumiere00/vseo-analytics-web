# VSEO Analytics MVP - 本番実行に向けたタスク一覧

> 現在の実装状況を踏まえ、実際に本番運用するために必要な作業を整理したドキュメント。

---

## 1. インフラ・環境構築

### 1-1. 必須環境変数の設定

| 変数名 | 用途 | 優先度 |
|--------|------|--------|
| `DATABASE_URL` | MySQL接続文字列 | **必須** |
| `JWT_SECRET` | セッション署名用シークレット | **必須** |
| `AWS_ACCESS_KEY_ID` | AWS認証 | **必須**（分析機能に必要） |
| `AWS_SECRET_ACCESS_KEY` | AWS認証 | **必須**（分析機能に必要） |
| `AWS_REGION` | AWSリージョン（デフォルト: us-west-2） | 任意 |
| `BEDROCK_MODEL_ID` | LLMモデル（デフォルト: claude-haiku-4-5） | 任意 |
| `APP_URL` | アプリのURL（CORS・リダイレクトで使用） | **必須** |
| `ADMIN_EMAIL` | 管理者メールアドレス | 推奨 |

### 1-2. データベース

- [ ] 本番用MySQLインスタンスの構築
- [ ] `npm run db:push` でスキーマ適用
- [ ] 管理者ユーザーの初期作成（role: `admin`）
- [ ] バックアップ体制の構築（定期mysqldump等）

### 1-3. サーバー環境

- [ ] Node.js 20+ のインストール
- [ ] Chromium + 依存ライブラリのインストール（Puppeteerのスクレイピングに必要）
  - `libnss3`, `libatk1.0-0`, `libx11-xcb1`, `libxcomposite1` など
  - 日本語フォント（`fonts-noto-cjk` 等）
- [ ] `npm run build` でビルド確認
- [ ] `npm run start` で起動確認
- [ ] プロセスマネージャー（PM2等）の導入
- [ ] メモリ制限の設定（スクレイピング時のOOMガードとして512MB～1GB推奨）

### 1-4. ネットワーク・ドメイン

- [ ] ドメイン取得・DNS設定
- [ ] SSL証明書の設定（Let's Encrypt等）
- [ ] リバースプロキシ設定（nginx推奨）
- [ ] `APP_URL` を本番URLに設定

---

## 2. 外部サービス連携

### 2-1. AWS Bedrock（LLM）- 必須

- [ ] AWSアカウントでBedrock APIの有効化
- [ ] Claude Haiku 4.5 モデルへのアクセス申請
- [ ] IAMユーザー作成（`bedrock:InvokeModel` 権限）
- [ ] アクセスキーを環境変数に設定
- [ ] 動作確認：分析ジョブの実行→感情分析・キーワード抽出が正常動作

### 2-2. Stripe（課金）- MVP後でも可

> Free プランのみで運用する場合はスキップ可能

- [ ] Stripeアカウント作成
- [ ] Pro / Business プランの Price ID 作成
- [ ] Webhook エンドポイント登録（`/api/stripe/webhook`）
- [ ] 環境変数設定:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ID_PRO`
  - `STRIPE_PRICE_ID_BUSINESS`
- [ ] テスト決済の実行確認

### 2-3. Google OAuth（ログイン）- MVP後でも可

> メールアドレス + パスワード認証はOAuth無しで動作する

- [ ] Google Cloud Console でプロジェクト作成
- [ ] OAuth 2.0 クライアントID作成（Web application）
- [ ] 承認済みリダイレクト URI に `{APP_URL}/api/auth/google/callback` を追加
- [ ] 環境変数設定:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`

### 2-4. AWS SES（メール）- MVP後でも可

> パスワードリセット機能に必要。MVP時点ではなくても動作する

- [ ] SES でドメイン検証 or メールアドレス検証
- [ ] 本番用の送信制限解除申請（サンドボックス解除）
- [ ] `SES_FROM_ADDRESS` を設定

---

## 3. コア機能の本番検証

### 3-1. TikTok スクレイピング

- [ ] 本番サーバーからTikTok検索が正常に動作するか検証
  - Puppeteer が3つのシークレットウインドウでTikTok検索を実行
  - 各セッションで最大60本の動画メタデータを取得
- [ ] IPブロック対策の検討
  - プロキシの導入（長期的に必要になる可能性あり）
  - リクエスト間隔の調整（現在のランダム遅延の効果確認）
- [ ] Chromium メモリ使用量のモニタリング
  - 現在の設定: `--max-old-space-size=128`, 画像/メディアのブロック済み
- [ ] タイムアウト対策の確認
  - 動画分析は5本並列で実行済み
  - 全体のジョブタイムアウトが適切か確認

### 3-2. LLM 分析

- [ ] 感情分析（Positive/Neutral/Negative）の精度確認
- [ ] キーワード抽出の品質確認
- [ ] アスペクト分析の品質確認
- [ ] 勝ちパターン/負けパターン分析の品質確認
- [ ] ハッシュタグ戦略提案の品質確認
- [ ] AWS Bedrock のレート制限・コスト見積もり
  - 1ジョブあたり最大180本の動画 × 複数LLMコール

### 3-3. レポート生成

- [ ] 分析結果の表示が正常か確認
  - 感情構成チャート
  - インパクト分析
  - 頻出ワードクラウド
  - 動画詳細アコーディオン
- [ ] CSV エクスポートの動作確認
- [ ] PDF エクスポートの動作確認（現在コメントアウト中 → 有効化するか判断）

---

## 4. セキュリティ

- [ ] `JWT_SECRET` に十分な長さのランダム文字列を設定（32文字以上推奨）
- [ ] CORS の `origin` が本番URLのみを許可しているか確認
- [ ] Helmet セキュリティヘッダーの確認
- [ ] レートリミットの確認
  - ログイン: 15分 / 10回
  - パスワードリセット: 1時間 / 3回
  - 登録: 1時間 / 5回
  - tRPC 全体: 1分 / 120回
- [ ] Cookie の `secure` フラグが本番で有効か確認
- [ ] 管理者アカウントのパスワード強度確認

---

## 5. 運用・監視

### 5-1. ログ・モニタリング

- [ ] サーバーログの永続化（現在はインメモリ2000行 + ファイル出力）
- [ ] エラーアラートの設定（重要なエラー発生時に通知）
- [ ] ジョブ実行状況のモニタリング方法の決定
- [ ] ディスク使用量の監視（ログファイルが1MBで自動トリム済み）

### 5-2. 障害対応

- [ ] サーバー再起動時のジョブ復旧手順の確認
  - 実行中ジョブは `running` ステータスのままになる可能性
- [ ] Chromium クラッシュ時の自動復旧確認
- [ ] データベース接続切れ時の再接続動作確認

---

## 6. MVP最小構成まとめ

**最低限必要なもの（これだけで分析機能が動作する）：**

1. MySQL データベース
2. Node.js + Chromium が動作するサーバー
3. AWS Bedrock（Claude Haiku）へのアクセス
4. 環境変数: `DATABASE_URL`, `JWT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `APP_URL`

**MVP後に段階的に追加：**

| 機能 | 必要なサービス | 優先度 |
|------|---------------|--------|
| 課金（Pro/Business プラン） | Stripe | 中 |
| Google ログイン | Google OAuth | 低 |
| パスワードリセット | AWS SES | 低 |
| PDF エクスポート | Puppeteer（サーバー内で完結） | 低 |
| IPブロック対策 | プロキシサービス | 中（長期運用時） |
| エラー監視 | Sentry / DataDog 等 | 中 |

---

## 7. デプロイ手順チェックリスト

```
1. サーバー環境を構築（Node.js, Chromium, MySQL）
2. リポジトリをクローン
3. npm install
4. 環境変数を設定（.env ファイル or システム環境変数）
5. npm run db:push （スキーマ適用）
6. npm run build
7. npm run start （or PM2 で起動）
8. ブラウザでアクセスし、ユーザー登録→分析実行→結果確認
```
