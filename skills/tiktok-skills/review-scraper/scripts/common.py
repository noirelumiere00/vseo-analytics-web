"""口コミ取得の共通部品。標準ライブラリだけで書く（どのOSでも pip 不要で動かすため）。"""
from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ja",
}

# 全サイト共通の出力列。サイトに無い項目は None のまま残す（0 や "" で埋めない）。
FIELDS = [
    "site", "product_id", "product_name", "product_url",
    "review_id", "review_url", "rating", "rating_scale", "rating_5",
    "title", "body", "body_truncated", "posted_at",
    "age", "age_band", "gender", "skin_type", "purchase", "attributes",
    "helpful_count", "fetched_at",
]


class SiteChanged(Exception):
    """ページは取れたのに口コミが読めない。サイトの構造が変わった可能性が高い。"""


class Blocked(Exception):
    """robots.txt で禁止されている、またはサイト側が自動アクセスを拒否している。"""


def now_iso():
    return datetime.now(JST).isoformat(timespec="seconds")


def clean(s):
    """HTML断片を1行のテキストにする。"""
    s = re.sub(r"<br\s*/?>", "\n", s or "", flags=re.I)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    lines = [re.sub(r"[ \t　]+", " ", x).strip() for x in s.split("\n")]
    return "\n".join(x for x in lines if x).strip()


def to_date(s):
    """'2026/9/11 16:12:37' / '2026/03/08' / ミリ秒 → 'YYYY-MM-DD'。読めなければ None。"""
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / 1000, JST).strftime("%Y-%m-%d")
    m = re.search(r"(20\d\d)[/.-](\d{1,2})[/.-](\d{1,2})", str(s))
    if not m:
        return None
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


def age_band(age):
    """27 / '27歳' / '20代' / '70代以上' → '20代'。サイトをまたいで年代を比べるため。"""
    if age is None or age == "":
        return None
    s = str(age)
    m = re.match(r"(\d+)\s*代", s)
    if m:
        return f"{m.group(1)}代" + ("以上" if "以上" in s else "")
    m = re.match(r"(\d+)", s)
    if m:
        n = int(m.group(1))
        return "10代以下" if n < 20 else f"{n // 10 * 10}代"
    return None


def make_review(**kw):
    r = {k: None for k in FIELDS}
    r.update(kw)
    if r["rating"] is not None and r["rating_scale"]:
        r["rating_5"] = round(float(r["rating"]) * 5 / float(r["rating_scale"]), 2)
    r["age_band"] = age_band(r["age"])
    r["fetched_at"] = r["fetched_at"] or now_iso()
    return r


def embedded_json(text, marker):
    """`marker = {...}` 形式でページに埋め込まれた JSON を取り出す。"""
    i = text.find(marker)
    if i < 0:
        return None
    j = text.find("{", i)
    if j < 0:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(text[j:])
    except json.JSONDecodeError:
        return None
    return obj


def next_data(text):
    """Next.js の <script id="__NEXT_DATA__"> を取り出す。"""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def _decode(raw, content_type):
    cs = None
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    if m:
        cs = m.group(1)
    if not cs:
        m = re.search(rb'charset=["\']?([\w-]+)', raw[:4096], re.I)
        if m:
            cs = m.group(1).decode("ascii", "ignore")
    if cs and cs.lower().replace("_", "-") in ("shift-jis", "sjis", "x-sjis", "windows-31j"):
        cs = "cp932"   # Shift_JIS の上位互換。機種依存文字で化けない
    for c in (cs, "utf-8", "cp932"):
        if not c:
            continue
        try:
            return raw.decode(c)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


class Fetcher:
    """礼儀を守って取る。ホストごとの間隔・robots.txt・リトライをここに集める。"""

    def __init__(self, delay=1.5, timeout=30, retries=3, log=None):
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.log = log or (lambda msg: print(msg, file=sys.stderr, flush=True))
        self._last = {}
        self._robots = {}
        self.requests = 0

    def _wait(self, host):
        last = self._last.get(host)
        if last is not None:
            gap = self.delay - (time.monotonic() - last)
            if gap > 0:
                time.sleep(gap)
        self._last[host] = time.monotonic()

    def _raw(self, url):
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=self.timeout) as f:
            return f.status, f.headers.get("Content-Type", ""), f.read()

    def _disallows(self, host):
        """robots.txt の `User-agent: *` 節の Disallow 一覧。無ければ空（＝制限なし）。"""
        if host in self._robots:
            return self._robots[host]
        rules = []
        try:
            status, ctype, raw = self._raw(f"https://{host}/robots.txt")
            text = _decode(raw, ctype)
            # robots.txt の代わりに通常のHTMLページが返るサイトがある（楽天レビュー）。
            # それは「robots.txt が無い」扱いにする。
            if status == 200 and not text.lstrip().lower().startswith(("<!doctype", "<html")):
                applies = False
                for line in text.splitlines():
                    line = line.split("#", 1)[0].strip()
                    if not line or ":" not in line:
                        continue
                    k, v = (x.strip() for x in line.split(":", 1))
                    if k.lower() == "user-agent":
                        applies = (v == "*")
                    elif k.lower() == "disallow" and applies and v:
                        rules.append(v)
        except urllib.error.HTTPError:
            pass      # 404 等は robots.txt 無し＝制限なし
        except Exception as e:  # noqa: BLE001
            self.log(f"[WARN] {host} の robots.txt を確認できませんでした（{e}）")
        self._robots[host] = rules
        return rules

    def allowed(self, url):
        p = urllib.parse.urlsplit(url)
        path = p.path + (("?" + p.query) if p.query else "")
        for rule in self._disallows(p.netloc):
            pat = "^" + re.escape(rule).replace(r"\*", ".*")
            if pat.endswith(r"\$"):
                pat = pat[:-2] + "$"
            if re.match(pat, path):
                return False
        return True

    def get(self, url):
        if not self.allowed(url):
            raise Blocked(f"robots.txt で禁止されています: {url}")
        host = urllib.parse.urlsplit(url).netloc
        err = None
        for attempt in range(self.retries):
            self._wait(host)
            try:
                self.requests += 1
                status, ctype, raw = self._raw(url)
                return _decode(raw, ctype)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    raise
                if e.code == 403:
                    raise Blocked(f"サイトが自動アクセスを拒否しました（HTTP 403）: {url}") from e
                err = e
                if e.code in (429, 500, 502, 503, 504):
                    time.sleep(self.delay * (attempt + 2) * 2)
                    continue
                raise
            except (urllib.error.URLError, TimeoutError) as e:
                err = e
                time.sleep(self.delay * (attempt + 2))
        raise err
