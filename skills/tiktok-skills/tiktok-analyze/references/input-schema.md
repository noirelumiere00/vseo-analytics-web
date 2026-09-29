# 入力データのスキーマとデータ収集手順

このSkillが受け取るのは、`01-acquire` の `search.mjs` が出力した JSON（`raw/*.json`）である。Excel は使わない（取得経路を一本化したため）。

## 営業依頼の受付

依頼文に作成したい資料、章、分析項目、ファイル形式が明記されていれば、その指定を入力要件の正とする。営業ステータスへ置き換えて指定範囲を狭めない。依頼が曖昧な場合だけ `status-router.md` で①初訪、②具体提案、③構成提案、④レポート、⑤競合差再提案を判定し、`status-output-spec.md` の必須入力を使う。

`scripts/route_sales_request.py` の `requested_output_text` に営業の依頼原文、`output_formats` にPDF/PPTX指定、`constraints` に本数・ページ数・除外条件を保存する。定義済みモジュール名へ変換できない明示要件も原文を捨てず、その内容を資料仕様として使う。

依頼文と添付ファイルを先に読み、既に分かる情報を再質問しない。初回返答は `intake-response-schema.md` に従い、判定または明示指定、作成予定、確認済み情報、不足情報、コピー用回答欄を一度に返す。営業が不足情報と作成指示を返したら、重大な曖昧さがない限り再確認せず実行する。

案件設定では次を分離する。

- `official_site_url`：商品、訴求、ブランド表記を確認する公式サイトURL
- `official_tiktok_account`：公式投稿者を照合するTikTokアカウントURLまたは`@handle`
- `official_url`：既存スクリプト互換用。`official_site_url` と同じ値を保存する

①初訪では、一般キーワードとブランド名の検索結果を `01-acquire` の `search.mjs` で取得する（Excelは不要）。

④レポートでは、施策前と施策後を**同じ検索語・同じ条件**で取得した JSON を必須とする。

## ファイルの単位

対応する検索結果エクスポートツールは「ブランド名またはキーワード1件につき検索→必要件数を読み込み→エクスポート」を1回行う運用が基本であり、**1ファイル＝1つの検索軸（自社・競合1社・市場キーワードなど）**に対応する。複数ブランドが1ファイルに混在することは想定しない。そのため本Skillは、`query_group`列で軸を判別するのではなく、**ファイル単位**で役割（自社／競合／市場キーワード軸）を扱う。

## 列スキーマ（実データで確認した22列）

列の並び順や列名の細部（全角/半角、末尾の「？」の有無など）はツールのバージョンで揺れることがあるため、`scripts/common.py` の `COLUMN_ALIASES` は表記ゆれを許容するマッピングになっている。以下は代表的な列名（実データでの実際の見出し）。

| # | 列名（実データ） | 正規名 | 必須 | 内容 |
|---|---|---|---|---|
| 1 | 動画カバー | cover_image | 任意 | 埋め込みサムネイル画像（後述） |
| 2 | 動画タイトル | caption | **必須** | 動画キャプション本文 |
| 3 | 投稿時間 | posted_at | 任意 | 投稿日時 |
| 4 | 動画の長さ | duration | 任意 | 動画尺（表記は「0:34」等の文字列のことがある） |
| 5 | 動画品質スコア | quality_score | 任意 | 取得ツール側の参考スコア。`0`など未算出値があり得るため欠損扱いが必要 |
| 6 | 商品販促動画ですか？ | promo_flag_raw | 任意 | YES/NO。取得ツール側の販促動画フラグ（補助情報） |
| 7 | インフルエンサー名 | creator_name | 任意 | 投稿者表示名 |
| 8 | インフルエンサーID | creator_id | 任意 | 投稿者ID（@handle相当） |
| 9 | フォロワー数 | follower_count | 任意 | |
| 10 | 再生数 | views | 任意 | |
| 11 | いいね数 | likes | 任意 | |
| 12 | シェア数 | shares | 任意 | |
| 13 | コメント数 | comments | 任意 | |
| 14 | 保存数 | saves | 任意 | |
| 15 | エンゲージメント率 | engagement_rate | 任意 | パーセント表記のことが多い |
| 16 | 動画URL | video_url | **必須** | `https://www.tiktok.com/@.../video/<video_id>` または `/photo/<post_id>` 形式。投稿取得・重複判定・証拠リンクの基点 |
| 17 | ハッシュタグ | hashtags_raw | 任意 | 区切り文字はツール依存（スペース/カンマ等）。`#PR`判定にも使用 |
| 18 | 商品名 | product_name | 任意 | 取得ツール側が推定した商品名（参考情報） |
| 19 | 製品ID | product_id | 任意 | |
| 20 | SKU数 | sku_count | 任意 | |
| 21 | 商品カテゴリー | product_category | 任意 | |
| 22 | 商品リンク | product_link | 任意 | TikTok Shop連携時のみ値が入る。通常は `-` |

**必須列は実質2つだけ**（`動画タイトル`＝キャプションと `動画URL`）。それ以外が欠けていてもパイプラインは動くが、欠けるほど指標の精度（関連性判定・エンゲージメント参考値・証拠カードの情報量）は下がる。`validate_input.py` はこの2列の有無だけをハードエラーとし、それ以外の欠損は警告に留める。

`query_group` / `query` / `rank` 列、および単体の `video_id` 列は実データには存在しない。もし将来別ツールの出力にこれらの列がある場合は `COLUMN_ALIASES` がそのまま拾えるようにしてあるが、無くても動作する設計。

## 「順位」の扱い

表示順は地域・閲覧履歴・取得時刻で変動する。**ログイン状態は使わない**（非ログインで取得する）。

## 埋め込みカバー画像

- 動画ダウンロードに失敗した場合の証拠画像フォールバック
- 詳細分析ではダウンロード後の実フレーム（`extract_signals.py` が抽出）を優先し、埋め込みカバーは補助に留める

## 取得ツール由来の参考情報の扱い

`動画品質スコア` と `商品販促動画ですか？` は取得ツール側が独自に算出した値であり、本Skillの判定ロジック（関連性判定・`#PR`判定）を置き換えるものではない。`#PR`判定は常にハッシュタグの完全一致のみを根拠とし（`references/metric-definitions.md` 参照）、`商品販促動画ですか？` は参考として`deck_data`や監査ログに残す程度の扱いとする。`動画品質スコア`が`0`のように明らかに未算出のケースは欠損として扱い、指標計算には使わない。

## ファイルの役割の自動判定（要ユーザー確認）

実データには軸を示す列が無いため、`validate_input.py` は次の情報だけから各ファイルの役割（`self` / `competitor` / `market_keyword`）を推定する。

- ファイル名に含まれるブランド名・キーワードの一致
- サンプリングしたキャプション・ハッシュタグ本文中のブランド名・キーワードの出現頻度

## `confirmed_config.json` の形（営業回答後にAIが書く）

```json
{
  "request": {
    "original_request": "<営業の依頼文をそのまま保存する>",
    "requested_output_text": "<ルーターが保持した営業の依頼原文>",
    "sales_status": "1",
    "status_ids": [1, 5, 3],
    "status_names": ["初訪", "競合差再提案", "構成提案"],
    "combined_deck": true,
    "deck_count": 1,
    "chapter_order": [1, 5, 3],
    "independent_deck": false,
    "requested_deliverables": ["1｜初訪", "5｜競合差再提案", "3｜構成提案"],
    "output_formats": ["pptx", "pdf"],
    "constraints": {
      "item_counts": [],
      "page_counts": [],
      "exclusions": []
    },
    "explicit_request_priority": true
  },
  "brand": "ブランドA",
  "product": "美容液X",
  "official_site_url": "https://example.com/brand-a",
  "official_tiktok_account": "https://www.tiktok.com/@brand_a",
  "official_url": "https://example.com/brand-a",
  "keyword": "ヒアルロン酸",
  "contact_line": "ご返信または担当営業までご連絡ください。",
  "contact_url": "https://example.com/contact",
  "files": [
  ]
}
```

雛形は `assets/example-config.json` を参照し、プレースホルダー値を実データで置き換える。`product`、`official_site_url`、`official_tiktok_account` を推測で確定しない。営業回答または公式情報で照合し、候補と確定値を分ける。`official_url` には既存スクリプト互換のため `official_site_url` と同じ値を入れる。`contact_line` と `contact_url` は任意で、未入力なら資料には「ご返信または担当営業までご連絡ください。」と表示する。

`request.sales_status` は後方互換用として、単一判定または複数指定の先頭IDを保存する。ルーターの `status_ids`、`status_names`、`combined_deck`、`deck_count`、`chapter_order`、`independent_deck` も同名で保存し、任意の組み合わせと統合／分割指定を失わない。`requested_deliverables` に営業が明記した資料・章をそのまま保存し、ステータス標準構成で上書きしない。既存の `simple`、`detailed`、`combined` が指定された場合も、その値を保持する。

## データ収集の手順

`01-acquire` の `search.mjs` を検索軸ごとに実行し、`raw/*.json` を作る。手作業の収集はしない。

```bash
node search.mjs --query "<検索語>" --max all --out raw/<軸名>.json
```

0件のときは `errorCode` を見る（`TIKTOK_CDN_DENIED` は出口IPの問題で、端末設定では解けない）。

