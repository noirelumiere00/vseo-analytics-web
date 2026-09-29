"""楽天市場（review.rakuten.co.jp）。

口コミページ /item/1/<店舗ID>_<商品ID>/<頁>.1/ の `window.__INITIAL_STATE__` に
構造化データで入っている。見た目のクラス名（header--1B1vT 等）は変わりやすいので読まない。
評価は5段階。
"""
from __future__ import annotations

import re
import urllib.error
from urllib.parse import quote

from common import SiteChanged, clean, embedded_json, make_review, to_date

NAME = "rakuten"
LABEL = "楽天市場"
RATING_SCALE = 5
REVIEW = "https://review.rakuten.co.jp/item/1"
SEX = {"female": "女性", "male": "男性"}


def match_url(url):
    m = re.search(r"review\.rakuten\.co\.jp/item/1/(\d+_\d+)", url)
    if m:
        return m.group(1)
    if "item.rakuten.co.jp/" in url:
        return url          # 商品ページURL。取得時に口コミIDへ解決する
    return None


def _state(text):
    d = embedded_json(text, "window.__INITIAL_STATE__")
    if d is None:
        d = embedded_json(text, "__INITIAL_STATE__")
    return d


def parse_page(text):
    """1ページ分。(商品情報, 口コミ[]) を返す。__INITIAL_STATE__ が無ければ SiteChanged。"""
    d = _state(text)
    if not d or "reviews" not in d:
        raise SiteChanged("楽天の口コミページに __INITIAL_STATE__ がありません（構造変化の可能性）")
    info = d.get("itemInfo") or {}
    rr = info.get("reviewRatings") or {}
    meta = {"name": info.get("name"), "site_total": rr.get("totalCount"),
            "url": info.get("url")}
    data = (d["reviews"].get("data") or {})
    keys = ((d["reviews"].get("itemReviews") or {}).get("keys") or [])
    out = []
    for k in keys:
        r = data.get(k)
        if not r:
            continue
        age = f"{r['ageRange']}{r.get('ageSuffix') or '代'}" if r.get("ageRange") else None
        out.append({
            "review_id": k, "rating": r.get("rating"),
            "title": clean(r.get("title")) or None, "body": clean(r.get("body")),
            "posted_at": to_date(r.get("postDate")), "age": age,
            "gender": SEX.get(r.get("sex")), "helpful_count": r.get("helpfulCount"),
            "attributes": ({"用途": r["codes"]} if r.get("codes") else {})
                          | ({"注文日": to_date(r["orderDate"])} if r.get("orderDate") else {})
                          or None,
        })
    return meta, out


def parse_search(text):
    d = _state(text) or {}
    hits = []

    def walk(o):
        if isinstance(o, dict):
            rv = o.get("review")
            if isinstance(rv, dict) and "numReviews" in rv and o.get("name"):
                hits.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(d)
    out, seen = [], set()
    for h in hits:
        m = re.search(r"/item/1/(\d+_\d+)", h["review"].get("url") or "")
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        out.append({"site": NAME, "ref": m.group(1), "name": clean(h["name"]),
                    "review_count": h["review"].get("numReviews"),
                    "url": f"{REVIEW}/{m.group(1)}/1.1/"})
    return out


def search(fetcher, keyword, limit=5):
    text = fetcher.get(f"https://search.rakuten.co.jp/search/mall/{quote(keyword)}/")
    # 口コミ0件の商品は候補にしても空振りするので後ろに回す
    rows = sorted(parse_search(text), key=lambda r: -(r["review_count"] or 0))
    return rows[:limit]


def resolve(fetcher, ref):
    if re.fullmatch(r"\d+_\d+", ref):
        return ref
    text = fetcher.get(ref)
    m = re.search(r"review\.rakuten\.co\.jp/item/1/(\d+_\d+)", text)
    if not m:
        raise SiteChanged(f"楽天の商品ページから口コミページを特定できませんでした: {ref}")
    return m.group(1)


def collect(fetcher, ref, max_reviews=200, max_pages=None, log=print, **_):
    code = resolve(fetcher, ref)
    # 1ページ目は try の外で取る。ここでの 403・robots 禁止・404・通信エラー・構造変化を
    # 「0件」に化けさせず、呼び出し側に「アクセス拒否」「取得失敗」「構造変化」として記録させるため。
    meta, page_rows = parse_page(fetcher.get(f"{REVIEW}/{code}/1.1/"))
    total = meta.get("site_total")
    rows, seen, p = [], set(), 1
    while True:
        new = [r for r in page_rows if r["review_id"] not in seen]
        if not new:
            break
        for r in new:
            seen.add(r["review_id"])
            # 何ページ目の口コミかを残す（引用の出典を1ページ目ではなく実際の掲載ページにするため）
            r["review_url"] = f"{REVIEW}/{code}/{p}.1/"
            rows.append(r)
        # サイト表示の件数まで取れたら次のページは取りに行かない
        # （最終ページの先で何が返るかに頼らない。アクセスも1回減る）
        if len(rows) >= max_reviews or (isinstance(total, int) and len(rows) >= total):
            break
        if max_pages and p >= max_pages:
            log(f"  [NOTE] 楽天は {max_pages} ページで打ち切り（{len(rows)}件）")
            break
        p += 1
        try:
            _, page_rows = parse_page(fetcher.get(f"{REVIEW}/{code}/{p}.1/"))
        except urllib.error.HTTPError as e:
            if e.code == 404:   # 最終ページ超過
                break
            meta["incomplete"] = f"{p}ページ目で失敗（{len(rows)}件で中断）: HTTP {e.code}"
            break
        except Exception as e:  # noqa: BLE001
            # 拒否・通信エラー・メンテ画面など。終端と区別できないので黙って打ち切らず、
            # 取れた分は残したまま「途中で失敗」として呼び出し側に知らせる
            meta["incomplete"] = f"{p}ページ目で失敗（{len(rows)}件で中断）: {type(e).__name__}: {e}"
            break
    # 件数表示が読めない（None）ときも 0件を本物とみなさない。
    # 構造変化では件数と口コミ本体が同時に読めなくなるのが普通なので、表示が 0 のときだけ受け入れる。
    if not rows and total != 0:
        raise SiteChanged(f"楽天の口コミを読めませんでした（表示上は{total if total is not None else '不明'}件）")
    meta.update({"site": NAME, "product_id": code, "url": meta.get("url") or f"{REVIEW}/{code}/1.1/"})
    reviews = [make_review(site=NAME, product_id=code, product_name=meta["name"],
                           product_url=meta["url"], rating_scale=RATING_SCALE,
                           body_truncated=False, **r)
               for r in rows[:max_reviews]]
    return meta, reviews
