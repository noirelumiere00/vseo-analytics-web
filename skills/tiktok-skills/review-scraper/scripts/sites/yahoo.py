"""Yahoo!ショッピング（shopping.yahoo.co.jp）。

口コミ一覧 /review/item/list?store_id=<店舗>&page_key=<商品> の `__NEXT_DATA__` に
構造化データで入っている。同じ商品（カタログ）の全店舗分の口コミが `catalogReview` に、
その店舗の口コミが `itemReview` に入る。

**制約: ページに最初から載っているのはカタログ口コミの先頭20件まで。**
21件目以降はページ内部のAPIで後から読み込まれるため、このスクリプトでは取らない。
取得件数とサイト上の総数は両方とも記録し、黙って切らない。
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, quote, urlsplit

from common import SiteChanged, clean, make_review, next_data, to_date

NAME = "yahoo"
LABEL = "Yahoo!ショッピング"
RATING_SCALE = 5
LIST = "https://shopping.yahoo.co.jp/review/item/list"


def match_url(url):
    m = re.search(r"store\.shopping\.yahoo\.co\.jp/([^/]+)/([^/?#]+?)\.html", url)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    if "shopping.yahoo.co.jp/review/item/list" in url:
        q = parse_qs(urlsplit(url).query)
        if q.get("store_id") and q.get("page_key"):
            return f"{q['store_id'][0]}_{q['page_key'][0]}"
        if q.get("store_item_id"):
            return q["store_item_id"][0]
    return None


def _split(ref):
    store, _, key = ref.partition("_")
    return store, key


def list_url(ref):
    store, key = _split(ref)
    return f"{LIST}?store_id={quote(store)}&page_key={quote(key)}"


def _profile(r, name):
    for p in r.get("profiles") or []:
        if p.get("name") == name:
            return p.get("valueName")
    return None


def parse_list(text):
    d = next_data(text)
    try:
        pp = d["props"]["pageProps"]
    except (TypeError, KeyError):
        raise SiteChanged("Yahoo!の口コミページに __NEXT_DATA__ がありません（構造変化の可能性）")
    item = ((pp.get("lookupItemEntity") or {}).get("item") or {})
    cat = ((pp.get("reviewEntity") or {}).get("catalogReview") or {})
    own = ((pp.get("pickUpItemReviewEntity") or {}).get("itemReview") or {})
    raw, seen = [], set()
    for r in (cat.get("reviews") or []) + (own.get("reviews") or []):
        # id が無いと重複除去の鍵が全件 None になり、20件が1件に潰れる。
        # 件数が0にならないので構造変化にも気づけない。id の欠落は構造変化として止める
        if r.get("id") in (None, ""):
            raise SiteChanged("Yahoo!の口コミに id がありません（構造変化の可能性）")
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        raw.append(r)
    cat_total = (cat.get("reviewSummary") or {}).get("count")
    own_total = (own.get("reviewSummary") or {}).get("count")
    # `cat_total or own_total` だと表示「0件」が None（不明）に化けるので、読めた値の大きい方を使う
    totals = [x for x in (cat_total, own_total) if isinstance(x, int)]
    meta = {"name": item.get("name") or None,
            "site_total": max(totals) if totals else None,
            "jan": item.get("jan") or None}
    out = []
    for r in raw:
        attrs = {s["name"]: s.get("valueName") for s in (r.get("subReviews") or []) if s.get("name")}
        if r.get("sellerName"):
            attrs["購入店舗"] = r["sellerName"]
        age = _profile(r, "年代")
        out.append({
            "review_id": r.get("id"), "rating": r.get("rating"),
            "title": clean(r.get("title")) or None, "body": clean(r.get("body")),
            "posted_at": to_date(r.get("postedTime")),
            "age": age, "gender": _profile(r, "性別"),
            "helpful_count": r.get("referenceCount"),
            "attributes": attrs or None,
        })
    return meta, out


def parse_search(text):
    d = next_data(text) or {}
    hits = []

    def walk(o):
        if isinstance(o, dict):
            rv = o.get("review")
            if isinstance(rv, dict) and "count" in rv and o.get("url") and o.get("name"):
                hits.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(d)
    out, seen = [], set()
    for h in hits:
        ref = match_url(h["url"])
        if not ref or ref in seen:
            continue
        seen.add(ref)
        out.append({"site": NAME, "ref": ref, "name": clean(h["name"]),
                    "review_count": h["review"].get("count"), "url": list_url(ref)})
    return out


def search(fetcher, keyword, limit=5):
    text = fetcher.get(f"https://shopping.yahoo.co.jp/search/{quote(keyword)}/0/")
    rows = sorted(parse_search(text), key=lambda r: -(r["review_count"] or 0))
    return rows[:limit]


def collect(fetcher, ref, max_reviews=200, log=print, **_):
    url = list_url(ref)
    meta, rows = parse_list(fetcher.get(url))
    # 件数表示が読めない（None）ときも 0件を本物とみなさない（表示が 0 のときだけ受け入れる）
    if not rows and meta.get("site_total") != 0:
        total = meta["site_total"] if meta.get("site_total") is not None else "不明"
        raise SiteChanged(f"Yahoo!の口コミを読めませんでした（表示上は{total}件）")
    if (meta.get("site_total") or 0) > len(rows):
        log(f"  [NOTE] Yahoo!はページに載る先頭分のみ取得（{len(rows)}/{meta['site_total']}件）")
    meta.update({"site": NAME, "product_id": ref, "url": url})
    reviews = [make_review(site=NAME, product_id=ref, product_name=meta["name"],
                           product_url=url, rating_scale=RATING_SCALE, review_url=url,
                           body_truncated=False, **r)
               for r in rows[:max_reviews]]
    return meta, reviews
