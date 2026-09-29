"""@cosme（www.cosme.net）。

一覧 /products/<id>/review/?page=N は1ページ10件で、本文は途中で切れている
（「続きを読む」）。切れているものだけ個別ページ /reviews/<id>/ を取りに行く。
一覧と個別は同じ `review-sec` ブロックなので、読み方は1つでよい。
評価は7段階（0〜7）。
"""
from __future__ import annotations

import re

from common import SiteChanged, clean, make_review, to_date

NAME = "cosme"
LABEL = "@cosme"
RATING_SCALE = 7
BASE = "https://www.cosme.net"

SKIN = ("乾燥肌", "脂性肌", "混合肌", "普通肌", "敏感肌", "アトピー")


def match_url(url):
    m = re.search(r"cosme\.net/products/(\d+)", url)
    if m:
        return m.group(1)
    return None


def product_url(pid):
    return f"{BASE}/products/{pid}/"


# ── 読み方（ネットワークを使わない。テストはここを叩く）──
def parse_product(text):
    m = re.search(r"<title>(.*?)</title>", text, re.S)
    name = None
    if m:
        t = clean(m.group(1))
        t = re.sub(r"^【クチコミ[\d,]+件】", "", t)
        name = re.split(r"の口コミ", t)[0].strip() or None
    c = re.search(r'クチコミ(?:&nbsp;|\s)*<span class="count cnt">([\d,]+)</span>', text)
    total = int(c.group(1).replace(",", "")) if c else None
    return {"name": name, "site_total": total}


def parse_sections(text):
    """review-sec ブロックを読む。一覧でも個別ページでも使える。"""
    out = []
    for rid, blk in re.findall(r"<!-- reviewId: (\d+) -->(.*?)<!-- /review-sec -->", text, re.S):
        info = re.search(r'<div class="reviewer-info">(.*?)</div>', blk, re.S)
        items = [clean(x) for x in re.findall(r"<li>(.*?)</li>", info.group(1), re.S)] if info else []
        age = next((int(x[:-1]) for x in items if re.fullmatch(r"\d{1,3}歳", x)), None)
        skin = next((x for x in items if x in SKIN), None)
        rt = re.search(r'<p class="reviewer-rating[^"]*">\s*(\d)', blk)
        buy = re.search(r'<span class="buy">([^<]+)</span>', blk)
        # 日付のクラスは口コミによって mobile-date と date の2種類ある（実測）
        date = re.search(r'class="(?:mobile-)?date">([^<]+)<', blk)
        read = re.search(r'<p class="read">(.*?)</p>', blk, re.S)
        body_html = read.group(1) if read else ""
        truncated = "read-more" in body_html
        body_html = re.sub(r'<span class="read-more">.*?</span>', "", body_html, flags=re.S)
        attrs = {}
        for dt, dd in re.findall(r"<dt>(購入場所|効果|関連ワード)</dt>\s*<dd>(.*?)</dd>", blk, re.S):
            v = clean(dd)
            if v and v != "-":
                attrs[dt] = v
        out.append({
            "review_id": rid, "rating": int(rt.group(1)) if rt else None,
            "purchase": clean(buy.group(1)) if buy else None,
            "posted_at": to_date(date.group(1)) if date else None,
            "age": age, "skin_type": skin, "body": clean(body_html),
            "body_truncated": truncated, "attributes": attrs or None,
        })
    return out


def parse_search(text):
    seen, out = set(), []
    for pid, alt in re.findall(
            r'href="https://www\.cosme\.net/products/(\d+)/"[^>]*>\s*<img[^>]*alt="\(([^"]*?) 商品情報\)"', text):
        if pid in seen:
            continue
        seen.add(pid)
        out.append({"site": NAME, "ref": pid, "name": clean(alt), "review_count": None,
                    "url": product_url(pid)})
    return out


def parse_brand_links(text):
    """総合検索の「◯◯ ブランド情報」から ブランドID を拾う。"""
    return list(dict.fromkeys(re.findall(
        r'href="https://www\.cosme\.net/brands/(\d+)/"[^>]*>[^<]*ブランド情報', text)))


def parse_brand_products(text):
    """ブランドの商品一覧 /brands/<id>/product/ を読む（クチコミ件数つき）。"""
    out = []
    for blk in re.split(r'<div class="productInformation">', text)[1:]:
        m = re.search(r'href="https://www\.cosme\.net/products/(\d+)/"\s*>\s*<img[^>]*alt="([^"]+)"', blk)
        if not m:
            continue
        c = re.search(r'class="count">([\d,]+)</a>件', blk)
        out.append({"site": NAME, "ref": m.group(1), "name": clean(m.group(2)),
                    "review_count": int(c.group(1).replace(",", "")) if c else None,
                    "url": product_url(m.group(1))})
    return out


def _score(name, keyword):
    import unicodedata
    n = unicodedata.normalize("NFKC", name).lower().replace(" ", "")
    toks = [unicodedata.normalize("NFKC", t).lower() for t in keyword.split() if t.strip()]
    return sum(1 for t in toks if t in n)


# ── 取得 ──
def search(fetcher, keyword, limit=5):
    """総合検索で商品が出ればそれを使う。出なければブランドの商品一覧から選ぶ。

    @cosme の総合検索は記事・ランキング中心で、「メラノCC 美容液」のような
    ブランド＋種類の語では商品が1件も出ないことがある（実測）。
    その場合でも検索結果に「ブランド情報」は出るので、そこから商品一覧を引く。
    """
    from urllib.parse import quote
    text = fetcher.get(f"{BASE}/search?fw={quote(keyword)}")
    rows = parse_search(text)
    if len(rows) < limit:
        for bid in parse_brand_links(text)[:2]:
            try:
                rows += parse_brand_products(fetcher.get(f"{BASE}/brands/{bid}/product/"))
            except Exception:  # noqa: BLE001
                continue
    seen, uniq = set(), []
    for r in rows:
        if r["ref"] not in seen:
            seen.add(r["ref"])
            uniq.append(r)
    uniq.sort(key=lambda r: (-_score(r["name"], keyword), -(r["review_count"] or 0)))
    return [r for r in uniq if _score(r["name"], keyword) > 0][:limit] or uniq[:limit]


def collect(fetcher, pid, max_reviews=200, full_text=True, log=print):
    first = fetcher.get(f"{BASE}/products/{pid}/review/")
    meta = parse_product(first)
    meta.update({"site": NAME, "product_id": pid, "url": product_url(pid)})
    rows, seen, page, text = [], set(), 1, first
    while len(rows) < max_reviews:
        secs = parse_sections(text)
        if not secs:
            # 口コミがある商品なのに1件も読めない＝構造変化。0件扱いにしない。
            if page == 1 and (meta["site_total"] or 0) > 0:
                raise SiteChanged(f"@cosme の口コミ一覧を読めませんでした（表示上は{meta['site_total']}件）")
            break
        new = [s for s in secs if s["review_id"] not in seen]
        if not new:
            break
        for s in new:
            seen.add(s["review_id"])
            rows.append(s)
        page += 1
        try:
            text = fetcher.get(f"{BASE}/products/{pid}/review/?page={page}")
        except Exception:  # 最終ページ超過は404
            break
    rows = rows[:max_reviews]
    if full_text:
        for i, s in enumerate(rows):
            if not s["body_truncated"]:
                continue
            try:
                full = parse_sections(fetcher.get(f"{BASE}/reviews/{s['review_id']}/"))
            except Exception as e:  # noqa: BLE001
                log(f"  [WARN] @cosme 個別ページ {s['review_id']} を取れませんでした（{e}）")
                continue
            hit = next((x for x in full if x["review_id"] == s["review_id"]), None)
            if hit and hit["body"]:
                s["body"], s["body_truncated"] = hit["body"], False
                s["attributes"] = hit["attributes"] or s["attributes"]
            if (i + 1) % 20 == 0:
                log(f"  @cosme 全文 {i + 1}/{len(rows)}")
    reviews = [make_review(site=NAME, product_id=pid, product_name=meta["name"],
                           product_url=meta["url"], rating_scale=RATING_SCALE,
                           review_url=f"{BASE}/reviews/{s['review_id']}/", **s)
               for s in rows]
    return meta, reviews
