---
name: tiktok-deck
description: TikTok検索面の取得データから、営業ステータス別の提案資料（PPTX）を作る。初訪（約8枚・画像＋ワンフレーズのストーリー型。カテゴリで伸びている型と競合の発信の2軸）／具体提案／構成提案／競合差再提案（レポート＝施策前後比較は未実装で、指定するとエラーで止まる）。初訪は投稿を固定語彙から選んで分類（選択式）し、関連を確認した投稿だけを例に使う。二次提案以降は組み合わせて出力できる。動画をダウンロードしてコマ単位で構成を解剖し、そのコマをAIが実際に見て所見を書く。提出前に版面の崩れ・画像とキャプションのズレ・資料内の数値矛盾を機械で検査する。「TikTokの提案資料を作って」「初訪資料にして」「競合差の再提案を出して」等で発動。取得は tiktok-acquire、計測は tiktok-analyze が担当する。
---


> **フォルダの置き場所。** 配布ZIPの `tiktok-skills/` 直下に `tiktok-intake` `tiktok-acquire` `tiktok-analyze`
> `tiktok-deck` `review-scraper` があり、`install.sh`（Windows は `install.ps1`）で `~/.claude/skills/` に入る。
> この文書のパスはそのフォルダ名で書いている。

# tiktok-deck — TikTok提案資料の生成

実案件2件（93枚・43枚）を実際に作った一式。
どちらも同じ `src/` から出ており、案件固有の事実はコードに入っていない。

---

## 絶対にやらないこと

- **TikTokにログインしない。** 取得（tiktok-acquire）はログイン不要で動く。
  ログイン済みプロファイルを使うとアカウント単位でブロックされる
- **CAPTCHA を突破しない。** 出たら止めて人に報告する
- **UA偽装・IPローテーションでブロックを回避しない**
- **見ていないコマを「見た」と書かない**（後述のAI目視の節）

---

## 初訪（初回訪問）— 2026-09 に作り直した

初訪だけは下の「工程」とは別の作り方をする。上長レビューで「文字が多い」「前提やフォロワー帯は要らない」
「無関係な投稿が例に載っている」「ストーリーが無い」「作る人によって質がぶれる」と差し戻されたため。

**狙う感情**：「この人たちは競合も市場もちゃんと見てきている。話を聞きたい」→ 二次提案の約束を取る。
**軸は2本だけ**：①カテゴリで伸びている投稿の型（お土産） ②競合（の商品）のコミュニケーション。
自社ブランドの説明はしない（相手が一番よく知っている）。紙面で「自社」と書かない（社名の短縮か「貴社」）。

| 頁 | 中身（1枚＝実画像＋ワンフレーズ） |
|---|---|
| P1 表紙 | 「{カテゴリ}」のTikTok 伸びている投稿と、競合の打ち手 |
| P2 いま、検索するとこう見える | 検索窓＋表示順の上位8本のカバー。見出しは「上位は◯◯の『◯◯』投稿が多い」 |
| P3 競合はこう発信している | 競合ごとにサムネ2枚＋切り口・訴求のチップ |
| P4 競合がお金をかけて広げている訴求 | PR・公式の投稿。条件を満たさなければ P3 の1行に吸収（本編7枚） |
| P5 {貴社}に足りていない発信 | 左＝競合の実例、右＝貴社の枠（無ければ点線「まだ無し」） |
| P6 いま伸びている型（お土産） | 再生中央値が全体の1.5倍以上の型。無ければ「まだ勝ち型が決まっていない」 |
| P7 まずこの3本 | 注力商品×型の企画の種＋参考投稿（提案＝仮説と明示） |
| P8 次回 | 次回お持ちするもの／教えていただきたいこと／「台本→撮影→投稿→計測までお任せ」 |
| 付録1・2 | 調査の前提／数字の一覧（フォロワー帯・切り口の分布はここだけ）。付録はちょうど2枚 |

手法・定義・注記は本編に書かない（本編の注記はフッターの取得日だけ）。見出しは1文・30字以内、
補足は40字以内（`tools/vocab/_limits.json`）。上限を超える見出し案は使わず次の案に落ち、全部超えたら止まる。

### 手順（案件ディレクトリで。前日に作って一通り見る）

```bash
# 0. case.json（intake の依頼票から下書きできる）: category / vocab(food|beauty|general) / brands[].short・official・official_status / focus_products
#    acquired_on（取得日。無ければ取得JSONの fetched_on。どちらも無いと本編に日付を出さない）
#    keywords[].label（任意。複数語の長い検索語を見出しに入れるときの短い表示名）
#    取得は tiktok-acquire で「{カテゴリ語}」「{競合} {カテゴリ}」（＋任意で「{貴社} {カテゴリ}」）を raw/ に
python3 tools/fetch_covers.py --case .            # カバーを assets/covers/<動画ID>.jpg に（動画IDで保存＝取り違え防止）
python3 tools/label_posts.py --case . --init      # 候補（カテゴリ上位30・競合上位20＋PR全件・貴社上位20）
python3 tools/label_posts.py --case . --options   # 選べる値と「迷ったときの決まり」を必ず読む
python3 tools/label_posts.py --case . --contact   # review/contact_<軸>_NN.jpg（各タイルにタイル番号と4文字コード）
#   ★ 一覧シートを実際に開き、タイルごとに patch を書く（下の「選択式ラベル」）
python3 tools/label_posts.py --case . --apply review/patch_K1.csv review/patch_C1.csv ...
python3 tools/label_posts.py --case . --check     # 窓内が全件判定済みになるまで繰り返す
python3 tools/build_first_visit.py --case .       # first_visit.json・FV_ASSETS.md・review/初訪_レビュー.html
node src/generate.js --case . --mode 初訪         # output/TikTok_Competitive_Research_初訪.pptx
python3 tools/preflight.py output/TikTok_Competitive_Research_初訪.pptx   # 致命的0・重大0
python3 tools/verify_assets.py --case .; echo $?  # 0（載せた画像がすべて「関連」と確定した投稿か）
python3 tools/render_pptx_any.py output/TikTok_Competitive_Research_初訪.pptx render_out 130   # 全ページ目視
```

`label_posts.py --contact` は Pillow を使う（tiktok-analyze の venv の Python で実行するか `pip install Pillow`）。

### 選択式ラベル（ここが品質を揃える）

- 判定は**タイル（投稿×検索軸）ごと**。patch は `tile,code,relevance,angle,appeal` の CSV
  （例 `K1-3,7HQX,関連,アレンジ調理,`）。tile はタイル番号、code は一覧シートの画像にだけ焼かれた4文字。
  labels.json には低速なハッシュしか残さないので、画像を開かずにコードを当てることはできない
  （見ていない投稿は確定できない）。`--contact` を作り直すとコードも変わるので、最新のシートを読む。
  シートで見せた後にカバーが差し替わった投稿は確定できない（シートを作り直す）。
- relevance：関連／他社の商品（ブランド軸のみ）／カテゴリ外／無関係／判定不可。
  **例に載るのは「関連」だけ**（冷凍食品の資料に特撮番組の投稿が載った事故の再発防止）。
- angle（切り口）＝カバーと冒頭で分かる“作り”。複数当てはまれば一覧の上のもの。
  appeal（訴求）＝テロップ・本文が推す“価値の言葉”。ブランド軸で関連、または PR 投稿なら必須。
- 投稿者（公式／PR／クリエイター／一般）は選ばない。公式ID・PR表記・フォロワー数で機械が決める。
- 機械の推定は選択欄に入らない（推定をそのまま確定させない）。窓内の判定不可が25%を超えたら止まる。
- 見出しを変えたいときは自由に書き換えず、`python3 tools/build_first_visit.py --case . --list-copy` の
  別案の番号を `fv_copy.json` に `{"now.headline": {"variant": 2}}` と書く。自由記述は資料全体で2件まで
  （`{"text","by","reason"}`、付録に「手修正」と出る）。

### 前日レビュー

`review/初訪_レビュー.html` を営業（または上長）に渡す。掲載する投稿ごとに［OK／差し替え＋理由］、
見出しごとに［このまま／別案］を選び、「結果をコピー」の文面を貼ってもらう。
差し替えは labels.json のその軸の relevance を `irrelevant` にして `build_first_visit.py` から作り直す。
first_visit.json は手で直さない（FV_ASSETS.md の照合値と合わなくなり、generate.js と verify_assets.py が止める）。
文言は `fv_copy.json` で変える。HTML の見出しの案の番号は `fv_copy.json` の variant と同じ。
`review/初訪_前日チェック.md` は同じ内容のチェックリスト。

### 初訪でやってはいけないこと

| 禁止 | なぜ |
|---|---|
| `--mode "初訪,具体提案"` のように統合する | 初訪は単独の資料。二次提案は別ファイル（終了コード2で止まる） |
| INPUT.md / authored.md で初訪を作る | 旧初訪の器（Q番号・lead注記・手法ページ）が戻る。初訪は first_visit.json だけで作る |
| ラベルを見ずに確定する・推定値をそのまま写す | 例示の事故と担当者による品質差が戻る。`--check` が推定と同じ割合を警告する |
| 見出しを長文に書き換える | 文字が多い資料に戻る。別案の番号で選ぶ |
| 「PRをしていない」「0本」を根拠なく書く | 取れた範囲の事実だけ。公式0本は公式IDを確認した社だけ（official_status が confirmed / none。未設定は unknown 扱いで「0本」と書かない） |
| P2 を省く（allow_drop） | P2「いま検索するとこう見える」は資料の入口。成立しなければ止まる（カバー取得かカテゴリ語を見直す） |

---

## 工程

```
tiktok-acquire で取得した raw/*.json
  ↓ 1. 案件ディレクトリを作る（case.json）
  ↓ 2. 動画を取得してコマを抽出する（深い解剖が要る場合）
  ↓ 3. ★AI目視 — コマを実際に見て authored.md に8軸で書く
  ↓ 4. INPUT.md を組む（機械欄＋散文）
  ↓ 5. PPTX を生成する（ステータスで章が決まる）
  ↓ 6. 前検（3本）← ここを通らないものは出さない
  ↓ 7. 画像化して全ページ目視
```

---

## 1. 案件ディレクトリ

macOS / Linux:

```
cp -R <このスキル> 案件_XXX
cd 案件_XXX
npm install
mkdir -p raw
cp /path/to/*.json raw/
```

Windows（PowerShell）:

```
Copy-Item -Recurse <このスキル> 案件_XXX
cd 案件_XXX
npm install
New-Item -ItemType Directory -Force raw
Copy-Item C:\path\to\*.json raw\
```

`npm install` は初回だけ（pptxgenjs）。案件を丸ごとコピーするのは、
スキル本体に案件データを混ぜないため。

`case.json` に「誰を・何で検索したか」を書く。**数値は書かない**（機械が数える）。
（初訪用に作った case.json をそのまま使える。二次提案で使うのは下の欄）

```json
{
  "project": { "project_title": "...", "research_period": "...", "recipient": "..." },
  "client":  { "client_name": "サンプルストア", "client_role": "自社" },
  "brands":  [{ "name": "サンプルストア", "file": "raw/brand_サンプルストア.json",
                "match": "サンプルストア|samplestore", "own": true }],
  "keywords":[{ "name": "100均", "file": "raw/kw_100均.json" }],
  "acquisition": { "サンプルストア": "exhausted" }
}
```

`acquisition` は取得ログの終わり方を記録する。付録の「母数が確定しているか」の記述がここから出る。
値は `exhausted`（検索が終端を返した）／`no_new`（同じ結果が返り続けて打ち切り）／
`capped`（取得上限）／`unknown`（ログ無し）。**本数のしきい値で推測しない。**
書いていない軸は `unknown`（母数未確定）になる（取得JSONに `stop_reason` があればそれを使う）。

- `own: true` は**ちょうど1ブランド**。自社の強調・自社露出・口コミの自社行はすべてこれで決まる
  （`client_name` は社名でよい。自社の判定には使わない）。無ければ自社露出は `[DATA NOT PROVIDED]` で出る
- `match` は本文・タグに対する正規表現。**取得した投稿に1件も当たらないと止まる**
  （以前は黙って全件をそのブランドとして数えていた）。全件を使うなら `"match": ""`
- 取得JSONの `order_basis` が `search_display_order` 以外（tiktok-acquire の `--sessions 2` 以上）の軸は止まる。
  並びが検索の表示順ではなく、順位として使えないため。その軸は `--sessions 1` で取り直す
- 軸の中の同じ動画IDは1本にまとめる（件数を表示する）。別の軸に同じ動画が出るのは正常で、それぞれで数える
- 指標（`stats`）の無い投稿は本数には数えるが、平均・中央値・率・率の順位には入れない（0再生として数えない。INPUT に `stats_missing` と本数が出る）
- PR の判定は初訪と同じ（`tools/fvlib.py` の `pr_basis`）：isAd、PR表記のタグ（#PR・#PR案件・#タイアップ・#広告・#プロモーション・#提供・#ad・#sponsored）、本文の【PR】等のいずれか

---

## 2. 動画とコマの抽出

```bash
python3 tools/extract_frames.py --media-dir media/ --out frames/
```

シーン変化（0.4）または4秒経過、かつ冒頭を必ず含む条件で抜く。依存は ffmpeg だけ。

**なぜこの抜き方か（実測）**：78秒の実投稿で比較したところ、

| 方式 | 枚数 | 時間カバー |
|---|---|---|
| 等間隔11枚 | 11 | 粗い。冒頭の3段構えと第4ブロックを取り逃した |
| シーン検出のみ | 23 | **48秒以降が0枚。後半38%が空白**。一番危ない |
| シーン検出＋時間下限 | 44 | 最大の空白4.0秒・末尾まで |

**時間の空白が6秒を超えると終了コード1で落ちる。** その動画は「全コマを見た」と書けない。

出力は `frames/<動画ID>/001.jpg, 002.jpg …`（3桁・001から）と `frames.json`（尺・時刻）、`contact.jpg`。
`contact.jpg` が一覧シート。**AIはまずこれを1枚見て全体構成を掴む。**

静止画カルーセルはコマ送りが無いため解剖の対象外。**紙面にその旨を明記する。**

### 解剖する動画の宣言（video_manifest.json）

どの動画を解剖し、紙面にどのコマを並べるかを案件直下の `video_manifest.json` に書く。
**これが無いと PART「実際に動画を確認する」（Q7/Q8）は1枚も出ない。**

```json
[
  { "brand_id": "brand_01", "video_no": "video_01", "video_id": "7500005383427972088",
    "sb_frames": "001/004/009/013/018" }
]
```

| キー | 必須 | 中身 |
|---|---|---|
| `brand_id` | ○ | `brand_01` の形。case.json の `brands` の並び順 |
| `video_no` | ○ | `video_01` の形。authored.md の対象 `brand_01/video_01` になる |
| `video_id` | ○ | 動画ID。`frames/<video_id>/` と raw の同じ動画を引く |
| `sb_frames` | ○ | 紙面に並べるコマ番号（`frames/<video_id>/` のファイル名。最大5つ、`/` 区切り） |
| `url` `creator` `title_src` | 任意 | 無ければ raw から引く |

- 再生・保存率・EG は **raw から動画IDで引く**（手書きしない）。raw に無い動画だけ manifest の `views` `save_rate` `eg` を使う
- コマ数・範囲・尺は `frames/<video_id>/` と `frames.json` から数える
- 画像は `frames/<video_id>/<番号>.jpg` をそのまま使う（写しは要らない。`verify_assets.py` がコマ番号まで照合する）
- 形が違う（必須キーが無い・番号の形が違う・brand_id が無い）ときは、どの行の何が悪いかを出して止まる

---

## 3. ★AI目視 — ここが資料の質を決める

OCR や音声認識は使わない（環境依存を増やさないため）。**スキルを実行するAIが、コマを実際に開いて読む。**

### 手順

1. `frames/<video_id>/contact.jpg` を開いて全体構成を掴む
2. 気になるコマを原寸（`001.jpg` 等）で開く
3. `authored.md` に**必須8軸**を `## FIELD brand_01/video_01 <キー>` の形で書く
   フック(0〜3秒)／視覚演出／テロップ／価格・スペック／商品識別／CTA／勝因仮説／本質1行
   （キー名は `merge_authored.py --list-keys`。紙面のコマの見出しは `sb1_label` 〜 `sb5_label` に
   `001: 冒頭で手元の実物を見せる` のように**コマ番号から**書く。番号がずれると `verify_assets` が止める）

### 守ること

- **紙面に載せるコマは、全て実際に開いて見る。**「掲載したが未実見」は禁止
- 見ていないコマは紙面に「未確認」と書く
- 数値は書かない（機械欄が持つ）。散文だけを書く
- n が小さい主張は「（仮説）」と明示し、交絡を書く

### なぜここまで書くか

実案件で実際に出た事故はいずれも人手のOCRでは防げなかった。

- 「未実見」と書きながら、そのコマを紙面に載せていた（6枚）
- 画像とキャプションが1つずれ、63再生の投稿に142,300再生の別人の名前が付いていた（4ページ）
- テロップを「逃したくない人」と書いたが実画面は「逃したく人」（投稿側の誤植）
- 「到達が大きいほど保存率は下がる」と書いたが、実データでは**逆**だった

---

## 4〜5. INPUT.md と生成

```bash
python3 tools/fetch_covers.py --case . --top 1000   # カバーを assets/covers/<動画ID>.jpg に（全投稿）
python3 tools/build_input_md.py --case .     # 機械欄（数値）。カバーは動画ID名の画像を優先して使う
# authored.md に散文を書く
python3 tools/merge_authored.py --case .     # 機械欄＋散文 → INPUT.md
node src/generate.js --case . --mode 具体提案
```

カバーは順位ではなく**動画ID名**で持つ（順位名の画像は順位の決め方が変わると別人の投稿に付く）。
`labels.json`（初訪のラベル）がある案件では `fetch_covers.py` がラベルの投稿しか取らないので、
二次提案で `[IMAGE NOT PROVIDED]` が残ったら、どの投稿の画像が無いかを `generation_log*.md` で確かめる。

**数値は機械欄、散文は authored.md。** 混ぜると再生成のたびに散文が消える（実際に失った）。
`merge_authored.py` は INPUT.md に合成の印を付け、**前回の合成のあとで INPUT.md が手で直されていたら止まる**
（直した散文を authored.md へ移してから再実行。捨ててよいときだけ `--force`）。

### authored.md の書き方（ここを外すと1行も反映されない）

散文は**キー名で流し込む**ので、見出しの形が合っていないと
`merge_authored.py` は「流し込んだ散文: 0 欄」と言って静かに終わる。
実際に、8軸の概念語だけを頼りに書いて0件になった例がある。

形はこれだけ。

```
## FIELD <対象> <キー名>
本文をここに書く。複数行でよい。

## FIELD <対象> <次のキー名>
...
```

`<対象>` は次のどれか（`global` という対象は無い）。

| 対象 | 主なキー名 | 何を書くか |
|---|---|---|
| `brand_01` | `q1_insight` 〜 `q5_insight` | 各設問ページの発見（1文目が大見出し、残りは補足行） |
| `brand_01` | `q4_products` | 名前が出ている商品（1行1商品） |
| `brand_01/top_01` | `content_summary` | Q5 の上位投稿の中身を一言 |
| `brand_01/video_01` | `hook_0_3_sec` `visual_killer` `text_note` `price` `brand_exposure` `cta` `success_or_failure_hypothesis` `one_line_essence` `sb1_label`〜 | 解剖した動画の8軸とコマの見出し |
| `kw_01` | `head_insight` `save_pattern` `cluster_mix` `composition_insight` `save_type` | 検索ワード面 |
| `kw_cross` | `whitespace` | 検索ワード横断の空白地帯（Q6総括の結論） |

示唆（KEEP/IMPROVE/TRY・結論）、Q8、勝ちパターン、口コミ、他プラットフォーム、検索ワード面の動画解剖は
キーではなく `## APPEND <名前>` の下に**見出しごと**書く。雛形は `--list-keys` の末尾に出る
（見出しの形を変えると読まれず、その欄が `[DATA NOT PROVIDED]` のまま残る）。

**使えるキー名は必ずこれで確認してください。** 記憶で書くと0件になります。

```
python3 tools/merge_authored.py --case . --list-keys
```

動画1本ごとの8軸も上の `brand_01/video_01` で authored.md に書く。**INPUT.md に直接書かない**
（以前はそう案内していたが、次の合成で全部消えた）。

流し込んだあと、必ず「流し込んだ散文: N 欄」の N を見ること。0 なら書式が合っていない。

### 口コミ章（# REVIEWS）— 具体提案・競合差再提案

口コミ章を含むステータス（具体提案・競合差再提案）では、先に `review-scraper` で口コミを取る。
`INPUT.md` の `# REVIEWS` は変換ツールではなく、review-scraper の出力（`summary.md`・`reviews.csv`）を読んで
authored.md の `## APPEND REVIEWS` に書く。

- 件数・評価は `summary.md` から。評価は「平均（元の段階）」の数字をそのサイトの満点のまま（5段階換算しない）
- Love／Churn（理由｜言及数）・Quotes（原文｜出典URL）・ACTIONS（離脱理由｜打ち手）は口コミを読んで書く
- 媒体名の既定は @cosme / LIPS。**LIPS は review-scraper では取れない**ので、楽天・Yahoo! を使うなら
  `media_a_label`・`media_b_label` を書き換え、各媒体の満点を `scale_note` に必ず書く（無いと R5 に欠損が出て前検で止まる）
- 手順と欄の対応は `review-scraper/SKILL.md` の「tiktok-deck の口コミ章（`# REVIEWS`）に使うとき」

`# REVIEWS` が無いまま口コミ章を含むモードで生成すると、章を出さずに `generation_log*.md` に「章の欠落」を残す。

### tiktok-analyze の計測を資料に載せる

`tiktok-analyze` を回した案件では、その run ディレクトリを渡す。

```bash
python3 tools/build_input_md.py --case . --analyze-run <tiktok-analyze の run ディレクトリ>
```

省略しても止まらない。案件内の `analyze_run/` `analyze/` `measurement/` を自動で探し、
見つからなければ `status: not_run` を INPUT.md に書き、
付録に「動画の中での言及回数は計測していない。0回ではなく未計測」と出す。

`--analyze-run` を渡したのに `measurement/measure_output.json` が無い場合は止まる。
パスの取り違えを黙って「未計測」にすると、測ったはずの案件が測っていない扱いで出るため。

載るのは4経路（本文・ハッシュタグ・テロップ・音声）の出現率と1本あたり回数。
音声は「話が無い投稿」と「まだ聞いていない投稿」を分母から外しているので、
外した本数を各行に併記する。これを落とすと出現率が実力より高く見える。

### ステータスと章（初訪以外）

初訪は上の「初訪」の節の構成で、この表の対象外。

| | 具体提案 | 構成提案 | 競合差再提案 |
|---|---|---|---|
| Q1 誰が / Q2 PR比 | ○ | ✗ | ○ |
| Q3 クラスタ / Q4 商品 | ○ | ✗ | ○ |
| Q5 上位投稿 | ○ | ○ | ○ |
| 全ブランド横断サマリー | ○ | ✗ | ○ |
| Q6 検索ワード面（上位・保存率上位・横断） | ○ | ✗ | ○ |
| 言及回数（tiktok-analyze の計測がある案件だけ） | ○ | ○ | ○ |
| Q7/Q8 動画の構成解剖（video_manifest.json がある案件だけ） | ○ | ○ | ✗ |
| 検索ワード面の動画解剖（`# KEYWORD VIDEO ANALYSIS` がある案件だけ） | ○ | ○ | ✗ |
| 口コミ（`# REVIEWS`）/ 他プラットフォーム（`# OTHER PLATFORMS`） | ○ | ✗ | ○ |
| 勝ちパターン（`### Winning Patterns` がある案件だけ） | ○ | ○ | ✗ |
| 実測の枚数（5社の案件・2026-09 改修前） | 43枚 | 32枚 | 26枚 |

表は `src/generate.js` の MODES（q1q2 / q3 / q4 / q5 / allBrandSummary / kwHead・kwSaves / mentions /
videoAnatomy / kwVideos / reviews・platforms / patterns）と同じ。変えるときは両方を直す。

- 枚数は改修前の実測。構成提案は Q1/Q2/Q6 を外したので少なくなり、口コミ・他プラットフォームには章扉が1枚ずつ付く
- 組み合わせ可：`--mode "具体提案,競合差再提案"`（章は和集合）。初訪は組み合わせない（終了コード2）
- 別名：`deep`=具体提案（`quick`=初訪）
- モードは `--mode` → 環境変数 `DECK_MODE` → case.json の `settings.deck_mode` → INPUT.md の `deck_mode` の順に見る。
  **未知の名前はエラーで止まる**（黙って全ページ出さない）
- **レポート（施策前後比較）は未実装で、指定するとエラーで止まる。** 比較のページが無いまま出すと、
  後から取った現状を「効果測定」と偽ることになるため（施策前の基準データは同じ条件で取って保存しておく）
- **章の並びは固定**：PART 検索面の実態 → 検索ワード → 他プラットフォーム → 口コミ → 動画の構成解剖 → 総括・示唆 → 付録
  （営業ステータスでは ①現状 → ⑤競合差 → ⑥クチコミ → ②方向性 → ③実行案）。`--mode` の書き順には従わない。
  PART の番号は載せた章の順に振る（競合差再提案で 1→2→4 と飛ばない）

表紙・手法・章扉・次アクションの文言もステータスと**中身の有無**に連動する。
検索ワード0件なら Q6 を、解剖0本なら Q7/Q8・「実動画を取得」を書かない。
**載せない章を「明らかにする」と書かないため。**

---

## 6. 前検（通らないものは出さない）

```bash
python3 tools/preflight.py output/<file>.pptx      # 版面の崩れ・資料内の矛盾
python3 tools/verify_assets.py --case .            # 画像とキャプションのズレ
python3 tools/render_pptx_any.py output/<file>.pptx render_out 130   # 画像化
python3 tools/render_pptx_any.py output/<file>.pptx output 130 --keep-pdf   # 配布用 PDF も残す（最後の行に {"pdf_ok": true, "pdf_path": …} の JSON）
```

PDF は generate.js では作らない（`--pdf` を渡しても出ない。注意を出す）。配布用 PDF は `--keep-pdf` で作る。

Windows（PowerShell）では `python3` を `py -3` に、`echo $?` を `echo $LASTEXITCODE` に読み替える
（PowerShell の `$?` は真偽値で、終了コードではない）。

**提出ゲートは2本とも通ること。どちらかが落ちたら出さない。**

- `preflight` が「致命的0／重大0」
- `verify_assets` が **終了コード0**（`tail` 越しだと 0 に見えるので、必ず `echo $?`（PowerShell は `$LASTEXITCODE`）で確かめる）

`verify_assets` が拾うのは「キャプションと違う投稿の画像が貼られている」事故で、目視では気づけない。実際に納品済みの資料で、別クリエイターの投稿に他人の画像が付いたまま出ていた例がある。

| 検査 | 捕まえるもの |
|---|---|
| `preflight` | 文字のスライド外（下端・左右）・フッター衝突・図形の重なり・未解決トークン・**同じ数値が別ページで最高とも最低とも語られている矛盾**・平均と中央値の取り違え・補足行の非掲載（生成ログ） |
| `verify_assets` | 同じ動画を指す画像の食い違い・別動画の画像の使い回し・**コマ番号とバッジのズレ**・PPTXに案件外の画像が混入 |
| 画像化 → 目視 | 上2つで拾えない読みにくさ |

生成ログ（`output/generation_log{接尾辞}.md`。具体提案は `generation_log.md`、構成提案は `generation_log_構成.md` 等。
preflight は PPTX の名前から対応するログを読む）の QA警告も必ず読む。
**「補足行に入らず非掲載」は preflight で重大になる。その文は紙面に載っていないので、短く書き直す。**
「表セルを◯字分切り詰めた」「章の欠落」は止まらないが毎回表示されるので、意図どおりか確かめる。

---

## 落とし穴

| 症状 | 原因 | 対処 |
|---|---|---|
| 5軸すべて0件でログイン要求 | `scrape_search.js` など別のスクレイパーを使っている | tiktok-acquire の `search.mjs` を使う |
| 散文が消えた | INPUT.md に直接書いた | `authored.md` に書いて merge する |
| 同じ数値が2か所で食い違う | 散文に数値を書いた | 数値は機械欄のみ |
| 画像がキャプションと違う | 画像がランク名（top01.jpg）で保存され、順位が変わった | `verify_assets.py` が検出する |
| 「全部見た」と書けない | コマの時間カバーが足りない | `extract_frames.py` が終了コード1で止める |
| build_input_md が order_basis で止まる | `--sessions 2` 以上で取得した軸（並びが表示順ではない） | その軸を `--sessions 1` で取り直す |
| build_input_md が match で止まる | 正規表現が本文・タグに1件も当たらない | 表記ゆれ・英字表記を足す |
| Q7/Q8 が1枚も出ない | `video_manifest.json` が無い | 「2. 動画とコマの抽出」の形で書く |

---

## 担当範囲

| やること | 担当 |
|---|---|
| 検索表示順・指標の取得、動画実体の取得 | `tiktok-acquire` |
| データセット化・登場率・上位下位差分 | `tiktok-analyze` |
| コマ抽出・AI目視・資料化・前検 | **本スキル** |
| 営業からのヒアリングとステータス判定 | `tiktok-intake` |

`tools/build_deck.py`・`tools/modules.json` は tiktok-intake（gaps.py）が不足入力の検出に使う道具で、
資料の章は決めない。章の正本は `src/generate.js` の MODES と上の「ステータスと章」の表。
