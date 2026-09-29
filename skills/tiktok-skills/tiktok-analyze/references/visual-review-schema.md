# 実画面AIレビュー

詳細版では、各検索軸の行順上位10本を4fpsで詳細解析し、`visual_review/dense_4fps/manifest.json`、時刻入りコンタクトシート、候補キーフレーム、写真投稿の実写真、元投稿をCodexの画像理解で確認して `visual_review.json` を作る。`select_evidence_frames.py` が作った `evidence_manifest.json` は資料掲載用の絞り込みであり、レビュー対象全体の代わりにはしない。文字・音声だけで判定した結果を「キラー演出」と断定しない。

## 機械計測とAgentレビューの役割

| 処理 | 正とする内容 | やってはいけないこと |
|---|---|---|
| 4fps OCR | 0.25秒間隔で抽出した全フレームの画面文字、時刻、連続表示の統合 | 「動画の全瞬間を完全認識」と表現する |
| 全音声ASR | 動画全体の音声文字、単語／区間時刻 | 聞き取れない箇所を推測で補う |
| Agent実画面レビュー | 画面推移、冒頭、証拠、見せる順番、商品接続、CTA、資料用キーフレーム | OCR／ASRの回数を目視印象で上書きする |
| 元投稿確認 | コンタクトシートで判断できない動き・文脈、リンク先の同一性 | 未検証URLを直接リンクとして補完する |

4fps対象は軸ごとの上位10本の和集合。同一投稿が複数軸にある場合は1回レビューし、各軸の順位と使い分けをmanifestで保持する。写真投稿は4fps化せず、取得できた実写真を表示順にすべて確認する。

## 判定手順

1. `signals/dense_selection_manifest.json` で軸別上位10本と解析完了状態を確認する。未取得・解析未完了は0回または「特徴なし」にしない。
2. 動画は全コンタクトシートを時系列に見て、必要に応じて元投稿または候補キーフレームを開く。写真投稿は実写真を表示順に確認する。
3. A〜Fを `true` / `false` / `null（判定不能）` で判定する。
4. `tags` は画面で確認できたものだけを書く。
5. 動画は `evidence_timestamp_sec`、写真投稿は `evidence_photo_index` と、何が見えたかを `reason` に短く残す。
6. 一部フレームだけでは確認できない場合は `null` とし、推測で埋めない。
7. 資料用には各投稿最大3枚へ絞るが、レビュー記録には確認したコンタクトシートと解析範囲を残す。

## JSON形式

```json
{
  "review_version": "1.0",
  "review_sources": {
    "dense_manifest": "visual_review/dense_4fps/manifest.json",
    "sampling_fps": 4,
    "reviewed_contact_sheets": true
  },
  "videos": {
    "7360000000000000000": {
      "review_note": "3枚の実投稿画像と元投稿を確認",
      "A_opening_hook": {
        "present": true,
        "tags": ["悩みのアップ", "結論テロップ"],
        "evidence_timestamp_sec": 0.5,
        "reason": "冒頭で肌悩みを大きく見せ、結論を同時表示"
      },
      "B_proof": {
        "present": true,
        "tags": ["使用前後", "質感の接写"],
        "evidence_timestamp_sec": 6.2,
        "reason": "左右比較で使用前後を提示"
      },
      "C_structure": {"present": true, "tags": ["3ステップ"], "evidence_timestamp_sec": 3.1, "reason": "工程を番号表示"},
      "D_keyword_placement": {"present": null, "tags": [], "evidence_timestamp_sec": null, "reason": "回数は計測スクリプトを使用"},
      "E_product_connection": {"present": true, "tags": ["商品接写"], "evidence_timestamp_sec": 2.4, "reason": "序盤で商品を正面表示"},
      "F_cta": {"present": false, "tags": [], "evidence_timestamp_sec": 14.2, "reason": "確認範囲に行動喚起なし"}
    }
  }
}
```

写真投稿では各カテゴリの根拠を次のように記録する。

```json
{
  "A_opening_hook": {
    "present": true,
    "tags": ["結論テロップ"],
    "evidence_timestamp_sec": null,
    "evidence_photo_index": 1,
    "reason": "1枚目に結論を大きく表示"
  }
}
```

`D_keyword_placement` の回数は `measure_keywords.py` を正とする。早期提示は動画／音声で実時刻がある場合だけ扱い、写真番号を時刻へ変換しない。画面レビューで回数を上書きしない。`rank_patterns.py --visual-review visual_review.json` はレビュー済み項目だけを上書きし、元の文字・音声ルール判定も `text_audio_signal` に保存する。

## 証拠画像とリンク

- 動画は9:16、写真は元比率のまま `contain` で表示し、円形・楕円形・角丸マスク、中央トリミング、正方形化、引き伸ばしをしない。
- コンタクトシート内の各フレームも元比率を保ち、時刻ラベルを画像に重ねず余白へ置く。
- 投稿の直接URLは、元データにあるか、アカウント＋タイトル／caption＋サムネイル／指標等の複数信号で同一投稿を検証できた場合だけ使う。
- 直接URLを検証できず1:1サムネイルだけの場合は、9:16のニュートラル枠に `contain` し「提供サムネ」と明記する。リンクはプロフィールURLまでにする。
