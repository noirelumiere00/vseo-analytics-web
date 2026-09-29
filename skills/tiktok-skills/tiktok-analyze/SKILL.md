---
name: tiktok-analyze
description: TikTok の検索結果と取得済み媒体から、キーワードの登場率・4経路（投稿文/ハッシュタグ/テロップ/音声）・話題構成・上位の勝ちパターンを計測する分析モジュール。「登場率を出して」「4経路で見せて」「上位10本の勝ちパターンを分析して」「話題構成を出して」「上位下位の差分を出して」等で発動。Excel は使わずスクレイパの JSON から直接データセットを組む。機械OCRは使わず、抽出フレームを Claude が読んで取り込む。取得は tiktok-acquire、資料化は tiktok-deck が担当。
---


# ② 分析モジュール

取得済みの媒体から**数字を作る**。資料の見せ方は tiktok-deck が担当。

## 前提（①からの契約）

このモジュールは `<run-dir>` に次が揃っていることを要求する。

| 必要なもの | 無いとどうなるか |
|---|---|
| `media/acquire_log.jsonl` | `extract_signals.py` が `[STOP] 解析できる動画が1本もありません`（**exit 2**）で止まる |
| 媒体の実ファイルが `<run-dir>/media/` 配下にある | `no safe existing video path`。台帳のパスが相対（`run/media/…`）や移動前の絶対パスでも、実ファイルが今の `media/` 配下にあれば自動で解決する。`media/` の外は読まない |
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
`--module analyze` を付けると、生成モジュールの依存（pptxgenjs）も、取得用の
TikTok 到達性・yt-dlp も要求しない（別回線で取った `raw/*.json` と `media/` を持ち込んで分析できる）。
Pillow は必須（写真投稿の読み込みに使う）。

**faster-whisper（音声の文字起こし）は任意。** 入れていない・モデルを読めないときも
`extract_signals.py` は止まらず、動画の音声経路を `unmeasured`（未計測。0件ではない）として記録し、
`coverage_note` に件数が入る。あとで入れて同じコマンドを再実行すると、未計測の投稿だけが再処理される。

**`objc[...] Class AVFFrameReceiver is implemented in both ...` という警告が出ることがある。**
`av` と `opencv-python` が同じ動的ライブラリを別々に同梱しているための重複警告で、
macOS（Homebrew Python）特有。動作に影響しない無害な警告なので無視してよい。

## 手順

入力は `tiktok-acquire` の `search.mjs` が出した JSON だけ。Excel を起点にした旧フロー
（`validate_input.py` / `normalize_dataset.py`）は撤去済みで、このスキルには含まれない。

案件データ（`telop.json`・`rules.json` など）は**必ず `<run-dir>` の中に置く**。
下の手順は `cd scripts` した状態で実行するので、相対パスで書くとスキル本体のフォルダに
書かれ、案件間で上書きされる。

```bash
# 1) データセットを組む（Excel と validate_input を経由しない）
#    再実行しても confirmed_config.json の語彙・依頼情報など、後から足したキーは残る
<PY> build_dataset.py --run-dir <run-dir> --source "self:セブン-イレブン:/path/self.json" --source "competitor:ファミリーマート:/path/comp.json" --source "market_keyword:コンビニ:/path/market.json" --keyword コンビニ --brand セブン-イレブン --official-site https://... --official-tiktok https://www.tiktok.com/@...

# 2) 取得台帳に媒体の指紋を付ける（必ず extract_signals より前）
<PY> stamp_acquire_log.py --run-dir <run-dir>

# 3) フレーム抽出 + ASR
<PY> extract_signals.py --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json
#    → <run-dir>/frames/<video_id>/f_*.jpg が残る（写真投稿は media/<id>_photos/NN.jpg を読む）

# 4) そのフレームを Claude が読み、<run-dir>/telop.json を書いて取り込む
<PY> import_agent_telop.py --run-dir <run-dir> --manifest <run-dir>/telop.json --dry-run
<PY> import_agent_telop.py --run-dir <run-dir> --manifest <run-dir>/telop.json

# 5) 計測
<PY> measure_keywords.py            --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json
<PY> suggest_vocab.py               --run-dir <run-dir>        # 候補を見て <run-dir>/rules.json を書く
<PY> suggest_vocab.py               --run-dir <run-dir> --apply <run-dir>/rules.json
<PY> classify_market_categories.py  --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json
<PY> rank_patterns.py               --run-dir <run-dir> --confirmed-config <run-dir>/confirmed_config.json --top-n 10
<PY> select_evidence_frames.py      --run-dir <run-dir>        # 資料用の証拠画像（任意）
```

`telop.json` の形式は `import_agent_telop.py` の docstring を読む。
`video_url` が signals と食い違う、動画長を超える時刻が入る等は**書き込む前に停止**する。
`extract_hook_frames.py` の `hook_*.jpg` を読んだ分もテロップとして取り込めるが、
被覆率（`telop_coverage_pct`）には数えず `telop_extra_reads` に分けて残る。

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
  拾うと 4経路指標を汚すため、文字起こし自体をせず、音声の分母は動画投稿のみにする。
  除外数は `channels.asr.excluded_not_applicable` に入る（資料向けの注記は不要との判断で
  `coverage_note` には書かない）
- **未計測は対象外と分けて数える。** テロップ未取り込み・音声の文字起こし未完了の投稿は
  その経路の分母から外し、`channels.<経路>.excluded_unmeasured` に件数を出す。`coverage_note` にも
  件数が入り、統合の登場率は `overall.is_lower_bound: true`（未計測分を含まない下限値）になる
- `--allow-unmeasured-telop` を付けた `rank_patterns.py` は、テロップ未計測の投稿の分類を
  0% ではなく判定不可（`present: null`）にする。下位群（`--bottom-n` / `--bottom-ids`）にも同じガードがかかる

## 出力（③への契約）

| ファイル | 内容 |
|---|---|
| `normalized/videos.jsonl` | 1行1投稿。`source_appearances` に軸別の順位 |
| `normalized/dataset_summary.json` | 件数・写真比率・#PR・isAd の内訳 |
| `signals/<video_id>.json` | `frame_files` / `asr_segments` / `telop_measured` / `voice_channel`（measured / unmeasured / not_applicable） |
| `measurement/measure_output.json` | 登場率・4経路・軸別。`coverage_note` に前提。`pr`/`no_pr` は #PR 表記または isAd で分け、内訳は `pr_breakdown` |
| `measurement/market_categories_output.json` | 話題構成。`classification_basis` に根拠範囲 |
| `measurement/rank_patterns_output.json` | 見せ方の割合・上位下位差分・競合比較 |

## やってはいけないこと

| 禁止 | 理由 |
|---|---|
| `#PR` 表記だけを広告の基準にする | TikTok 側の広告フラグも広告として数える（2026-09-03 決定）。片方だけだと、同じ資料に 2.8% と 19.8% が併存する。`measure_keywords.py` の `pr`/`no_pr` もこの定義 |
| どちらも無いものを「広告ではない」と断定する | 表記と配信面の記録が無いだけ。広告実態・景表法適合を確かめたものではない |
| 取得失敗を 0 件として集計 | 「取れなかった」と「0だった」は別 |
| 「すべてのテロップを認識」と書く | 読んでいるのは抽出した場面のみ |
| 再生数との因果を断定 | 「上位群に多い傾向」「勝因仮説」と書く |
| `python3` で直接実行 | 3.13 以上だと `[STOP]`。必ず `<PY>` |

## 手順に増えたもの（2026-09-02）

| いつ | コマンド | 何のため |
|---|---|---|
| build_dataset の直後（**extract_signals より前**） | `stamp_acquire_log.py --run-dir <run-dir>` | 取得台帳に媒体のSHA-256を付ける。これが無いと資料の証拠画像を照合できず、`--dense-top-n-per-source` も「stamp_acquire_log.py が未実行」で止まる。**解析の後に走らせると解析済み判定が崩れて全件やり直しになる**（取り込み済みテロップは引き継がれる） |
| 写真のテロップ取り込み | `import_agent_telop.py` の manifest で `photo_index`（1始まり）を使う | 写真に秒数は無い。`timestamp` を書くと止まる |
| 話題分類・タグ分類の前 | `suggest_vocab.py --run-dir <run-dir>` → 候補を見てラベル付け → `--apply <run-dir>/rules.json` | **案件ごとに語彙が違う**。既定語彙は化粧品案件のサンプルで、他業種に当てると誤分類する（実測: コンビニの「クリームたっぷりダブルシュー」が「化粧品・スキンケア商品」に分類された） |
| 上位下位差分を出すとき | `rank_patterns.py --bottom-ids <id,...>` | 順位の末尾は投稿日が古く写真に偏るので、鮮度を揃えたコホート内の下位を渡す |

**再解析でテロップは消えない。** `extract_signals.py` は取り込み済みの読み取り
（「読んだが文字なし」も含む。読んだ枚数・被覆率も）を既定で引き継ぐ（破棄したいときだけ `--reset-telop`）。
ただし媒体が差し替わった（取得台帳の指紋が変わった）投稿は引き継がず、未計測に戻す。
フラグなしの再実行は、済んでいる投稿を処理し直さない。
再実行で失敗した投稿は、同じ媒体の既存の正常な signals を上書きしない（1本も成功しなければ exit 2）。

## 参照

`references/input-schema.md`（入力仕様）／`metric-definitions.md`（指標定義）／
`visual-review-schema.md`（実画面レビュー基準）／`environment-and-data-policy.md`（環境とデータ方針）／
