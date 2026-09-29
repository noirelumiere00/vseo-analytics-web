# review-scraper

美容・ECの口コミ（@cosme／楽天市場／Yahoo!ショッピング）を集めて
CSV・JSONL・集計サマリーに出す Claude Code Skill。使い方は [SKILL.md](SKILL.md)。

- Python 3.9 以上・標準ライブラリのみ（pip 不要、macOS/Windows/Linux）
- テスト: `python3 tests/test_scrapers.py`（ネットワーク不要）

## Skill として使えるようにする

```bash
git clone <このリポジトリ> ~/dev/review-scraper
# macOS / Linux
ln -s ~/dev/review-scraper ~/.claude/skills/review-scraper
# Windows（PowerShell・管理者でなくてよい）
New-Item -ItemType Junction -Path $HOME\.claude\skills\review-scraper -Target $HOME\dev\review-scraper
```
