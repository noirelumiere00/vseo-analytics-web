#!/usr/bin/env python3
"""
Apify Instagram Scraper でサムネを一括取得
─────────────────────────────────────────
使い方:
  python3 scripts/fetch_ig_thumbs_apify.py

環境変数 APIFY_API_KEY が必要（.claude/settings.local.json で設定済み）
サムネは client/public/ig-thumbs/{shortcode}.jpg に保存される
"""

import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

API_KEY  = os.environ.get('APIFY_API_KEY', '')
OUT_DIR  = Path(__file__).parent.parent / 'client' / 'public' / 'ig-thumbs'
ACTOR_ID = 'apify~instagram-scraper'

# モックに入っている全ショートコード（重複除去済み）
SHORTCODES = [
    # #洗濯槽クリーナー
    'DAndsupyhzR', 'C71FuB2PCds', 'DV8wkcSj_ZM', 'C4aURQ9vgM4',
    'DPLcVeoCaJU', 'CrslP_LgG5d', 'DX1cia1RAo2', 'DX308QwBi5u',
    'DMaWttvvTXz', 'DYE_Krohgrf', 'DN7k-tSkt3a', 'DXwGXtmx_1e',
    # #洗濯槽掃除 (追加分)
    'CwpC1C_vbIe', 'DD1-SaYzLQN', 'DQEP1VOEdLk',
    'DKrKb2QvNtc', 'DUiGIW6Acin', 'DLMjWOlTmGx',
]


def apify_request(method, path, body=None, token=None):
    url = f'https://api.apify.com/v2{path}'
    if token:
        url += ('&' if '?' in url else '?') + f'token={token}'
    data = json.dumps(body).encode() if body else None
    headers = {'Content-Type': 'application/json'} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def run_actor(shortcodes):
    urls = [f'https://www.instagram.com/p/{sc}/' for sc in shortcodes]
    print(f'Apify 実行開始: {len(urls)} 件')
    payload = {
        'directUrls': urls,
        'resultsType': 'posts',
        'resultsLimit': 1,
    }
    result = apify_request('POST', f'/acts/{ACTOR_ID}/runs', body=payload, token=API_KEY)
    run_id = result['data']['id']
    print(f'Run ID: {run_id}')
    return run_id


def wait_for_run(run_id, timeout=300):
    print('完了待機中 ', end='', flush=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = apify_request('GET', f'/actor-runs/{run_id}', token=API_KEY)
        status = result['data']['status']
        if status == 'SUCCEEDED':
            print(' ✅')
            return result['data']['defaultDatasetId']
        if status in ('FAILED', 'ABORTED', 'TIMED-OUT'):
            print(f' ❌ ({status})')
            return None
        print('.', end='', flush=True)
        time.sleep(8)
    print(' タイムアウト')
    return None


def fetch_results(dataset_id):
    result = apify_request('GET', f'/datasets/{dataset_id}/items?limit=200', token=API_KEY)
    return result  # list of post objects


def download_thumb(url, dest_path):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        dest_path.write_bytes(resp.read())


def main():
    if not API_KEY:
        print('❌ APIFY_API_KEY が設定されていません')
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # すでに存在するサムネをスキップ
    needed = [sc for sc in SHORTCODES if not (OUT_DIR / f'{sc}.jpg').exists()]
    if not needed:
        print('✅ すべてのサムネが既にダウンロード済みです')
        return

    print(f'取得対象: {len(needed)} 件 (既存スキップ: {len(SHORTCODES)-len(needed)} 件)')

    run_id = run_actor(needed)
    dataset_id = wait_for_run(run_id)
    if not dataset_id:
        print('❌ Apify ランが失敗しました')
        return

    items = fetch_results(dataset_id)
    print(f'取得データ: {len(items)} 件')

    ok = fail = 0
    for item in items:
        # shortcode を取得
        sc = item.get('shortCode') or item.get('shortcode') or ''
        if not sc:
            # URL から抽出
            url = item.get('url', '') or item.get('inputUrl', '')
            import re
            m = re.search(r'/p/([A-Za-z0-9_-]+)/', url)
            sc = m.group(1) if m else ''
        if not sc:
            continue

        # サムネ URL
        thumb = (item.get('displayUrl')
                 or item.get('thumbnailUrl')
                 or item.get('imageUrl')
                 or (item.get('images') or [None])[0]
                 or '')
        if not thumb:
            print(f'  ⚠ {sc}: サムネURL なし')
            fail += 1
            continue

        dest = OUT_DIR / f'{sc}.jpg'
        if dest.exists():
            ok += 1
            continue

        try:
            download_thumb(thumb, dest)
            print(f'  ✅ {sc}')
            ok += 1
        except Exception as e:
            print(f'  ❌ {sc}: {e}')
            fail += 1

    print(f'\n── 結果 ──────────────────────')
    print(f'✅ 成功: {ok} 件')
    print(f'❌ 失敗: {fail} 件')
    print(f'保存先: {OUT_DIR}')


if __name__ == '__main__':
    main()
