# VSEO Analytics - 開発タスク管理

## Phase 1: 基盤構築
- [x] データベーススキーマ設計（分析履歴、動画データ、OCR結果、音声テキスト）
- [x] tRPCルーター構造設計（分析、履歴、動画収集）
- [x] デザインシステム構築（白ベース×紫-オレンジグラデーション、スイススタイル）

## Phase 2: コア機能実装
- [x] キーワード入力フォーム
- [x] 動画URL入力機能（複数URL対応）
- [ ] 3アカウント×上位20投稿の自動収集ロジック
- [x] 重複度分析エンジン（3アカウント間での動画重複チェック）
- [x] OCR解析機能（2秒/1フレーム）
- [x] 音声の完全文字起こし（Whisper API連携）

## Phase 3: UI/ダッシュボード
- [x] 構成要素の可視化ダッシュボード（サムネイル、テキスト、音声、尺）
- [x] 分析結果のスコアリング表示（チャート形式）
- [x] 分析履歴の保存と閲覧機能
- [x] ローディング状態の実装（分析は時間がかかるため）

## Phase 4: 最終調整
- [ ] エラーハンドリングの強化
- [ ] パフォーマンス最適化
- [ ] チェックポイント作成

## 実装済み機能
- [x] データベーススキーマ（analysis_jobs, videos, ocr_results, transcriptions, analysis_scores）
- [x] 動画分析エンジン（videoAnalysis.ts）
- [x] OCR解析（2秒間隔でのフレーム抽出）
- [x] Whisper API連携（音声の完全文字起こし）
- [x] LLMによるスコアリング（サムネイル、テキスト、音声、総合）
- [x] 重複度分析（3アカウント間での動画重複検出）
- [x] 分析結果表示UI（AnalysisDetailページ）
- [x] 分析履歴表示UI（Historyページ）
- [x] ユニットテスト（videoAnalysis.test.ts - 9テスト全てパス）

## 今後の拡張機能（オプション）
- [ ] 実際のTikTok/YouTube API連携（現在はダミーデータ）
- [ ] 実際のOCR API連携（Google Cloud Vision API等）
- [ ] 実際の動画フレーム抽出（ffmpeg等）
- [ ] 3アカウント×上位20投稿の自動収集機能
- [ ] バックグラウンドジョブ処理（長時間分析の非同期実行）
- [ ] エクスポート機能（CSV、PDF等）

## 緊急修正タスク
- [x] 分析実行ボタンが動作しない問題を修正
- [x] 進捗表示機能の実装（分析中の各ステップを表示）
- [x] 分析実行ロジックの改善（実際に動画データを生成）

## 進捗表示の修正
- [x] 分析開始時に動画レコードを先に作成（進掗0/9ではなく0/0を防ぐ）
- [x] バックグラウンド処理の改善

## 分析レポート機能の実装
- [x] データベーススキーマ拡張（エンゲージメント数値、KOL情報、キーフック、キーワード、ポジネガ判断）
- [x] 各動画の詳細情報をアコーディオン形式で表示
- [x] エンゲージメント数値の表示（いいね数、コメント数、シェア数、視聴回数）
- [x] KOLスプライト情報の表示（投稿者名、フォロワー数等）
- [x] キーフック・キーワード分析の実装
- [x] ポジネガ判断機能の実装
- [x] 分析レポートページの作成（PDF資料の形式に基づく）

## UI改善タスク
- [x] 分析対象動画をアコーディオン形式に変更（タップで動画プレーヤー表示）
- [x] レポートセクションを動画リストの上に追加（アコーディオン形式）
  - [x] サマリー情報（総動画数、総再生数、総エンゲージメント）
  - [x] センチメント構成比（プログレスバー）
  - [x] ポジネガ比較（プログレスバー）
  - [x] 頻出ワード分析（バッジ表示）
  - [x] 主要示唆（RISK/POSITIVEカテゴリ別）
- [x] 現在の美しいダミーUIデザインを保持

## UI修正タスク（緊急）
- [x] 分析レポートのアコーディオンを削除し、常に表示される形式に変更
- [x] 分析対象動画を2重アコーディオン化（カード全体→各動画）
- [x] 分析内容の拡張
  - [x] 投稿数比率（Positive vs Negative）
  - [x] 総再生数シェア（Positive vs Negative）
  - [x] 総エンゲージメントシェア（Positive vs Negative）
  - [x] 詳細なインサイト（RISK/URGENT/POSITIVE）

## 分析自動実行とTikTok特化
- [x] 分析結果画面に遷移したら自動的に分析を開始（pending状態の場合）
- [x] 再実行ボタンの追加（エラー時や完了後の再分析用）
- [x] TikTok特化への変更（YouTube Shortsサポート削除）
- [x] 分析対象を3アカウント×上位15本（合計45本）に調整

## 円グラフと領域別分析
- [x] センチメント分析を円グラフで表示（Positive/Neutral/Negative）
- [x] 領域別分析機能の実装
  - [x] キーワードを自動的にカテゴリ分類（スタッフ対応、体験価値、世界観、コストパフォーマンス、集客状況など）
  - [x] 各カテゴリでのPositive/Negativeの比率を横棒グラフで表示
  - [x] 分析まとめセクションの追加
- [x] 頻出ワード分析のUI改善
  - [x] Positive/Negativeに分けてタグクラウド形式で表示
  - [x] 緑背景/赤背景で視覚的に区別

## 仮想ブラウザを使用したTikTokスクレイピング
- [x] Puppeteer-coreのセットアップ（システムChromium使用）
- [x] TikTok検索スクレイピング機能の実装
  - [x] キーワードでTikTok内部APIを呼び出し
  - [x] ページネーションで大量取得→アカウント別に分類
- [x] 動画メタデータ抽出機能の実装
  - [x] 再生数、いいね数、コメント数、シェア数、保存数を取得
  - [x] 投稿者情報（ユーザー名、フォロワー数）を取得
- [x] 分析ロジックへの統合
  - [x] routers.tsの分析実行ロジックを実データ取得に変更
  - [x] videoAnalysis.tsにTikTokデータからの分析関数を追加
  - [x] LLMによるセンチメント分析、スコアリング、レポート生成
- [x] テスト（7テスト全てパス）

## 3シークレットブラウザ検索による重複度分析とLLM統合（方式変更: DOMスクレイピング）
- [x] TikTokスクレイパーを3シークレットブラウザ検索に変更
  - [x] 3つの別々のインコグニートコンテキストで同一キーワード検索
  - [x] 各ブラウザから15投稿ずつ取得
  - [x] 3回の検索結果間の重複検出（勝ちパターン動画の特定）
  - [x] パーソナライズ排除による純粋なアルゴリズム評価
- [x] LLM統合（invokeLLM使用）
  - [x] 各動画のセンチメント分析
  - [x] キーワード・キーフック抽出
  - [x] 領域別カテゴリ分類
  - [x] 総合スコアリング
  - [x] 分析レポート生成
- [x] UI更新
  - [x] 4タブ表示（勝ちパターン/準勝ち/1回のみ/全件）
  - [x] 重複度分析結果の表示（勝ちパターン動画のハイライト）
  - [x] 3シークレットブラウザ検索結果のサマリーカード

## DOM方式スクレイピング実装（方式変更: API方式に変更）
- [x] 3シークレットブラウザでTikTok内部APIを呼び出す方式に変更
- [x] 各インコグニートコンテキストでCookieを取得してAPI呼び出し
- [x] 3シークレットブラウザでの順次検索実装
- [x] 重複度分析ロジック（3回全出現/2回出現/1回のみ）

## バグ修正: React Hooks順序エラー
- [x] AnalysisDetail.tsxの「Rendered more hooks than during the previous render」エラーを修正
- [x] 条件分岐の前後でHooksの呼び出し数が変わらないよう修正

## バグ修正: Failed to fetch APIエラー
- [x] /analysis/120001ページで「Failed to fetch」TRPCClientErrorが発生する問題を修正
- [x] tripleSearchStoreをインメモリ(Map)からDBに永続化してサーバー再起動時のデータ消失を防止
- [x] フロントエンドのエラーハンドリング改善（DB永続化によりサーバー再起動後もデータ保持）

## バグ修正: 分析ジョブが「処理中」のまま残る問題
- [x] DBの分析ジョブのステータスを調査し、スタックしているジョブを特定（11件processing、10件pending）
- [x] サーバー起動時にprocessingジョブを自動的にfailedにリセットするロジックを追加
- [x] UIに再実行ボタンと削除ボタンを追加（failed/pendingステータスのジョブ用）
- [x] ジョブ削除APIを追加（関連データもカスケード削除）

## UI改善: 重複度分析カードの表示内容変更
- [x] AnalysisDetail.tsxのタイトルを「重複度分析」のみに変更（サブタイトル削除）
- [x] 検索1/2/3のラベルを「アカウント1/2/3」に変更
- [x] 重複率計算ロジックの説明を解説カードに追加
- [x] 3回全出現動画の共通点を自動抽出して表示（動画長、クリエイター規模、頻出ハッシュタグ）

## 改善: 日本プロキシ経由でTikTok検索
- [ ] 日本のプロキシサーバーの選択肢を調査
- [ ] Puppeteerのプロキシ設定を実装
- [ ] プロキシ経由での検索結果をテスト・比較

## 改善: 重複動画の共通点LLM分析
- [x] 既存データで共通点分析のサンプルを生成して確認
- [x] バックエンド: 重複動画の共通点をLLMで分析する機能を実装
- [x] フロントエンド: 重複率カードに共通点分析結果を表示
- [x] DB: 分析結果を永続化

## 改善: 重複率カードUI改善（広告フィルター・1枚カード・アコーディオン）
- [x] 広告ハッシュタグ（#PR, #ad等）を非表示にするフィルターを実装
- [x] バックエンド: LLM共通点分析機能を実装（重複動画の共通キーフック等を抽出）
- [x] DB: 共通点分析結果を永続化するカラムを追加
- [x] フロントエンド: 重複率+共通点分析を1枚のカードに統合
- [x] フロントエンド: LLM共通点分析をアコーディオン（展開/折りたたみ）で表示

## LLM共通点分析機能の実装
- [x] DBスキーマ: triple_search_resultsテーブルにcommonalityAnalysis JSON列を追加
- [x] 広告ハッシュタグフィルタ関数の実装（#PR, #ad, #提供, #タイアップ, #sponsored, #promotion）
- [x] LLM共通点分析関数の実装（勝ちパターン動画の共通特徴を抽出）
- [x] バックエンドルート統合（スクレイピング完了後にLLM分析を実行・DB保存）
- [x] フロントエンドUI更新（アコーディオン形式でLLM分析結果を表示）
- [x] テスト実行と動作確認

## バグ修正: 過去の分析履歴が表示されない
- [ ] 過去の分析履歴ページのコードを確認
- [ ] 問題の原因を特定（データ取得、レンダリング、ルーティング等）
- [ ] 修正を実装
- [ ] 動作確認

## バグ修正: フォロワー数が0になっている
- [x] tiktokScraper.tsのparseVideoData関数を修正（authorStats対応）
- [ ] 修正後の動作確認

## デバッグ機能: TikTokスクレイピング失敗原因の特定
- [x] puppeteer.launch失敗時の詳細エラーロギング
- [x] CAPTCHA検出用スクリーンショット機能
- [x] APIエラー時の詳細レスポンスロギング
- [x] テスト実行と動作確認

## 緗急修正: TikTok API「Unexpected end of JSON input」エラー対応
- [x] fetchSearchResults関数のJSON解析エラー詳細化（空レスポンス、HTMLエラーページ検出）
- [x] バックエンドのエラーハンドリング改善（TRPCErrorを投げる）
- [x] フロントエンドのエラー表示改善（ユーザーに分かりやすいメッセージ）
- [x] テスト実行と動作確認

## 改善: LLMを使ったキーワード仕分け
- [x] generateAnalysisReport関数の現在のキーワード整理ロジックを確認
- [x] LLMを使ったキーワード仕分け機能を実装（ポジティブ、15個、ネガティブ、15個）
- [x] テスト実行と動作確認

## 新機能: TikTokコメント取得とLLM分析
- [x] tiktokScraper.tsのscrapeTikTokComments関数を追加
- [x] videoAnalysis.tsでコメント取得・LLM分析を統合
- [x] puppeteer-extra-plugin-stealthを導入
- [x] テスト実行と動作確認

## 新機能: 分析レポートのPDFエクスポート
- [x] バックエンド: PDF生成ロジックの実装（docxライブラリ）
  - [x] 単一ジョブのPDF生成API（/api/trpc/analysis.exportPdf）
  - [ ] 全レポートの一括PDF生成API（/api/trpc/analysis.exportAllPdf）
  - [x] PDF内容: タイトル、サマリー、グラフ、動画リスト、共通点分析
- [x] フロントエンド: PDFエクスポートUI
  - [x] AnalysisDetail.tsxに「PDFダウンロード」ボタンを追加
  - [ ] History.tsxに「全レポートをPDF化」ボタンを追加
  - [x] ダウンロード進捗表示
- [x] テスト・検証 (pdfGenerator.test.ts: 6テスト全てパス)
## 改善: PDF出力機能の Puppeteer 方式への切り替え
- [x] Phase 1: Puppeteer 環境構築・設計
  - [x] puppeteer パッケージのインストール
  - [x] Puppeteer + Headless Chrome の動作確認
  - [x] 日本語フォント（Google Noto Fonts）の設定
- [x] Phase 2: バックエンド Puppeteer PDF生成ロジック
  - [x] /api/trpc/analysis.exportPdfPuppeteer エンドポイント作成
  - [x] jobId → 分析ページURL生成ロジック
  - [x] Puppeteer レンダリング・出力処理
  - [x] A4サイズ、printBackground: true オプション設定
- [x] Phase 3: フロントエンド UI・CSS実装
  - [x] AnalysisDetail.tsx に Puppeteer PDF ボタン追加
  - [x] @media print CSS でアコーディオン全開制御
  - [x] page-break-inside: avoid で改ページ制御
  - [x] ヘッダー/フッター（ページ番号）CSS実装
- [x] Phase 4: 日本語フォント・改ページ処理・テスト・デプロイ (pdfExporter.test.ts: 11テスト全てパス) - [ ] Google Noto Fonts の HTML 読み込み確認
  - [ ] 日本語文字化けテスト
  - [ ] 改ページ処理の検証
  - [ ] ユニットテスト作成・実行
  - [ ] 本番環境での動作確認

## 改善: HTML スナップショット方式への切り替え（認証回避）
- [x] 根本原因の特定: Puppeteer でのセッション Cookie 引き継ぎが失敗
- [x] 方針変更: フロントエンドで描画済みの HTML をそのまま送信
- [x] バックエンド実装
  - [x] pdfExporter.ts に generatePdfFromSnapshot 関数を追加
  - [x] <base href> タグを注入して相対パスを解決
  - [x] page.emulateMediaType('screen') で画面用 CSS を強制適用
  - [x] printBackground: true で背景色を保持
- [x] フロントエンド実装
  - [x] AnalysisDetail.tsx に exportPdfSnapshot mutation を追加
  - [x] handleExportPdfSnapshot 関数で HTML スナップショット取得
  - [x] document.documentElement.outerHTML で完全な HTML を取得
  - [x] window.location.origin で baseUrl を取得
  - [x] PDF (全開) ボタンを新方式に切り替え
- [x] バックエンド API
  - [x] routers.ts に exportPdfSnapshot エンドポイントを追加
  - [x] HTML + baseUrl を受け取る入力スキーマ
- [x] 確認事項
  - [x] JSON body size limit は既に 50mb に設定済み
  - [x] TypeScript コンパイルエラー解決
  - [x] 既存テスト全てパス

## 改善: PDF エクスポート時のアコーディオン全開処理
- [x] 問題の特定: HTML スナップショット取得時にアコーディオンが閉じたままになっていた
- [x] 根本原因: document.documentElement.outerHTML を実行する瞬間のアコーディオン状態が反映されていた
- [x] 解決策の実装
  - [x] handleExportPdfSnapshot を async 関数に変更
  - [x] button[aria-expanded="false"] で閉じたアコーディオンを全て検出
  - [x] .click() で各アコーディオンを開く
  - [x] 0.5秒待機してアニメーション完了を待つ
  - [x] その後 HTML スナップショットを取得
  - [x] デバッグログを追加
- [x] TypeScript コンパイルエラーなし
- [x] サーバー正常動作確認

## 緗急修正: Puppeteer page.setContent() のタイムアウトエラー
- [x] バックエンド修正
  - [x] waitUntil 条件を 'domcontentloaded' に変更（networkidle0 から緩和）
  - [x] timeout を 60000ms に設定
  - [x] page.goto() が残っていないか確認・削除
- [x] フロントエンド修正
  - [x] HTML 取得前に img[loading="lazy"] を無効化
  - [x] document.querySelectorAll('img').forEach(img => img.removeAttribute('loading'))
- [x] テスト実行と動作確認
- [x] チェックポイント保存

## 改善: PDF 出力時のプレビューバナー非表示処理
- [x] フロントエンド修正
  - [x] handleExportPdfSnapshot 内にバナー非表示ロジックを追加
  - [x] "This page is not live and cannot be shared directly" テキストを検出
  - [x] バナー要素を一時的に非表示（display: none）
  - [x] HTML スナップショット取得
  - [x] バナーを元に戻す（任意）
- [x] TypeScript コンパイルエラー確認
- [x] サーバー動作確認
- [x] チェックポイント保存

## 改善: PDF 出力時のフォント・レイアウト一致化
- [x] バックエンド修正（pdfExporter.ts）
  - [x] Viewport サイズ固定：page.setViewport({ width: 1280, height: 1024, deviceScaleFactor: 2 })
  - [x] メディアタイプを screen に強制：page.emulateMediaType('screen')
  - [x] Webfont 完全読み込み待機：page.evaluateHandle('document.fonts.ready')
  - [x] 背景色維持：page.pdf({ printBackground: true })
- [x] TypeScript コンパイルエラー確認
- [x] サーバー動作確認
- [x] チェックポイント保存
