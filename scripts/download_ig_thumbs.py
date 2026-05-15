#!/usr/bin/env python3
"""
Instagram サムネイル 一括ダウンローダー
────────────────────────────────────────
【実行方法】
1. 先に scrape_instagram.py を実行して ig_results.json を作成しておく
2. このスクリプトと同じフォルダで実行:

   python3 download_ig_thumbs.py

3. client/public/ig-thumbs/ にサムネが保存される
4. instagram-mockup.html をブラウザで開くと自動でサムネが表示される

【注意】
ig_results.json の thumb URL は取得後数時間〜数日で期限切れになります。
スクレイピング直後に実行してください。
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

# ig_results.json の検索順: スクリプトと同じフォルダ → ホームディレクトリ → カレントディレクトリ
def _find_json():
    for p in [
        Path(__file__).parent / 'ig_results.json',
        Path.home() / 'ig_results.json',
        Path('ig_results.json'),
    ]:
        if p.exists():
            return p
    return Path(__file__).parent / 'ig_results.json'  # エラーメッセージ用

JSON_PATH = _find_json()
OUT_DIR = Path(__file__).parent.parent / 'client' / 'public' / 'ig-thumbs'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/120.0.0.0 Safari/537.36'
}


def main():
    if not JSON_PATH.exists():
        print(f'❌ {JSON_PATH} が見つかりません。')
        print('   先に scrape_instagram.py を実行して ig_results.json を作成してください。')
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with open(JSON_PATH, encoding='utf-8') as f:
        posts = json.load(f)

    total = len([p for p in posts if p.get('shortcode') and p.get('thumb')])
    print(f'対象: {total} 件')
    print(f'保存先: {OUT_DIR}\n')

    ok = skip = fail = 0

    for p in posts:
        code = p.get('shortcode', '')
        thumb = p.get('thumb', '')
        if not code or not thumb:
            continue

        out = OUT_DIR / f'{code}.jpg'
        if out.exists():
            skip += 1
            continue

        try:
            req = urllib.request.Request(thumb, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
            out.write_bytes(data)
            print(f'  ✅ {code}  ({p.get("tag","")} #{p.get("rank","")})')
            ok += 1
        except urllib.error.HTTPError as e:
            print(f'  ⚠  {code}: HTTP {e.code} — URL期限切れの可能性')
            fail += 1
        except Exception as e:
            print(f'  ❌ {code}: {e}')
            fail += 1

    print(f'\n──────────────────────────────')
    print(f'✅ 成功: {ok} 件')
    print(f'⏭  スキップ（既存）: {skip} 件')
    print(f'❌ 失敗: {fail} 件')
    if fail > 0:
        print('\n⚠  失敗が多い場合はURLが期限切れです。')
        print('   scrape_instagram.py を再実行してから、すぐにこのスクリプトを実行してください。')
    else:
        print('\n完了！ instagram-mockup.html をブラウザで開くとサムネが表示されます。')


if __name__ == '__main__':
    main()
