---
name: tiktok-analyze
description: TikTok の検索結果と取得済み媒体から、キーワードの登場率・4経路（投稿文/ハッシュタグ/テロップ/音声）・話題構成・上位の勝ちパターンを計測する分析モジュール。「登場率を出して」「4経路で見せて」「上位10本の勝ちパターンを分析して」「話題構成を出して」「上位下位の差分を出して」等で発動。Excel は使わずスクレイパの JSON から直接データセットを組む。機械OCRは使わず、抽出フレームを Claude が読んで取り込む。取得は 01-acquire、資料化は 03-deck が担当。
---


> **フォルダ名について。** 配られた状態では `00-intake` `01-acquire` `02-analyze` `03-deck`、
> `install.py` で入れたあとは `tiktok-intake` `tiktok-acquire` `tiktok-analyze` `tiktok-deck` になります。
> この文書のパスは**入れたあとの名前**で書いています。配られたフォルダの中で直接動かすときは、
> 番号付きの名前に読み替えてください。
# ② 分析モジュール

取得済みの媒体から**数字を作る**。資料の見せ方は 03-deck が担当。

## 前提（①からの契約）

このモジュールは `<run-dir>` に次が揃っていることを要求する。

| 必要なもの | 無いとどうなるか |
|---|---|
| `media/acquire_log.jsonl` | **`target=0 / exit=0`** で「対象なし」として静かに通過する |
| 媒体が `media/` 配下の**絶対パス** | `no safe existing video path` |
| 写真が `<id>_photos/NN.jpg` | 写真が1枚も認識されない |

①では `node search.mjs --mode fetch --run-dir <run-dir>` を使うこと。
`--outdir` を手で指定すると置き場所を間違えて全滅する。

## セットアップ

以降 `<PY>` は分析用の Python に読み替える。変数にしないのは、`VAR=値` が
Windows のどちらのシェルでも構文エラーになるため。

| | venv を作る | `<PY>` に入れるもの |
|---|---|---|
| macOS / Linux | `python3 -m venv ../../.venv` | `../../.venv/bin/python` |
| Windows | `py -3.12 -m venv ..\..\.venv` | `..\..\.venv\Scripts\python.exe` |

```
cd scripts
# 上の表の「venv を作る」を1回だけ実行（Python は 3.10〜3.12）
<PY> -m pip install -r requirements.txt
<PY> check_dependencies.py --module analyze
```

**Python は 3.10〜3.12。** 3.13 以上だと `check_dependencies.py` が止める。
リポジトリ直下に venv を1つだけ作り、4モジュールで共有する。

**機械OCR（Tesseract）は不要。** OS ごとに導入手順が違い、日本語データの入れ忘れが
最大の詰まりどころだったため撤去した。テロップは抽出フレームを Claude が読む。
`--module analyze` を付けると、生成モジュールの依存（pptxgenjs）を要求しない。

**`objc[...] Class AVFFrameReceiver is implemented in both ...` という警告が出ることがある。**
`av` と `opencv-python` が同じ動的ライブラリを別々に同梱しているための重複警告で、
macOS（Homebrew Python）特有。動作に影響しない無害な警告なので無視してよい。

## 手順

Excel を起点にした旧フロー（`validate_input.py` / `normalize_dataset.py`）は
`scripts/legacy/` に退避済み。現行フローはどこからも呼ばない
（詳細は `references/input-schema.md` 冒頭）。

```bash
# 1) データセットを組む（Excel と validate_input を経由しない）
<PY> build_dataset.py --run-dir <run-dir> --source "self:セブン-イレブン:/path/self.json" --source "competitor:ファミリーマート:/path/comp.json" --source "market_keyword:コンビニ:/path/market.json" --keyword コンビニ --brand セブン-イレブン --official-site https://... --official-tiktok https://www.tiktok.com/@...

# 2) フレーム抽出 + ASR
<PY> extract_signals.py --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json
#    → <run-dir>/frames/<video_id>/f_*.jpg が残る

# 3) そのフレームを Claude が読み、telop.json を書いて取り込む
<PY> import_agent_telop.py --run-dir <run-dir> --manifest telop.json --dry-run
<PY> import_agent_telop.py --run-dir <run-dir> --manifest telop.json

# 4) 計測
<PY> measure_keywords.py            --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json
<PY> classify_market_categories.py  --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json
<PY> rank_patterns.py               --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json --top-n 10
```

`telop.json` の形式は `import_agent_telop.py` の docstring を読む。
`video_url` が signals と食い違う、動画長を超える時刻が入る等は**書き込む前に停止**する。

## 3つの状態を混ぜない（このモジュールの中核）

| 状態 | 意味 | 集計での扱い |
|---|---|---|
| `measured` | 計測した | 分子・分母に入れる |
| `unmeasured` | 計測すべきだが未実施 | **分母に入れない**（0にしない） |
| `not_applicable` | 構造的に存在しない | **分母から外す** |

- **telop 未取り込みのまま計測しようとすると `measure_keywords.py` と `rank_patterns.py` は
  `exit 2` で停止する。** テロップ抜きで進めてよい場合だけ `--allow-unmeasured-telop` を付け、
  資料に「未計測（0件ではない）」と明記する
- **写真投稿の音声は `not_applicable`。** BGM のみで発話が無く、歌詞をキーワード一致として
  拾うと 4経路指標を汚すため、音声の分母は動画投稿のみにする
- `coverage_note` に「音声は写真投稿 N 件を対象外とし、動画 M 件を分母にしています」が自動で入る

## 出力（③への契約）

| ファイル | 内容 |
|---|---|
| `normalized/videos.jsonl` | 1行1投稿。`source_appearances` に軸別の順位 |
| `normalized/dataset_summary.json` | 件数・写真比率・#PR・isAd の内訳 |
| `signals/<video_id>.json` | `frame_files` / `asr_segments` / `telop_measured` / `voice_status` |
| `measurement/measure_output.json` | 登場率・4経路・軸別。`coverage_note` に前提 |
| `measurement/market_categories_output.json` | 話題構成。`classification_basis` に根拠範囲 |
| `measurement/rank_patterns_output.json` | 見せ方の割合・上位下位差分・競合比較 |

## やってはいけないこと

| 禁止 | 理由 |
|---|---|
| `#PR` 表記だけを広告の基準にする | TikTok 側の広告フラグも広告として数える（2026-09-03 決定）。片方だけだと、同じ資料に 2.8% と 19.8% が併存する |
| どちらも無いものを「広告ではない」と断定する | 表記と配信面の記録が無いだけ。広告実態・景表法適合を確かめたものではない |
| 取得失敗を 0 件として集計 | 「取れなかった」と「0だった」は別 |
| 「すべてのテロップを認識」と書く | 読んでいるのは抽出した場面のみ |
| 再生数との因果を断定 | 「上位群に多い傾向」「勝因仮説」と書く |
| `python3` で直接実行 | 3.13 以上だと `[STOP]`。必ず `<PY>` |

## 手順に増えたもの（2026-09-02）

| いつ | コマンド | 何のため |
|---|---|---|
| build_dataset の直後（**extract_signals より前**） | `stamp_acquire_log.py --run-dir <run-dir>` | 取得台帳に媒体のSHA-256を付ける。これが無いと資料の証拠画像を照合できない。**解析の後に走らせると解析済み判定が崩れて全件やり直しになる** |
| 写真のテロップ取り込み | `import_agent_telop.py` の manifest で `photo_index`（1始まり）を使う | 写真に秒数は無い。`timestamp` を書くと止まる |
| 話題分類・タグ分類の前 | `suggest_vocab.py --run-dir <run-dir>` → 候補を見てラベル付け → `--apply rules.json` | **案件ごとに語彙が違う**。既定語彙は化粧品案件のサンプルで、他業種に当てると誤分類する（実測: コンビニの「クリームたっぷりダブルシュー」が「化粧品・スキンケア商品」に分類された） |
| 上位下位差分を出すとき | `rank_patterns.py --bottom-ids <id,...>` | 順位の末尾は投稿日が古く写真に偏るので、鮮度を揃えたコホート内の下位を渡す |

**再解析でテロップは消えない。** `extract_signals.py` は取り込み済みの読み取りを既定で
引き継ぐ（破棄したいときだけ `--reset-telop`）。

## 参照

`references/input-schema.md`（入力仕様）／`metric-definitions.md`（指標定義）／
`visual-review-schema.md`（実画面レビュー基準）／`environment-and-data-policy.md`（環境とデータ方針）／
