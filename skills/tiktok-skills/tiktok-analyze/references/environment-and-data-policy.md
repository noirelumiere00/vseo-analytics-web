# 実行環境とデータ取扱い

## Coworkでの初回セットアップ

<!-- posix-only: この節のコマンドは Cowork の Linux コンテナ内で実行するもの。
     手元の Windows / macOS で打つ手順ではない。手元の導入はリポジトリ直下の README.md を見ること -->

**この節は Cowork のコード実行環境（Linux コンテナ）の中の話。**
手元のPCへの導入手順ではない。手元はリポジトリ直下の `README.md`（`install.sh`／`install.ps1`）を見ること。

Claude Coworkのコード実行環境を使う。Skill本体（`tiktok-analyze`）を読み、仮想環境はSkill外の一時領域へ作る。分析モジュールに Node.js の依存は無い（取得の `tiktok-acquire/scripts` と資料化の `tiktok-deck` がそれぞれ `npm install` を持つ）。

```bash
SKILL_ROOT="/skills/tiktok-analyze"            # 実際に置かれている場所に合わせる
RUNTIME_ROOT="${TMPDIR:-/tmp}/tiktok-analyze-runtime"
python3 -m venv "$RUNTIME_ROOT/.venv"      # Windows は python または py
"$RUNTIME_ROOT/.venv/bin/python" -m pip install -r "$SKILL_ROOT/scripts/requirements.txt"
"$RUNTIME_ROOT/.venv/bin/python" "$SKILL_ROOT/scripts/check_dependencies.py" --module analyze
```

ffmpeg/ffprobe、Node.js、PPTX/PDFの表示確認手段が必要。機械OCR（Tesseract 等）は不要——テロップは抽出フレームを Claude が読む。Cowork環境で不足している場合は、技術コマンドを営業へ大量に返さず、「動画解析の準備が不足」「資料変換の準備が不足」のように不足機能と影響を短く示して止める。利用者のPCへ無断でソフトを追加しない。`--break-system-packages` は使わない。

取得（`tiktok-acquire`）には TikTok本体・TikTok配信CDN への外部通信が必要。分析は取得済みの `raw/*.json` と `media/` を読むだけなので、`check_dependencies.py --module analyze` は TikTok への到達性を見ない（`--module acquire` / `all` で確認する）。導入時は PyPI、faster-whisper の初回実行時はモデル取得の通信が要る。**到達できない場合に別経路へ自動で切り替えることはしない**（かつてブラウザ操作＋ログインへ切り替える設計だったが、それが事故の原因になったため廃止した）。

- TikTokが遮断されている場合 → **取得をあきらめ、その旨を資料に明記する。**
  ブラウザ操作ツールで人にログインさせて取る経路は採らない。TikTokアカウント単位でブロックされる危険があり、実際に別PCで7回のログイン試行が空振りした。
  遮断の切り分けは `tiktok-acquire` の `errorCode`（`TIKTOK_CDN_DENIED` なら出口IPの問題で、端末設定をいじっても解けない）を見る。
- 音声ASRを行わない場合は「未計測（0件ではない）」として資料に明記する。faster-whisper が無い環境では `extract_signals.py` が自動で動画の音声経路を unmeasured として記録する（`coverage_note` に件数が入る）。

## 所要時間と容量

- まず各軸の上位10〜20本で一気通貫を確認する。
- 120本の全件処理は動画尺・通信・CPUにより数時間以上かかる場合がある。
- 1動画250MBを上限とし、開始前に8GB以上の空きを確認する。
- 取得失敗・レート制限は0回として集計せず、取得失敗一覧に残す。

## 公開動画と権利

利用前に、適用されるTikTok・データ取得ツールの利用規約、社内規程、著作権、肖像、プライバシーの扱いを確認する。公開状態で取得可能でも、自由な再配布を意味しない。社外資料には必要最小限の引用画像と元投稿リンクだけを使用し、必要に応じて法務・権利者確認を行う。

## 保存と削除

Excel、動画、音声認識結果、抽出画像、投稿者名・ID、資料は案件別の作業フォルダに保存され、自動削除されない。案件ごとにアクセス権と保存期限を定め、納品・確認後に不要な生動画と中間ファイルを削除する。Skill本体のフォルダ（`scripts/` など）へ案件データを入れない。`telop.json`・`rules.json` などの案件ファイルは `<run-dir>` の中に置く（`--manifest <run-dir>/telop.json`）。

## #PRの意味

本Skillが見るのは、正規化後の完全一致タグ `#PR` の表記（caption・hashtags・取り込み済みテロップ）と、TikTok 側の広告フラグ（isAd）の2つの記録だけ。集計の `pr` 群は「どちらかがある投稿」（2026-09-03 決定）。広告投稿の実態や、景品表示法その他の法令に適合しているかは判定しない。「#PR表記なし」「どちらも無い」を「オーガニック」「広告ではない」と断定しない。

> コマンド例は `python3` で書いている。Windows では `python` または `py` に読み替える。
