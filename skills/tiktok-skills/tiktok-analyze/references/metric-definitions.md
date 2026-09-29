# 指標定義 v2

## 分母

`valid_videos` は、重複統合後に媒体解析（`extract_signals.py`）が完了し、関連性が `relevant` または `uncertain` の動画。取得失敗・未処理動画を0回として分母に入れない。取得失敗数と処理率は別に表示する。

経路別の分母は、その経路が **measured** の動画だけ。テロップ未取り込み・音声の文字起こし未完了（**unmeasured**）は `excluded_unmeasured`、写真投稿の音声や音声トラックの無い動画（**not_applicable**）は `excluded_not_applicable` に数え、どちらも分母に入れない。未計測の経路がある軸では、統合の登場率・平均回数は未計測分を含まない下限値になる（`overall.is_lower_bound`）。

## 4経路の生ヒット

| 経路 | 数え方 |
|---|---|
| caption | caption内のハッシュタグを除いた本文で、表記ゆれを含む非重複出現をすべて数える |
| hashtag | caption内タグとhashtags列を統合し、エクスポート上の同じタグは1回だけ数える |
| ocr | Claude が読んだ抽出コマ（`import_agent_telop.py` で取り込み）で、同じ文言が連続したコマを1区間に統合し、その区間内の非重複出現をすべて数える。文字の無いコマは区切りで、同じ文言の再登場は別の出現。文言が違えば別区間 |
| asr | 音声文字起こし内の非重複出現をすべて数える。単語時刻があればその時刻、なければセグメント時刻を使う |

照合はNFKC、英字小文字化、CJK間のOCR空白除去、カタカナ・ひらがな統合を行う。複数の表記ゆれが重なる場合は左端・最長一致とし、「ヒアルロン酸」と「ヒアルロン酸配合」を重複加算しない。`EasyABC`内の`ABC`のように英数字語へ連結した部分一致は除外する。

## 接点合計と統合登場回数

- `surface_total_mentions` = caption + hashtag + OCR + ASR の生ヒット合計。同じ瞬間に表示・発話されれば2接点。
- `unique_event_total` = caption + hashtag + OCR/ASRの統合イベント。同じ内容が画面と音声に重なれば1回。
- 資料の「1本あたり平均登場回数」は `unique_event_total` を使う。
- 資料には4経路別の率・平均回数と、接点合計/本も併記する。

OCRとASRだけを異なる経路間で一対一に突合する。区間が重なる、または区間間の距離が `merge_window_seconds`（既定1.0秒）以内なら同一イベント候補とし、最短距離から一対一で組み合わせる。同じOCR同士・同じASR同士は近くても統合しない。時刻欠損は自動統合しない。

```text
登場率(%) = 1回以上のunique_eventがある動画数 / valid_videos × 100
1本平均登場回数 = unique_event_totalの合計 / valid_videos
1本平均接点数 = surface_total_mentionsの合計 / valid_videos
経路別登場率 = その経路で1回以上ある動画数 / valid_videos × 100
経路別平均回数 = その経路の生ヒット合計 / valid_videos
```

0回の動画も分母に含む。有効動画0件は0%ではなくN/A。

## #PR

caption・hashtags・取り込み済みテロップから正規化後の完全一致タグ `#PR` が見つかれば `#PR表記あり`（`pr_status_final`。テロップ取り込み時に再判定する）。

`measure_output.json` の `pr` / `no_pr` 群は **`#PR表記あり` または TikTok の広告フラグ（isAd）あり** を `pr` とする（2026-09-03 決定。tiktok-deck と同じ定義）。内訳は `pr_breakdown`（`pr_tag_only` / `platform_ad_flag_only` / `both`）。広告実態、オーガニック投稿、法令適合を判定しない。各群で同じ指標を計算する。

## 監査証跡

`measure_output.json` は動画ごとに次を保存する。

- 4経路の全生ヒット：一致表記、正規化文字列、文字位置、元スパン、時刻、時刻品質、信頼度、`mention_id`
- OCR/ASRの一対一統合イベントと統合距離
- 4経路別回数、接点合計、統合登場回数
- caption・hashtags・OCR・ASR入力のSHA-256
- 設定ファイルのSHA-256と指標バージョン

独立の検証スクリプト（旧 `verify_outputs.py`）は現行パッケージに含まれない。数値を確かめるときは `video_level_audit` の全ヒットと `input_sha256` から再計算して照合し、不一致なら資料を完成扱いにしない。
