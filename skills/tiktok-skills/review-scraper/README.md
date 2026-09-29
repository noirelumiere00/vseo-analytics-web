# review-scraper

美容・ECの口コミ（@cosme／楽天市場／Yahoo!ショッピング）を集めて
CSV・JSONL・集計サマリーに出す Claude Code Skill。使い方は [SKILL.md](SKILL.md)。

- Python 3.9 以上・標準ライブラリのみ（pip 不要、macOS/Windows/Linux）
- テスト: `python3 tests/test_scrapers.py`（ネットワーク不要。合成ページで `parse_*` と取得の流れを確かめる）

## Skill として使えるようにする

このフォルダは `tiktok-skills` 一式の一部。一式のフォルダにある `install.sh`（Windows は `install.ps1`）が
`~/.claude/skills/review-scraper` へ**コピー**で配置する（手順は一式の `README.md`）。追加インストールは不要。

シンボリックリンクやジャンクションで `~/.claude/skills/review-scraper` を作らない。
インストーラは配置先を消してからコピーし直すので、リンク先の元フォルダまで消えるおそれがある。
