#!/usr/bin/env python3
"""
Instagram ハッシュタグ スクレイパー
──────────────────────────────────
【実行方法】
1. Python 3.9+ がインストールされていること
2. ターミナル（Mac）またはコマンドプロンプト（Windows）で以下を実行:

   pip install playwright openpyxl

3. スクリプトを実行:

   python scrape_instagram.py

4. Chromeが開いたらInstagramにログインして Enter を押す
5. 自動でスクレイピングが始まり、ig_results.xlsx が出力される
"""

import asyncio
import json
import re
import sys
import os
from pathlib import Path
from datetime import datetime

# ── 設定 ───────────────────────────────────────────────────────────
HASHTAGS = [
    ('#洗濯機掃除',      'https://www.instagram.com/explore/search/keyword/?q=%23%E6%B4%97%E6%BF%AF%E6%A9%9F%E6%8E%83%E9%99%A4'),
    ('#洗濯槽クリーナー', 'https://www.instagram.com/explore/search/keyword/?q=%23%E6%B4%97%E6%BF%AF%E6%A7%BD%E3%82%AF%E3%83%AA%E3%83%BC%E3%83%8A%E3%83%BC'),
    ('#洗濯槽掃除',      'https://www.instagram.com/explore/search/keyword/?q=%23%E6%B4%97%E6%BF%AF%E6%A7%BD%E6%8E%83%E9%99%A4'),
    ('#洗濯',           'https://www.instagram.com/explore/search/keyword/?q=%23%E6%B4%97%E6%BF%AF'),
]
TOP_N       = 20   # 各ハッシュタグで取得する上位件数
OUTPUT_JSON = str(Path.home() / 'ig_results.json')
OUTPUT_XLSX = str(Path.home() / 'ig_results.xlsx')
# ───────────────────────────────────────────────────────────────────


def chrome_profile_path():
    """OS別のChromeプロファイルパスを返す"""
    if sys.platform == 'darwin':
        p = Path.home() / 'Library/Application Support/Google/Chrome/Default'
    elif sys.platform == 'win32':
        p = Path(os.environ.get('LOCALAPPDATA', '')) / 'Google/Chrome/User Data/Default'
    else:
        p = Path.home() / '.config/google-chrome/Default'
    return str(p) if p.exists() else None


async def scrape_hashtag(page, tag: str, url: str, top_n: int) -> list:
    """1ハッシュタグ分の投稿を取得して返す"""
    posts = []
    api_posts = {}   # shortcode -> {likes, comments, username, caption}

    # ── APIレスポンスをインターセプト ──────────────────────────────
    async def on_response(resp):
        if 'instagram.com' not in resp.url:
            return
        ct = resp.headers.get('content-type', '')
        if 'json' not in ct:
            return
        try:
            data = await resp.json()
        except Exception:
            return
        _extract_api_posts(data, api_posts)

    page.on('response', on_response)

    print(f'\n  {tag} を取得中...')
    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=30000)
    except Exception as e:
        print(f'  ⚠ ページ移動エラー: {e}')
        return posts

    # ページがロードされるまで待機＆スクロール
    await page.wait_for_timeout(4000)
    for _ in range(4):
        await page.evaluate('window.scrollBy(0, 700)')
        await page.wait_for_timeout(1200)
    await page.wait_for_timeout(2000)

    # ── 投稿リンクを収集 ──────────────────────────────────────────
    links = await page.query_selector_all('a[href*="/p/"], a[href*="/reel/"]')
    print(f'  リンク検出: {len(links)} 件')

    seen = set()
    for link in links:
        href = await link.get_attribute('href')
        if not href or href in seen:
            continue
        seen.add(href)

        img_el   = await link.query_selector('img')
        thumb    = (await img_el.get_attribute('src'))  if img_el else ''
        alt      = (await img_el.get_attribute('alt'))  if img_el else ''

        m         = re.search(r'/(p|reel)/([A-Za-z0-9_-]+)/', href)
        shortcode = m.group(2) if m else ''
        is_reel   = '/reel/' in href

        api = api_posts.get(shortcode, {})
        posts.append({
            'rank':      len(posts) + 1,
            'tag':       tag,
            'url':       f'https://www.instagram.com{href}',
            'shortcode': shortcode,
            'is_reel':   is_reel,
            'thumb':     thumb,
            'alt':       alt[:100],
            'username':  api.get('username', ''),
            'likes':     api.get('likes', ''),
            'comments':  api.get('comments', ''),
            'caption':   api.get('caption', '')[:120],
        })
        if len(posts) >= top_n:
            break

    page.remove_listener('response', on_response)
    print(f'  取得完了: {len(posts)} 件')
    return posts


def _extract_api_posts(data: dict, out: dict):
    """Instagram GraphQLレスポンスから投稿データを抽出（多様な構造に対応）"""
    if not isinstance(data, dict):
        return

    def walk(obj):
        if isinstance(obj, dict):
            # 投稿ノードの特徴: shortcode or code キーを持つ
            code = obj.get('shortcode') or obj.get('code')
            if code and isinstance(code, str) and len(code) >= 6:
                entry = {
                    'username': (obj.get('owner') or obj.get('user') or {}).get('username', ''),
                    'likes':    obj.get('like_count') or obj.get('edge_media_preview_like', {}).get('count', ''),
                    'comments': obj.get('comment_count') or obj.get('edge_media_to_comment', {}).get('count', ''),
                    'caption':  '',
                }
                # caption
                cap = obj.get('caption') or {}
                if isinstance(cap, dict):
                    entry['caption'] = cap.get('text', '')
                elif isinstance(cap, str):
                    entry['caption'] = cap
                else:
                    edges = obj.get('edge_media_to_caption', {}).get('edges', [])
                    if edges:
                        entry['caption'] = edges[0].get('node', {}).get('text', '')
                out[code] = entry
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(data)


def save_xlsx(all_posts: list, path: str):
    """Excelに保存"""
    try:
        import openpyxl
    except ImportError:
        print('⚠ openpyxl がインストールされていません。pip install openpyxl を実行してください。')
        return

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Instagram結果'

    headers = ['順位', 'ハッシュタグ', 'ユーザー名', 'タイプ', 'いいね数', 'コメント数',
               'キャプション', '投稿URL', 'サムネイルURL']
    ws.append(headers)

    for p in all_posts:
        ws.append([
            p['rank'],
            p['tag'],
            p['username'],
            'リール' if p['is_reel'] else '投稿',
            p['likes'],
            p['comments'],
            p['caption'],
            p['url'],
            p['thumb'],
        ])

    # 列幅調整
    for col in ws.columns:
        max_len = max((len(str(cell.value or '')) for cell in col), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 60)

    wb.save(path)
    print(f'\n✅ Excel保存: {path}')


async def main():
    import subprocess
    import tempfile
    import time
    from playwright.async_api import async_playwright

    CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

    print('=' * 55)
    print('  Instagram ハッシュタグ スクレイパー')
    print('=' * 55)

    # 一時プロファイルでChrome起動 → SingletonLock問題を回避
    tmp = tempfile.mkdtemp(prefix='ig_scrape_')
    print(f'\nChromeを起動中...')
    proc = subprocess.Popen(
        [CHROME, '--remote-debugging-port=9222', f'--user-data-dir={tmp}',
         '--no-first-run', '--no-default-browser-check', '--no-sandbox'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    time.sleep(3)

    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.connect_over_cdp('http://localhost:9222')
        except Exception as e:
            print(f'❌ Chrome接続失敗: {e}')
            proc.terminate()
            return

        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        await page.goto('https://www.instagram.com/accounts/login/', wait_until='domcontentloaded')

        print('\n' + '-' * 55)
        print('  Chromeが開きました。Instagramにログインしてください。')
        print('  ログイン完了後、このターミナルで Enter を押してください。')
        print('-' * 55)
        input()

        # ── 各ハッシュタグをスクレイピング ────────────────────────
        all_posts = []
        for tag, url in HASHTAGS:
            posts = await scrape_hashtag(page, tag, url, TOP_N)
            all_posts.extend(posts)

        await browser.close()

    proc.terminate()
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

    # ── 出力 ─────────────────────────────────────────────────────
    print(f'\n合計 {len(all_posts)} 件取得')

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(all_posts, f, ensure_ascii=False, indent=2)
    print(f'✅ JSON保存: {OUTPUT_JSON}')

    save_xlsx(all_posts, OUTPUT_XLSX)

    print('\n完了！ ~/ig_results.xlsx を確認してください。')


if __name__ == '__main__':
    asyncio.run(main())
