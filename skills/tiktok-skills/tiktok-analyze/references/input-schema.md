# 入力データのスキーマとデータ収集手順

このSkillが受け取るのは、`tiktok-acquire` の `search.mjs` が出力した JSON（`raw/*.json`）である。Excel は使わない（取得経路を一本化したため）。

## 営業依頼の受付

依頼文に作成したい資料、章、分析項目、ファイル形式が明記されていれば、その指定を入力要件の正とする。営業ステータスへ置き換えて指定範囲を狭めない。依頼が曖昧な場合だけ `status-router.md` で①初訪、②具体提案、③構成提案、④レポート、⑤競合差再提案を判定し、`status-output-spec.md` の必須入力を使う。

`scripts/route_sales_request.py` の `requested_output_text` に営業の依頼原文、`output_formats` にPDF/PPTX指定、`constraints` に本数・ページ数・除外条件を保存する。定義済みモジュール名へ変換できない明示要件も原文を捨てず、その内容を資料仕様として使う。

依頼文と添付ファイルを先に読み、既に分かる情報を再質問しない。初回返答は `tiktok-intake` の `SKILL.md`（受付の返答形式）に従い、判定または明示指定、作成予定、確認済み情報、不足情報、コピー用回答欄を一度に返す。営業が不足情報と作成指示を返したら、重大な曖昧さがない限り再確認せず実行する。

案件設定では次を分離する。

- `official_site_url`：商品、訴求、ブランド表記を確認する公式サイトURL
- `official_tiktok_account`：公式投稿者を照合するTikTokアカウントURLまたは`@handle`
- `official_url`：既存スクリプト互換用。`official_site_url` と同じ値を保存する

①初訪では、カテゴリ語と「{競合} {カテゴリ}」（任意で「{自社} {カテゴリ}」）の検索結果を `tiktok-acquire` の `search.mjs` で取得する（Excelは不要）。初訪の集計は tiktok-deck の `build_first_visit.py` が行い、このモジュールの計測は使わない（手順は `tiktok-deck/SKILL.md` の「初訪」）。

④レポートでは、施策前と施策後を**同じ検索語・同じ条件**で取得した JSON を必須とする。

## ファイルの単位

`search.mjs` は検索語1つにつき1回実行し、**1ファイル＝1つの検索軸（自社・競合1社・市場キーワードなど）**に対応する。複数ブランドが1ファイルに混在することは想定しない。役割（自社／競合／市場キーワード軸）は `build_dataset.py --source role:label:path` で**ファイル単位に明示**する（自動判定はしない）。

**ファイル名は軸ごとに変える。** 下流は検索軸をファイル名（basename）で識別するため、別フォルダの同名ファイル（`raw/seven/result.json` と `raw/fami/result.json` など）は区別できない。`build_dataset.py` は重複を見つけると `[STOP]` で止まる。

## 入力 JSON の項目（`search.mjs` 検索モード）

形は `{"ok", "query", "videos": [...], "diag": {...}, "order_basis", "errorCode"}`。`tiktok_report.py` の `.json` も同じ形。古い `tiktok_report.py` が保存していた `videos` の配列だけの JSON も受ける（`order_basis` が無いので `unknown` 扱い。取り直すのが望ましい）。`build_dataset.py` が読む項目は次のとおり。

| 項目 | 使い道 | 無いとき |
|---|---|---|
| `videos[].id` | 投稿ID（重複統合・ファイル名の基点） | その投稿を落とし、`dataset_summary.json` の `dropped` に残す |
| `videos[].url` | 動画URL（取得・証拠リンクの基点） | 同上 |
| `videos[].desc` | キャプション（タグ文字列を含む） | 空のまま残す（ハッシュタグのみ・無言投稿も実在の検索結果） |
| `videos[].hashtags[]` | ハッシュタグ・`#PR` 判定 | 空 |
| `videos[].author.{uniqueId,nickname,followerCount,verified,signature,avatarUrl}` | 投稿者情報 | 空（`followerCount` が `null` のときは `follower_count` も `null`＝未取得。0 にしない） |
| `videos[].stats.{playCount,diggCount,collectCount,shareCount,commentCount}` | 再生・反応 | 数値は 0 のまま、`stats_missing: true` で「未取得」と区別する（`stats` 自体が無い、または `missingFields` に `stats.playCount` がある） |
| `videos[].duration` / `mediaType` / `imageCount` | 尺・動画/写真の別・写真枚数 | `mediaType` 無しは動画扱い |
| `videos[].isAd` | TikTok 側の広告フラグ（`is_ad_platform_flag`） | false |
| `videos[].createTime` / `music` / `coverUrl` / `poi` / `textLanguage` | 投稿日時・音源・カバー・位置・言語 | 空 |
| `order_basis` | 並び順の出所。`search_display_order` 以外は順位の章に使えない | `unknown` |
| `diag.captchaDetected` | CAPTCHA を検知した取得結果は使わない | — |
| `errorCode` | `TIKTOK_TRULY_EMPTY`（API応答はあるが該当0件）は**計測した0件**の軸として残す（`confirmed_config.files[].zero_result`）。それ以外の `ok: false`（`TIKTOK_BOT_WALL` / `TIKTOK_CDN_DENIED` / `TIKTOK_EXCEPTION` など）は取得失敗なので止める | — |

広告の扱いは `#PR` 表記と `isAd` の両方を記録し、集計の `pr` 群は「どちらかがある投稿」とする（`references/metric-definitions.md`）。

## 「順位」の扱い

表示順は地域・閲覧履歴・取得時刻で変動する。**ログイン状態は使わない**（非ログインで取得する）。

## カバー画像

- `coverUrl` は動画ダウンロードに失敗した場合の証拠画像フォールバック
- 詳細分析ではダウンロード後の実フレーム（`extract_signals.py` が抽出）を優先し、カバーは補助に留める

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

雛形は上の JSON（`build_dataset.py` が書く形に、後工程のキーを足したもの）を参照し、プレースホルダー値を実データで置き換える。`build_dataset.py` を再実行しても、`request`・`contact_line`・語彙（`market_category_rules` 等）など同スクリプトが持たないキーは残る。公式TikTokアカウントが無いと営業に確認できた場合は `--official-tiktok-absent`（`official_tiktok_absent: true`）で「未確認」と区別して記録する。`product`、`official_site_url`、`official_tiktok_account` を推測で確定しない。営業回答または公式情報で照合し、候補と確定値を分ける。`official_url` には既存スクリプト互換のため `official_site_url` と同じ値を入れる。`contact_line` と `contact_url` は任意で、未入力なら資料には「ご返信または担当営業までご連絡ください。」と表示する。

`request.sales_status` は後方互換用として、単一判定または複数指定の先頭IDを保存する。ルーターの `status_ids`、`status_names`、`combined_deck`、`deck_count`、`chapter_order`、`independent_deck` も同名で保存し、任意の組み合わせと統合／分割指定を失わない。`requested_deliverables` に営業が明記した資料・章をそのまま保存し、ステータス標準構成で上書きしない。既存の `simple`、`detailed`、`combined` が指定された場合も、その値を保持する。

## データ収集の手順

`tiktok-acquire` の `search.mjs` を検索軸ごとに実行し、`raw/*.json` を作る（ファイル名は軸ごとに変える）。手作業の収集はしない。

```bash
node search.mjs --query "<検索語>" --max all --out raw/<軸名>.json
```

0件のときは `errorCode` を見る（`TIKTOK_CDN_DENIED` は出口IPの問題で、端末設定では解けない）。

