---
name: review-scraper
description: 美容・ECサイトの口コミ（レビュー）を集めて、CSV（Excelでそのまま開ける）・JSONL・集計サマリーにまとめる。対応は @cosme・楽天市場・Yahoo!ショッピング。商品URLを渡すか、キーワードで各サイトの商品を探して上位商品の口コミを取る。「口コミを集めて」「レビューを取得して」「@cosmeの口コミ」「楽天のレビュー」「Yahoo!ショッピングの口コミ」「EC口コミ」「美容の口コミ調査」「商品の評判を集めて」「競合商品の口コミ比較」等で発動。標準ライブラリだけで動くので pip 不要・どのOS（macOS/Windows/Linux）でも動く。Amazon・LIPS・Qoo10 は自動アクセスを拒否しているため対象外。
---

# 口コミ取得（review-scraper）

美容・ECの口コミを **@cosme／楽天市場／Yahoo!ショッピング** から集め、
全サイト共通の列に揃えて出力する。取った口コミの分析や資料化は別工程。

## 使い方

Python 3.9 以上があれば動く（**追加インストール不要**）。
Windows では `python3` を `python` に読み替える。

```bash
cd <このSkillのディレクトリ>/scripts

# ① まず候補を見る（取得はしない）→ ユーザーに見せて、取る商品を決めてもらう
python3 collect.py --keyword "メラノCC 美容液" --list

# ② 決まった商品のURLを渡して取る（サイトは自動判定・複数可）
python3 collect.py --out ~/Documents/projects/<案件>/reviews \
  --url https://www.cosme.net/products/10086817/ \
  --url https://review.rakuten.co.jp/item/1/397949_10000850/1.1/ \
  --url https://store.shopping.yahoo.co.jp/sundrugec/4987241168583.html
```

`--keyword` に `--out` を付けると、①の候補の上位（サイトごと `--products` 件）をそのまま取る。
候補に別商品が混ざっていても確認なしで取り込むので、**ユーザーが「上位をそのまま取ってよい」と
言ったときだけ**使う。

| オプション | 既定 | 意味 |
|---|---|---|
| `--keyword` | — | 商品を探す語。ブランド名＋種類（「メラノCC 美容液」）が一番当たる |
| `--url` | — | 商品か口コミのURL。繰り返し指定できる。渡せる形は下の「渡せるURL」 |
| `--site` | 全部 | キーワード検索するサイト（`cosme,rakuten,yahoo`） |
| `--products` | 3 | キーワード検索でサイトごとに何商品取るか |
| `--max` | 200 | 1商品あたりの最大件数 |
| `--no-full-text` | オフ | @cosme の全文取得を省く（速いが本文が途中で切れる） |
| `--delay` | 1.5 | 同じサイトへのアクセス間隔（秒）。**短くしない** |

**進め方の決まり**: キーワードで取るときは、先に `--list` で候補をユーザーに見せ、
取る商品を確認してから `--url` で取る。キーワード検索は別商品（セット品・類似品）が
混ざることがある（@cosme はキーワードに合う商品が無いと、ブランドの別商品を候補に出す）。

### 渡せるURL

| サイト | 形 | 例 |
|---|---|---|
| @cosme | 商品ページ `/products/<数字>/`（その下の `/review/` も可） | `https://www.cosme.net/products/10086817/` |
| 楽天市場 | 口コミページ、または商品ページ（口コミページを探して使う） | `https://review.rakuten.co.jp/item/1/397949_10000850/1.1/`、`https://item.rakuten.co.jp/<店舗>/<商品>/` |
| Yahoo!ショッピング | 店舗の商品ページ、または口コミ一覧 | `https://store.shopping.yahoo.co.jp/<店舗>/<商品>.html`、`https://shopping.yahoo.co.jp/review/item/list?store_id=…&page_key=…` |

@cosme の口コミ個別ページ（`/reviews/<数字>/`）と Yahoo!のカタログ商品ページ
（`shopping.yahoo.co.jp/products/…`）は受け付けない。商品ページのURLに直して渡す。
同じ商品を2回渡しても（例: 楽天の商品URLと口コミURL）1回だけ取る。

## 出力（`--out` の下）

| ファイル | 中身 |
|---|---|
| `reviews.csv` | 全口コミ。UTF-8（BOM付き）なので Windows の Excel でも化けない。`= + - @` で始まるセルは先頭に `'` を付けてある（Excel に数式として実行させないため） |
| `reviews.jsonl` | 同じ内容を1行1件で（`'` を付けない元の文字列） |
| `summary.md` | 商品ごとの 取得件数／サイト表示件数・平均評価（元の段階 と 5段階換算）・期間・状態、商品ごとの評価・年代・性別・肌質・購入区分の内訳 |
| `acquire_log.json` | `searches`（キーワード検索の結果と失敗理由）、`products`（何を取りに行き、何件取れ、何で失敗したか＝`status`・`error`） |

### 列（全サイト共通）

`site, product_id, product_name, product_url, review_id, review_url, rating,
rating_scale, rating_5, title, body, body_truncated, posted_at, age, age_band,
gender, skin_type, purchase, attributes, helpful_count, fetched_at`

- **@cosme の評価は7段階**。サイトをまたいで比べるときは `rating_5`（5段階換算）を使う。
  換算は 1〜満点 を 1〜5 に線形で写す（`1 + (rating − 1) × 4 ÷ (満点 − 1)`。@cosme 1→1.0、4→3.0、7→5.0）。
  満点の範囲外（@cosme の 0 等）は `rating` に元の値を残し、`rating_5` は空欄（平均に入れない）
- 資料に評価点を載せるときは、換算値ではなく `summary.md` の「平均（元の段階）」（例 `5.2 / 7`）を満点つきで載せる
- `age` はサイトの表記のまま（@cosme は「27」歳、楽天・Yahoo!は「20代」）。比べるときは `age_band`。
  楽天・Yahoo!の最上位の区分（「◯代以上」）はサイトの表記のままなので、上の年代はまとめて読む
- `review_url`: @cosme は口コミ1件ごとのURL、楽天はその口コミが載っていた一覧ページ（取得時点のページ。口コミが増えたり並び順が変わったりするとずれる）、
  Yahoo!は口コミ一覧のURL（1件ごとのURLは無い）
- サイトに無い項目は**空欄**（0 や "" で埋めない）。年代が空＝登録していない人で、0件ではない
- `attributes` はサイト固有の項目（@cosme: 購入場所・効果、楽天: 用途・注文日、
  Yahoo!: つけ心地などの評価軸・購入店舗）。CSVではJSON文字列

## サイトごとの取れ方

| サイト | 取れる件数 | 取れる属性 | 注意 |
|---|---|---|---|
| @cosme | 上限なし（`--max` まで） | 年齢・肌質・購入品/サンプル・購入場所・効果 | 一覧は本文が途中まで。切れた分は1件ずつ個別ページを取るので **100件で約3分** |
| 楽天市場 | 上限なし（`--max` まで） | 年代・性別・参考になった数・用途・注文日 | 口コミは**店舗×商品単位**（同じ商品でも店舗ごとに別） |
| Yahoo!ショッピング | **1商品あたり先頭20件程度まで** | 年代・参考になった数・評価軸 | 21件目以降はページ内部のAPIで読み込まれるため取らない。同じ商品（JAN）の全店舗分が対象 |

取得件数とサイト表示件数は `summary.md` に並べて出る。**差があれば、全件ではない**。

### 対象外のサイト

| サイト | 理由 |
|---|---|
| Amazon | 口コミ一覧の閲覧にログインが必要 |
| LIPS | 自動アクセスを拒否（実ブラウザでも CloudFront 403） |
| Qoo10 | 自動アクセスを拒否（HTTP 523） |

**拒否を回避する実装はしない**（利用規約違反・アクセス遮断のリスクがある）。
必要な場合は、ユーザー自身がブラウザで見て手作業で集める。

## 止まるとき（exit 2）

取れた分は出力したうえで止まる。原因は `acquire_log.json` の `products[].status`・`error`
（キーワード検索の失敗は `searches[].status`・`error`）に残る。

| 表示（`status`） | 何が起きたか | どうするか |
|---|---|---|
| `口コミが1件も取れませんでした` | 全商品で0件 | `acquire_log.json` の `products[].error`・`searches[].error` を見る |
| `構造変化で読めず` | ページは取れたが口コミを読めない。**サイトの作りが変わった** | `scripts/sites/<サイト>.py` の読み方を直す（下の「仕組み」のテストで確かめる） |
| `アクセス拒否` | robots.txt で禁止、または HTTP 403 | そのサイトは取らない |
| `途中で失敗（取れた分のみ）` | 2ページ目以降で拒否・通信エラー・読めないページ。**全件ではない** | 時間をおいて取り直す。そのまま使うなら「一部のみ」と明記する |
| `取得失敗` | 404（URL違い）・通信エラー等 | URL を確かめる |

**0件を成功扱いにしない。** サイト上に口コミがあるのに1件も読めなければ、
必ず「構造変化」として止める（サイトの改修に気づかず空のデータで分析しないため）。
件数表示が読めないときも同じ扱いにする。0件として受け入れるのは、サイトの表示が「0件」のときだけ。

## tiktok-deck の口コミ章（`# REVIEWS`）に使うとき

変換スクリプトは無い。`INPUT.md` の `# REVIEWS` は Claude が出力を読んで書く。
出力から機械的に埋められるのは件数と評価だけで、好意・離脱の理由や打ち手は口コミを読んで書く。
出力にブランドの列は無いので、商品（`product_id`）をブランドごとにまとめて1つの `### BRAND` にする。

| `# REVIEWS` の項目 | 何から書くか |
|---|---|
| `## SURVEY` の `media_a_label`・`media_b_label`・`media_c_label` | 実際に取ったサイト名にする。既定は @cosme / LIPS だが **LIPS はこの Skill では取れない**ので、楽天・Yahoo!を使うなら必ず書き換える |
| `scale_note` | 必ず書く。サイトごとの満点（@cosme 7点・楽天/Yahoo! 5点）と、Yahoo!は先頭20件程度までであること |
| `cosme_rating`・`lips_rating`（媒体A・Bの評価） | `summary.md` の「平均（元の段階）」の数字。**5段階換算の値は入れない**（資料側は各媒体の満点のまま読む） |
| `cosme_count`・`lips_count`（媒体A・Bの件数） | `summary.md` の「サイト表示」の件数 |
| `reviews_read` | そのブランドで実際に読んだ口コミの数（`reviews.csv` の行数） |
| `lips_pr_ratio`（媒体C列） | 楽天・Yahoo!には PR/サンプルの区別が無い。@cosme の `purchase` の内訳から比率を出すなら、`media_c_label` をその内容に書き換える。出せなければ空欄のまま（推測で埋めない） |
| `#### Love`・`#### Churn`（理由｜言及数） | `reviews.csv` の本文を読んで理由を分け、言及数を数える（自動では出ない） |
| `#### Quotes`（原文｜出典） | 本文をそのまま引用し、出典は `review_url`（楽天は掲載ページ、Yahoo!は一覧のURL） |
| `## CROSS`・`## ACTIONS` | 読んだうえで書く |

3サイト目（例: 楽天とYahoo!の両方）の評価と件数を入れる列は資料側に無い。入れきれない分は `scale_note` に書く。
`状態` が OK 以外の商品（途中で失敗・0件など）を使うときは、そのことを `scale_note` に書く。

## 礼儀（外さない）

- 取る前に各サイトの robots.txt を確認し、禁止されたパスには行かない
- 同じサイトへは **1.5秒以上** 間隔を空ける（`--delay` を短くしない）
- ログインしない。公開ページだけを読む
- 取った口コミは分析目的で使う。投稿者名は出力に含めていない

## 仕組み（直すときに読む）

```
scripts/
  collect.py        入口。検索→取得→出力。失敗は acquire_log.json に残す
  common.py         取得（間隔・robots・リトライ・文字コード判定）と共通の列
  sites/cosme.py    @cosme   HTML を読む（一覧→切れた分だけ個別ページ）
  sites/rakuten.py  楽天     ページ内の window.__INITIAL_STATE__（JSON）を読む
  sites/yahoo.py    Yahoo!   ページ内の __NEXT_DATA__（JSON）を読む
tests/
  test_scrapers.py  ネットワークを使わないテスト（python3 tests/test_scrapers.py）
```

- サイトを足すときは `sites/<名前>.py` に `NAME / LABEL / RATING_SCALE / match_url /
  search / collect` を書き、`sites/__init__.py` の `SITES` に足す
- 読み方は**ネットワークを使わない関数**（`parse_*`）に分けてある。テストのページは各サイトの
  作りを写した**合成ページ**（実ページは同梱していない）。「構造変化で読めず」で直すときは、
  ブラウザで該当ページを保存し、`parse_*` に読ませて新しい作りを確かめ、テストの合成ページも
  新しい作りに合わせて直してから `python3 tests/test_scrapers.py` を通す
- 楽天のクラス名（`header--1B1vT` 等）は変わりやすいので読まない。JSON を読む
