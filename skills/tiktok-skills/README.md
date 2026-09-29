# TikTok競合分析 → 提案資料作成スキル一式（共有パッケージ）

## ⚠️ 重要：ZIPを Claude のチャットに添付しても導入されません
スキルは「~/.claude/skills/ にフォルダとして置く」ことで初めて使えます。
チャットへの添付では登録されないため、下の導入手順を実行してください。

## 導入手順（各メンバーが自分の端末で1回だけ）
### 前提ソフト（先に入れる）
- Claude Code（CLI / デスクトップ / IDE拡張のいずれか）
- Node.js 20 以上／Google Chrome／Python 3.10〜3.12（3.13 以上・3.9 以下は不可）
- PDF が要る場合だけ LibreOffice（任意）

### かんたん導入（同梱スクリプト）
1. ZIPを展開する
2. 展開した `tiktok-skills` フォルダの中で、OSに合わせて実行:
   - macOS / Linux：`bash install.sh`
   - Windows：`powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`
     （ZIP由来のスクリプトは既定の実行ポリシーで拒否されるため、この形で起動する）
   - 5スキルを `~/.claude/skills/` に配置し、npm と Python の venv（`~/.claude/skills/.venv`）を作る
   - 最後に手順ごとの結果（✅／❌）が出る。❌ があれば終了コード1で止まるので、表示に従って直す
3. **Claude Code を再起動**する
4. 「TikTokの初訪資料を作って」等と依頼すれば発動します

### 手動で入れる場合
1. 5つのフォルダ（tiktok-intake / tiktok-acquire / tiktok-analyze / tiktok-deck / review-scraper）を
   `~/.claude/skills/`（Windowsは `%USERPROFILE%\.claude\skills\`）へコピー
2. 依存を入れる（Python はシステムに直接入れず、venv を1つ作って全スキルで共有する）:
   ```bash
   cd ~/.claude/skills/tiktok-acquire/scripts && npm install
   cd ~/.claude/skills/tiktok-deck && npm install
   python3.12 -m venv ~/.claude/skills/.venv          # 3.10〜3.12 のどれか
   ~/.claude/skills/.venv/bin/python -m pip install -r ~/.claude/skills/tiktok-analyze/scripts/requirements.txt
   # review-scraper は追加インストール不要
   ```
3. Claude Code を再起動

Python のツールは `~/.claude/skills/.venv/bin/python`（Windows は `.venv\Scripts\python.exe`）で実行する。
初訪の一覧シート（`label_posts.py --contact`）は Pillow を使う。

---

## 含まれるもの
- `tiktok-intake` … 受付（依頼→必要情報の確定。初訪は選択式の依頼フォーム）
- `tiktok-acquire` … 取得（検索面データ・動画）
- `tiktok-analyze` … 計測（登場率・勝ちパターン）
- `tiktok-deck` … 資料化（PPTX生成）
- `review-scraper` … クチコミ収集（楽天市場／Yahoo!ショッピング／@cosme）。標準ライブラリのみで動作（pip不要）

## 2026-09-29 改修：初訪資料を作り直した
上長レビューで「文字が多い」「前提・フォロワー帯は要らない」「無関係な投稿が例に載っている」
「ストーリーが無い」「作る人で質がぶれる」と差し戻された初訪を、専用の作り方に分けた。
- 本編 最大8枚＋付録2枚。1枚＝実画像＋ワンフレーズ（現状 → 競合の発信 → 足りない発信 → 伸びている型 → まずこの3本 → 次回）
- 軸はカテゴリで伸びている型（お土産）と競合のコミュニケーションの2本。自社ブランドの説明はしない
- 投稿の判定は固定語彙からの選択式。画像を見て「関連」と確定した投稿だけを例に使う
- 前日に作り、`review/初訪_レビュー.html` で［OK／差し替え］を選んでもらってから持っていく
詳しくは `SKILL_GUIDE.md` の③と `tiktok-deck/SKILL.md` の「初訪」。

## 使い方の入口
- Claude Code で「TikTokの初訪資料を作って」等と依頼すると `tiktok-intake` が起動します
- 直接資料化する場合は `tiktok-deck` の `SKILL.md` と `SKILL_GUIDE.md` を参照

## 注意
- TikTokにログインしない・CAPTCHAを突破しない・UA/IP偽装をしない設計です
- 取得可否は出口IPのレピュテーション次第で変動します（0件時は errorCode を確認）
