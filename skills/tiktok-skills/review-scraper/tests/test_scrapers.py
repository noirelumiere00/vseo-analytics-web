"""ネットワークを使わないテスト。python3 tests/test_scrapers.py

ページは各サイトの作りを写した合成ページ（実ページは同梱しない）。サイトの作りが変わって
読み方を直したときは、ここの合成ページも新しい作りに合わせて直す。
"""
import csv
import io
import json
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr
from pathlib import Path

sys.dont_write_bytecode = True   # Skill のフォルダに __pycache__ を残さない
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import collect  # noqa: E402
import common  # noqa: E402
from common import Blocked, SiteChanged, age_band, make_review, to_date  # noqa: E402
from sites import cosme, detect, rakuten, yahoo  # noqa: E402

B = "https://www.cosme.net"
R = "https://review.rakuten.co.jp/item/1"


# ── 合成ページ ──
def cosme_sec(rid, rating, age="27歳", truncated=False, body="とても良い"):
    rm = f'<span class="read-more"><a href="/reviews/{rid}/">続きを読む</a></span>' if truncated else ""
    return (f'<!-- reviewId: {rid} --><div class="review-sec">'
            f'<div class="reviewer-info"><ul><li>{age}</li><li>乾燥肌</li></ul></div>'
            f'<p class="reviewer-rating rating-{rating}">{rating}</p><span class="buy">購入品</span>'
            f'<p class="mobile-date">2026/9/11 16:12:37</p><p class="read">{body}{rm}</p>'
            f'<dl><dt>購入場所</dt><dd>ドラッグストア</dd></dl></div><!-- /review-sec -->')


def cosme_page(total, secs, title="【クチコミ12件】テスト美容液 / テストブランドの口コミ"):
    cnt = f'クチコミ&nbsp;<span class="count cnt">{total}</span>' if total is not None else ""
    return f"<html><head><title>{title}</title></head><body>{cnt}{''.join(secs)}</body></html>"


def rk(k, **kw):
    return {"k": k, "rating": 4, "title": "t", "body": "b", "postDate": "2026/03/08",
            "ageRange": 20, "sex": "female", "helpfulCount": 2, **kw}


def rakuten_page(total, reviews, name="テスト化粧水 200ml"):
    state = {"itemInfo": {"name": name, "url": "https://item.rakuten.co.jp/shop/item/",
                          "reviewRatings": {"totalCount": total} if total is not None else {}},
             "reviews": {"data": {r["k"]: {k: v for k, v in r.items() if k != "k"} for r in reviews},
                         "itemReviews": {"keys": [r["k"] for r in reviews]}}}
    return f"<script>window.__INITIAL_STATE__ = {json.dumps(state, ensure_ascii=False)};</script>"


def yr(i, **kw):
    return {"id": i, "rating": 5, "title": "t", "body": "b", "postedTime": "2026-09-01T10:00:00+09:00",
            "profiles": [{"name": "年代", "valueName": "30代"}], "referenceCount": 3, **kw}


def yahoo_page(cat, cat_total, own=None, own_total=None):
    pp = {"lookupItemEntity": {"item": {"name": "テスト乳液"}},
          "reviewEntity": {"catalogReview": {"reviews": cat, "reviewSummary": {"count": cat_total}}},
          "pickUpItemReviewEntity": {"itemReview": {"reviews": own or [], "reviewSummary": {"count": own_total}}}}
    return f'<script id="__NEXT_DATA__">{json.dumps({"props": {"pageProps": pp}}, ensure_ascii=False)}</script>'


class FakeFetcher:
    """URL → ページ文字列 または 例外。登録の無い URL は 404。"""

    def __init__(self, pages):
        self.pages, self.calls, self.requests = pages, [], 0

    def get(self, url):
        self.calls.append(url)
        self.requests += 1
        v = self.pages.get(url)
        if v is None:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        if isinstance(v, Exception):
            raise v
        return v


def quiet(*_):
    pass


# ── 共通部品 ──
class TestCommon(unittest.TestCase):
    def test_rating_5_is_affine(self):
        self.assertEqual([make_review(rating=r, rating_scale=7)["rating_5"] for r in (1, 4, 7)], [1.0, 3.0, 5.0])
        self.assertEqual(make_review(rating=3, rating_scale=5)["rating_5"], 3.0)
        z = make_review(rating=0, rating_scale=7)
        self.assertEqual((z["rating"], z["rating_5"]), (0, None))   # 範囲外は換算しない

    def test_age_band(self):
        self.assertEqual(age_band(15), age_band("10代"))
        self.assertEqual([age_band(27), age_band("70代以上"), age_band(None)], ["20代", "70代以上", None])

    def test_to_date(self):
        self.assertEqual(to_date(1757574757), "2025-09-11")       # 秒
        self.assertEqual(to_date(1757574757000), "2025-09-11")    # ミリ秒
        self.assertEqual(to_date("2026年9月11日"), "2026-09-11")
        self.assertEqual(to_date("2026/9/11 16:12:37"), "2026-09-11")
        self.assertIsNone(to_date("不明"))

    def test_robots_groups_and_wait(self):
        log = []
        robots = "User-agent: *\nUser-agent: Googlebot\nDisallow: /private/\n\nUser-agent: X\nDisallow: /\n"

        def raw(self, url):
            log.append(url)
            return (200, "text/plain", robots.encode()) if url.endswith("/robots.txt") else (200, "text/html", b"ok")
        f = common.Fetcher(delay=0, log=quiet)
        f._raw = raw.__get__(f)
        self.assertFalse(f.allowed("https://a.example/private/x"))
        self.assertTrue(f.allowed("https://a.example/public"))
        waits = []
        f2 = common.Fetcher(delay=0, log=quiet)
        f2._raw = raw.__get__(f2)
        f2._wait = waits.append
        f2.get("https://b.example/p")
        self.assertEqual(waits, ["b.example", "b.example"])      # robots.txt も間隔制御を通る

    def test_retry_on_connection_reset(self):
        n = []

        def raw(self, url):
            if url.endswith("/robots.txt"):
                return 200, "text/plain", b""
            n.append(url)
            if len(n) == 1:
                raise ConnectionResetError(104, "reset")
            return 200, "text/html", b"ok"
        f = common.Fetcher(delay=0, log=quiet)
        f._raw = raw.__get__(f)
        self.assertEqual(f.get("https://c.example/p"), "ok")
        self.assertEqual(len(n), 2)

    def test_detect_uses_hostname(self):
        self.assertIs(detect("https://item.rakuten.co.jp/shop/x/?ref=amazon.co.jp")[0], rakuten)
        self.assertIsNone(detect("https://www.amazon.co.jp/dp/B000")[0])
        self.assertIsNone(detect("https://lipscosme.com/products/1")[0])


# ── サイトごと ──
class TestCosme(unittest.TestCase):
    def test_collect_with_full_text(self):
        f = FakeFetcher({f"{B}/products/1/review/": cosme_page(3, [cosme_sec("101", 7, truncated=True, body="途中"),
                                                                   cosme_sec("102", 1, age="15歳")]),
                         f"{B}/products/1/review/?page=2": cosme_page(3, [cosme_sec("103", 4)]),
                         f"{B}/reviews/101/": cosme_page(3, [cosme_sec("101", 7, body="全文です")])})
        meta, rs = cosme.collect(f, "1", log=quiet)
        self.assertEqual((meta["site_total"], len(rs), meta.get("incomplete")), (3, 3, None))
        self.assertEqual((rs[0]["body"], rs[0]["body_truncated"]), ("全文です", False))
        self.assertEqual([r["rating_5"] for r in rs], [5.0, 1.0, 3.0])

    def test_unreadable_page_is_site_changed_even_without_count(self):
        f = FakeFetcher({f"{B}/products/2/review/": "<html><title>X の口コミ</title><div class='v2'></div></html>"})
        with self.assertRaises(SiteChanged):
            cosme.collect(f, "2", log=quiet)

    def test_zero_shown_by_site_is_accepted(self):
        meta, rs = cosme.collect(FakeFetcher({f"{B}/products/3/review/": cosme_page(0, [])}), "3", log=quiet)
        self.assertEqual((meta["site_total"], rs), (0, []))

    def test_page2_blocked_is_incomplete(self):
        f = FakeFetcher({f"{B}/products/4/review/": cosme_page(25, [cosme_sec(str(i), 5, truncated=True)
                                                                    for i in range(10)]),
                         f"{B}/products/4/review/?page=2": Blocked("HTTP 403")})
        meta, rs = cosme.collect(f, "4", full_text=True, log=quiet)
        self.assertEqual(len(rs), 10)
        self.assertIn("2ページ目で失敗", meta["incomplete"])
        self.assertFalse([u for u in f.calls if "/reviews/" in u])   # 拒否されたら全文を取りに行かない
        self.assertTrue(all(r["body_truncated"] for r in rs))


class TestRakuten(unittest.TestCase):
    def test_collect_pages_and_review_url(self):
        f = FakeFetcher({f"{R}/1_2/1.1/": rakuten_page(3, [rk("a"), rk("b", codes=["自分用"])]),
                         f"{R}/1_2/2.1/": rakuten_page(3, [rk("c", ageRange=None, sex=None)])})
        meta, rs = rakuten.collect(f, "1_2", log=quiet)
        self.assertEqual([r["review_id"] for r in rs], ["a", "b", "c"])
        self.assertEqual(rs[2]["review_url"], f"{R}/1_2/2.1/")
        self.assertEqual((rs[0]["age"], rs[0]["gender"], rs[2]["age"]), ("20代", "女性", None))
        self.assertEqual(len(f.calls), 2)          # 表示件数まで取れたら次のページへ行かない

    def test_page1_errors_are_not_zero(self):
        for exc in (Blocked("HTTP 403"), urllib.error.URLError("timed out")):
            with self.assertRaises(type(exc)):
                rakuten.collect(FakeFetcher({f"{R}/9_9/1.1/": exc}), "9_9", log=quiet)
        with self.assertRaises(urllib.error.HTTPError):
            rakuten.collect(FakeFetcher({}), "8_8", log=quiet)

    def test_zero_rows_without_count_is_site_changed(self):
        with self.assertRaises(SiteChanged):
            rakuten.collect(FakeFetcher({f"{R}/3_3/1.1/": rakuten_page(None, [])}), "3_3", log=quiet)
        meta, rs = rakuten.collect(FakeFetcher({f"{R}/4_4/1.1/": rakuten_page(0, [])}), "4_4", log=quiet)
        self.assertEqual(rs, [])

    def test_page2_unreadable_keeps_rows(self):
        f = FakeFetcher({f"{R}/5_5/1.1/": rakuten_page(40, [rk(str(i)) for i in range(30)]),
                         f"{R}/5_5/2.1/": "<html>maintenance</html>"})
        meta, rs = rakuten.collect(f, "5_5", log=quiet)
        self.assertEqual(len(rs), 30)
        self.assertIn("SiteChanged", meta["incomplete"])

    def test_no_fixed_page_cap(self):
        pages = {f"{R}/4_4/{p}.1/": rakuten_page(1800, [rk(f"{p}-{i}") for i in range(15)]) for p in range(1, 121)}
        meta, rs = rakuten.collect(FakeFetcher(pages), "4_4", max_reviews=5000, log=quiet)
        self.assertEqual(len(rs), 1800)


class TestYahoo(unittest.TestCase):
    ref = "sundrugec_4987241168583"

    def test_collect_and_dedupe(self):
        url = yahoo.list_url(self.ref)
        f = FakeFetcher({url: yahoo_page([yr("r1"), yr("r2")], 57, own=[yr("r1"), yr("r3")], own_total=2)})
        logs = []
        meta, rs = yahoo.collect(f, self.ref, log=logs.append)
        self.assertEqual([r["review_id"] for r in rs], ["r1", "r2", "r3"])
        self.assertEqual(meta["site_total"], 57)
        self.assertTrue(logs)                        # 全件でないことを知らせる

    def test_missing_id_is_site_changed(self):
        url = yahoo.list_url(self.ref)
        with self.assertRaises(SiteChanged):
            yahoo.collect(FakeFetcher({url: yahoo_page([yr(None, reviewId="x")], 5)}), self.ref, log=quiet)

    def test_zero(self):
        url = yahoo.list_url(self.ref)
        meta, rs = yahoo.collect(FakeFetcher({url: yahoo_page([], 0)}), self.ref, log=quiet)
        self.assertEqual((meta["site_total"], rs), (0, []))
        page = yahoo_page([], 5).replace("reviewEntity", "reviewListEntity")
        with self.assertRaises(SiteChanged):
            yahoo.collect(FakeFetcher({url: page}), self.ref, log=quiet)


# ── 入口（collect.py）──
def run_main(pages, argv):
    fake = FakeFetcher(pages)
    orig, orig_argv = collect.Fetcher, sys.argv
    collect.Fetcher = lambda **kw: fake
    sys.argv = ["collect.py"] + argv
    try:
        with redirect_stderr(io.StringIO()):
            collect.main()
        return 0
    except SystemExit as e:
        return e.code
    finally:
        collect.Fetcher, sys.argv = orig, orig_argv


class TestCollect(unittest.TestCase):
    def test_partial_and_blocked_stop_with_exit_2(self):
        with tempfile.TemporaryDirectory() as d:
            code = run_main({f"{B}/products/1/review/": cosme_page(25, [cosme_sec(str(i), 6) for i in range(10)]),
                             f"{B}/products/1/review/?page=2": Blocked("HTTP 403"),
                             f"{R}/9_9/1.1/": Blocked("HTTP 403")},
                            ["--url", f"{B}/products/1/", "--url", f"{R}/9_9/1.1/", "--out", d, "--no-full-text"])
            log = json.loads((Path(d) / "acquire_log.json").read_text(encoding="utf-8"))
            self.assertEqual(code, 2)
            self.assertEqual([p["status"] for p in log["products"]], ["途中で失敗（取れた分のみ）", "アクセス拒否"])
            self.assertEqual(log["total_reviews"], 10)

    def test_duplicates_csv_guard_and_summary(self):
        evil = '=HYPERLINK("http://evil.example","x")'
        pages = {f"{R}/1_2/1.1/": rakuten_page(2, [rk("a", title=evil), rk("b")], name="テスト | 化粧水"),
                 "https://item.rakuten.co.jp/shop/abc/": '<a href="https://review.rakuten.co.jp/item/1/1_2/1.1/">'}
        with tempfile.TemporaryDirectory() as d:
            code = run_main(pages, ["--url", f"{R}/1_2/1.1/", "--url", "https://item.rakuten.co.jp/shop/abc/",
                                    "--out", d])
            with (Path(d) / "reviews.csv").open(encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
            js = [json.loads(x) for x in (Path(d) / "reviews.jsonl").read_text(encoding="utf-8").splitlines()]
            summary = (Path(d) / "summary.md").read_text(encoding="utf-8")
        self.assertEqual(code, 0)
        self.assertEqual([r["review_id"] for r in rows], ["a", "b"])       # 同じ商品は1回だけ
        self.assertEqual((rows[0]["title"], js[0]["title"]), ("'" + evil, evil))
        self.assertIn("テスト \\| 化粧水", summary)
        self.assertIn("| 4.0 / 5 | 4.0 |", summary)
        self.assertIn("重複", summary)

    def test_failed_search_is_logged(self):
        orig = {m: m.search for m in (cosme, rakuten, yahoo)}

        def boom(f, kw, limit=5):
            raise Blocked("robots.txt で禁止されています")
        try:
            for m in orig:
                m.search = boom
            with tempfile.TemporaryDirectory() as d:
                code = run_main({}, ["--keyword", "テスト", "--out", d])
                log = json.loads((Path(d) / "acquire_log.json").read_text(encoding="utf-8"))
        finally:
            for m, s in orig.items():
                m.search = s
        self.assertEqual(code, 2)
        self.assertEqual([s["status"] for s in log["searches"]], ["アクセス拒否"] * 3)


if __name__ == "__main__":
    unittest.main(verbosity=1)
