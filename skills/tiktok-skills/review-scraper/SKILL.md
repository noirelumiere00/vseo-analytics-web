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

# ① まず候補を見る（取得はしない）
python3 collect.py --keyword "メラノCC 美容液" --list

# ② キーワードで各サイト上位3商品 × 最大200件
python3 collect.py --keyword "メラノCC 美容液" --out ~/Documents/projects/<案件>/reviews

# ③ 商品URLを直接渡す（サイトは自動判定・複数可）
python3 collect.py --out <出力先> \
  --url https://www.cosme.net/products/10086817/ \
  --url https://review.rakuten.co.jp/item/1/397949_10000850/1.1/ \
  --url https://store.shopping.yahoo.co.jp/sundrugec/4987241168583.html
```

| オプション | 既定 | 意味 |
|---|---|---|
| `--keyword` | — | 商品を探す語。ブランド名＋種類（「メラノCC 美容液」）が一番当たる |
| `--url` | — | 商品ページか口コミページのURL。繰り返し指定できる |
| `--site` | 全部 | キーワード検索するサイト（`cosme,rakuten,yahoo`） |
| `--products` | 3 | キーワード検索でサイトごとに何商品取るか |
| `--max` | 200 | 1商品あたりの最大件数 |
| `--no-full-text` | オフ | @cosme の全文取得を省く（速いが本文が途中で切れる） |
| `--delay` | 1.5 | 同じサイトへのアクセス間隔（秒）。**短くしない** |

**進め方の決まり**: キーワードで取るときは、先に `--list` で候補をユーザーに見せ、
取る商品を確認してから `--url` で取る。キーワード検索は別商品（セット品・類似品）が
混ざることがある。

## 出力（`--out` の下）

| ファイル | 中身 |
|---|---|
| `reviews.csv` | 全口コミ。UTF-8（BOM付き）なので Windows の Excel でも化けない |
| `reviews.jsonl` | 同じ内容を1行1件で |
| `summary.md` | 商品ごとの 取得件数／サイト表示件数・平均評価・期間、年代・肌質などの内訳 |
| `acquire_log.json` | 何を取りに行き、何件取れ、何で失敗したか |

### 列（全サイト共通）

`site, product_id, product_name, product_url, review_id, review_url, rating,
rating_scale, rating_5, title, body, body_truncated, posted_at, age, age_band,
gender, skin_type, purchase, attributes, helpful_count, fetched_at`

- **@cosme の評価は7段階**。サイトをまたいで比べるときは `rating_5`（5段階換算）を使う
- `age` はサイトの表記のまま（@cosme は「27」歳、楽天・Yahoo!は「20代」）。比べるときは `age_band`
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

| 表示 | 何が起きたか | どうするか |
|---|---|---|
| `口コミが1件も取れませんでした` | 全商品で0件 | `acquire_log.json` の `error` を見る |
| `構造変化で読めず` | ページは取れたが口コミを読めない。**サイトの作りが変わった** | `scripts/sites/<サイト>.py` の読み方を直す（`tests/fixtures/` を取り直してテスト） |
| `アクセス拒否` | robots.txt で禁止、または HTTP 403 | そのサイトは取らない |

**0件を成功扱いにしない。** サイト上に口コミがあるのに1件も読めなければ、
必ず「構造変化」として止める（サイトの改修に気づかず空のデータで分析しないため）。

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
  fixtures/         各サイトの実ページの保存
```

- サイトを足すときは `sites/<名前>.py` に `NAME / LABEL / RATING_SCALE / match_url /
  search / collect` を書き、`sites/__init__.py` の `SITES` に足す
- 読み方は**ネットワークを使わない関数**（`parse_*`）に分け、保存ページでテストする
- 楽天のクラス名（`header--1B1vT` 等）は変わりやすいので読まない。JSON を読む
