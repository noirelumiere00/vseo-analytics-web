# TikTok競合分析 → 提案資料作成スキル一式（共有パッケージ）

## ⚠️ 重要：ZIPを Claude のチャットに添付しても導入されません
スキルは「~/.claude/skills/ にフォルダとして置く」ことで初めて使えます。
チャットへの添付では登録されないため、下の導入手順を実行してください。

## 導入手順（各メンバーが自分の端末で1回だけ）
### 前提ソフト（先に入れる）
- Claude Code（CLI / デスクトップ / IDE拡張のいずれか）
- Node.js 20 以上／Google Chrome／Python 3.10〜3.12

### かんたん導入（同梱スクリプト）
1. ZIPを展開する
2. 展開した `tiktok-skills` フォルダの中で、OSに合わせて実行:
   - macOS / Linux：`bash install.sh`
   - Windows（PowerShell）：`./install.ps1`
   （5スキルを ~/.claude/skills/ に配置し、npm/pip も自動実行します）
3. **Claude Code を再起動**する
4. 「TikTokの初訪資料を作って」等と依頼すれば発動します

### 手動で入れる場合
1. 5つのフォルダ（tiktok-intake / tiktok-acquire / tiktok-analyze / tiktok-deck / review-scraper）を
   `~/.claude/skills/`（Windowsは `%USERPROFILE%\.claude\skills\`）へコピー
2. 依存を入れる:
   ```bash
   cd ~/.claude/skills/tiktok-acquire/scripts && npm install
   cd ~/.claude/skills/tiktok-deck && npm install
   cd ~/.claude/skills/tiktok-analyze/scripts && python3 -m pip install -r requirements.txt
   # review-scraper は追加インストール不要
   ```
3. Claude Code を再起動

---

## 含まれるもの
- `tiktok-intake` … 受付（依頼→必要情報の確定）
- `tiktok-acquire` … 取得（検索面データ・動画）
- `tiktok-analyze` … 計測（登場率・勝ちパターン）
- `tiktok-deck` … 資料化（PPTX生成）※章順を「現状+競合差→市場空白→クチコミ→方向性+実行案→締め」に整理済み
- `review-scraper` … クチコミ収集（楽天市場／Yahoo!ショッピング／@cosme）。標準ライブラリのみで動作（pip不要）

## セットアップ（受け取った人がやること）
1. このフォルダ内の4スキルを、各自の `~/.claude/skills/` 配下へ配置する
   （例：`~/.claude/skills/tiktok-deck/` となるように置く）
2. 依存をインストール（node_modules は容量削減のため同梱していません）
   ```bash
   # 取得スキル（Node.js 20+ と Google Chrome が必要）
   cd ~/.claude/skills/tiktok-acquire/scripts && npm install
   # 資料化スキル
   cd ~/.claude/skills/tiktok-deck && npm install
   # 計測スキル（Python 3.10〜3.12 の venv を1つ作って共有）
   cd ~/.claude/skills/tiktok-analyze/scripts && python3 -m pip install -r requirements.txt
   ```
3. `review-scraper` は Python標準ライブラリのみで動作するため追加インストール不要
4. PDF書き出しが必要な場合のみ LibreOffice を導入（任意）

## 使い方の入口
- Claude Code で「TikTokの初訪資料を作って」等と依頼すると `tiktok-intake` が起動します
- 直接資料化する場合は `tiktok-deck` の `SKILL.md` と `SKILL_GUIDE.md` を参照

## 注意
- TikTokにログインしない・CAPTCHAを突破しない・UA/IP偽装をしない設計です
- 取得可否は出口IPのレピュテーション次第で変動します（0件時は errorCode を確認）
