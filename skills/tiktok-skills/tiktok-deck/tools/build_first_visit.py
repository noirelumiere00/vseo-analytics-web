#!/usr/bin/env python3
"""build_first_visit.py — 初訪資料（本編 最大8枚＋付録2枚）の中身を first_visit.json に組む

初訪資料の設計（2026-09 上長FBで作り直し）:
  狙う感情:「この人たちは競合も市場もちゃんと見てきている。話を聞きたい」
  ストーリー: P2 いま検索するとこう見える → P3 競合はこう発信している
              → P4 競合がお金をかけて広げている訴求 → P5 {client}に足りていない発信
              → P6 いま伸びている型（お土産）→ P7 まずこの3本 → P8 次回
  軸は2本だけ: カテゴリで伸びている投稿／競合のコミュニケーション。
  自社ブランドの説明はしない（相手が一番よく知っている）。紙面で「自社」と書かない。
  1枚＝実画像＋ワンフレーズ。手法・定義・フォロワー帯は付録（2枚まで）。

規律:
  - 数値はすべてここで計算する。レンダラ（src/slides/firstVisit.js）は並べるだけ
  - 使うのは labels.json で判定済みの投稿だけ。窓内が未判定なら作らない（部分的な資料は作らない）
  - 例に載せるのは、その軸で「関連」と判定し、カバー画像がある投稿だけ
  - 文言は語彙＋数値のテンプレ。候補を上から試し、上限に収まる最初のものを使う。全部超えたら止める
  - 主張には最低本数がある（下の CLAIM）。満たさなければ言わない・ページを落とす
  - ページが落ちるのはエラー（競合PRページだけは P3 に吸収するので例外）。許すなら case.json first_visit.allow_drop

使い方:
  python3 tools/build_first_visit.py --case <案件ディレクトリ>
  python3 tools/build_first_visit.py --case . --list-copy       # 見出しの別案（fv_copy.json で番号を選べる）
  python3 tools/build_first_visit.py --case . --dry-run --json  # 何も書かずにページの成否だけ（gaps.py 用）
出力:
  first_visit.json / FV_ASSETS.md（verify_assets.py 用）
  review/初訪_レビュー.html（前日レビュー: 掲載投稿ごとに OK／差し替え）/ review/初訪_前日チェック.md
  review/初訪_掲載サムネ一覧.jpg（Pillow がある場合）
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import html
import io
import json
import os
import re
import statistics as st
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fvlib import (LIMITS, RESERVED, assert_clean, load_axis, load_case, load_json,  # noqa: E402
                   load_vocab, official_ids, order_is_display, sha256_file, short_of,
                   views_label, width_units, is_domestic_lang, safe_vid, to_epoch)
from label_posts import axes_of, axis_key, poster_from, validate  # noqa: E402

# 主張の基準。付録にもこの表をそのまま出す（言ってよいことを担当者の判断にしない）
CLAIM = {
    "now_angle_share": 0.30, "now_angle_k": 4,       # 現状の見出しで「上位は“X”投稿」と言う条件
    "strong": 0.70, "center": 0.50,                  # 「ばかり」「が中心」の閾値。それ未満は「が多い」
    "col_min_n": 3, "col_share_n": 5,                # 競合列を出す／比率を出す関連本数
    "col_top_share": 0.30, "col_top_k": 2,           # 競合の「主な切り口・訴求」と言う条件
    "paid_min": 3, "paid_major": 0.50,               # 競合PRを独立ページにする条件
    "gap_own_n": 5, "gap_heat": 0.15, "gap_k": 2,    # 「{client}はまだ0本」と言う条件
    "win_k": 3, "win_authors": 2, "win_lift": 1.5,   # 「伸びている型」と言う条件
    "min_views": 1000, "recent_days": 365, "recent_min": 10,
    "foreign_max": 0.30,                             # 主カテゴリの上位20本で外国語がこれを超えたら止める
}
MAX_USE = 2           # 同じ投稿を資料全体で使ってよい回数（preflight の「使い回し」と同じ考え）
# 論理ページ番号（例示の割り当てと「3ページ連続禁止」に使う）。紙面・レビュー・FV_ASSETS の番号は
# 実際の並び（P4 が落ちれば詰める）で振り直す → phys_pages()
PAGE_NO = {"now": 2, "competitors": 3, "paid": 4, "gap": 5, "winning": 6, "plans": 7, "next": 8}
PAGE_ORDER = ("now", "competitors", "paid", "gap", "winning", "plans", "next")
DROPPABLE = {"competitors", "gap", "winning", "plans", "next"}   # now は資料の入口なので落とせない
# 「検索するとこう見える」に置いてよいカバーの取得経路（検索画面のカバーそのもの）。
# frame（動画のコマ）や existing（経路不明）は検索画面の見え方ではないので置かない
SEARCH_VIEW_VIA = {"coverUrl", "oembed", "photo"}
# 自由記述で機械の値と照合できない数量表現（漢数字・割合語）
QUANTITY_WORDS = re.compile(r"[一二三四五六七八九十百千万]+\s*[割本%％倍人社件]|半数|大半|過半|ほとんど|すべて|全部|大多数")


def phys_pages(order) -> dict:
    """ページ id → 紙面の番号（表紙=1、本編は order の順に2から）"""
    return {k: i + 2 for i, k in enumerate(order)}


def jl(s) -> float:
    return width_units(s)


def fmt_date(s: str | None) -> str:
    if not s:
        return ""
    try:
        d = dt.date.fromisoformat(str(s)[:10])
        return f"{d.year}年{d.month}月{d.day}日"
    except ValueError:
        return str(s)


class Stop(SystemExit):
    pass


class Usage:
    """例示の割り当て。同じ投稿は MAX_USE 回まで・3ページ連続は禁止・1ページに同じ作者は1回"""

    def __init__(self):
        self.pages: dict[str, list[int]] = {}
        self.authors: dict[int, set] = {}
        self.sha_seen: dict[str, str] = {}

    def ok(self, p, page: int) -> bool:
        vid = p["video_id"]
        used = self.pages.get(vid, [])
        if len(used) >= MAX_USE or page in used:
            return False
        if (page - 1 in used and page - 2 in used) or (page - 1 in used and page + 1 in used):
            return False
        au = (p.get("author") or "").lower()
        if au and au in self.authors.get(page, set()):
            return False
        return True

    def use(self, p, page: int):
        self.pages.setdefault(p["video_id"], []).append(page)
        self.authors.setdefault(page, set()).add((p.get("author") or "").lower())


class Builder:
    def __init__(self, case_dir: str, dry: bool = False):
        self.case_dir = case_dir
        self.dry = dry
        self.cfg = load_case(case_dir)
        self.vocab = load_vocab(self.cfg, case_dir, required=True)
        self.warnings: list[str] = []
        self.blocking: list[str] = []
        self.status: dict[str, tuple[str, str]] = {}
        lp = os.path.join(case_dir, "labels.json")
        if not os.path.exists(lp):
            raise Stop("[致命的] labels.json がありません。\n"
                       "  label_posts.py --case . --init → --contact → --apply → --check の順に実行してください")
        self.labels = load_json(lp)
        errs, warns, _ = validate(case_dir, self.cfg, self.vocab, self.labels)
        self.blocking += errs
        self.warnings += warns
        # 投稿IDはパスと HTML に使う。数字以外（手で直した labels.json 等）は扱わない
        bad = [str(p.get("video_id"))[:40] for p in self.labels["posts"] if not safe_vid(p.get("video_id"))]
        if bad:
            self.blocking.append(f"labels.json に数字でない投稿IDがあります: {bad[:5]}")
        self.posts = [p for p in self.labels["posts"] if safe_vid(p.get("video_id"))]
        self._sha_cache: dict[str, str | None] = {}
        self.A = {e["id"]: e for e in self.vocab["angles"]}
        self.P = {e["id"]: e for e in self.vocab["appeals"]}
        mp = os.path.join(case_dir, "assets", "covers", "manifest.json")
        self.manifest = load_json(mp) if os.path.exists(mp) else {}
        self.copy = self._load_copy()
        self.manual = []           # 手修正（自由記述）の記録
        self.usage = Usage()
        self.axes = axes_of(self.cfg)
        brands = self.cfg.get("brands") or []
        self.own = next((b for b in brands if b.get("own")), None)
        self.comps = [b for b in brands if not b.get("own")][:4]
        cl = self.cfg.get("client") or {}
        self.client = cl.get("short") or (self.own and self.own.get("short")) or cl.get("client_name") \
            or (self.own or {}).get("name") or "貴社"
        kws = self.cfg.get("keywords") or []
        self.kw = next((k for k in kws if k.get("primary")), kws[0] if kws else None)
        if not self.kw:
            raise Stop("[致命的] 初訪にはカテゴリの検索（case.json の keywords）が要ります")
        self.query = self.kw.get("query") or self.kw["name"]
        # 見出しに入れる検索語。複数語の長い検索語は keywords[].label に短い表示名を書ける
        self.qlabel = self.kw.get("label") or self.query
        self.category = self.cfg.get("category") or self.kw["name"]
        self.products = [p for p in (self.cfg.get("focus_products") or []) if p][:3]
        self._check_axes()
        # 取得日: case.json の acquired_on → 取得JSONの fetched_on（search.mjs が書く）。
        # どちらも無ければ本編には日付を出さず「直近1年」の絞り込みもしない。ファイルの更新日時は
        # コピー・展開・checkout で変わるので、付録に「参考」として出すだけにする
        self.acquired_on = self.cfg.get("acquired_on") or self._fetched_on()
        self.acquired_ref = None
        if not self.acquired_on:
            f = os.path.join(case_dir, self.kw["file"])
            if os.path.exists(f):
                self.acquired_ref = dt.date.fromtimestamp(os.path.getmtime(f)).isoformat()
            self.warnings.append("取得日が分かりません（case.json の acquired_on も取得JSONの fetched_on も無い）。"
                                 "本編の日付と「直近1年」の絞り込みを外しました。acquired_on に取得日を書いてください")
        # 投稿者の種類は今の case.json（公式ID・メディア一覧）で数え直す。--init の後に公式IDを直すと、
        # 公式露出の数（取得JSONから数える）と P2 の内訳・カードの「公式」が食い違ったため
        for p in self.posts:
            p["poster"], p["official_brand"] = poster_from(p.get("author"), bool(p.get("is_pr")),
                                                           p.get("followers"), self.cfg)
            p["create_time"] = to_epoch(p.get("create_time"))

    # ─────────────── 入力
    def _load_copy(self) -> dict:
        p = os.path.join(self.case_dir, "fv_copy.json")
        if not os.path.exists(p):
            return {}
        c = load_json(p)
        ok_keys = {f"{k}.{x}" for k in PAGE_NO for x in ("headline", "sub")} | {"plans.angles"}
        bad = [k for k in c if k not in ok_keys and not k.startswith("_")]
        if bad:
            raise Stop(f"[致命的] fv_copy.json に使えないキーがあります: {bad}（使えるのは {sorted(ok_keys)}）")
        free = [k for k, v in c.items() if isinstance(v, dict) and "text" in v]
        if len(free) > 2:
            raise Stop("[致命的] fv_copy.json の自由記述は資料全体で2件まで（それ以上は担当者の“翻訳”に戻る）")
        return c

    def _check_axes(self):
        """全軸: 表示順の取得か（並べ替え・CAPTCHA 下の取得を「上位」と呼ばない）。主カテゴリ: 外国語の混入"""
        self.fetched = {}
        for ax in self.axes:
            vs, meta = load_axis(self.case_dir, ax["file"], allow_empty=ax["kind"] != "category")
            ok, why = order_is_display(meta)
            if not ok:
                self.blocking.append(f"{ax['kind']}:{ax['name']}（{ax['file']}）: {why}")
            self.fetched[axis_key(ax)] = len(vs)
            if ax["kind"] == "category" and ax["name"] == self.kw["name"]:
                self.kw_raw, self.kw_meta = vs, meta
        if not hasattr(self, "kw_raw"):
            self.kw_raw, self.kw_meta = load_axis(self.case_dir, self.kw["file"])
        top = self.kw_raw[:20]
        foreign = [v for v in top if not is_domestic_lang(v.get("textLanguage"))]
        if top and len(foreign) / len(top) > CLAIM["foreign_max"]:
            self.blocking.append(f"カテゴリ検索の上位20本のうち外国語が{len(foreign)}本。取得地域が日本でない疑い。取り直してください")

    def _fetched_on(self):
        d = str((self.kw_meta or {}).get("fetched_on") or "")
        return d if re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) else None

    # ─────────────── 取り出し
    def rel(self, kind: str, name: str, window_only: bool = True) -> list[dict]:
        """その軸で関連と確定した投稿（軸の順位を _rank に入れて返す）"""
        out = []
        for p in self.posts:
            for a in p["axes"]:
                if a["kind"] == kind and a["name"] == name and a.get("confirmed") \
                        and a.get("relevance") == "relevant" and (a.get("in_window") or not window_only):
                    out.append({**p, "_rank": a["rank"], "_axis": axis_key(a), "_tile": a.get("tile")})
        return sorted(out, key=lambda x: x["_rank"])

    def decided(self, kind: str, name: str) -> list[tuple[dict, dict]]:
        return [(p, a) for p in self.posts for a in p["axes"]
                if a["kind"] == kind and a["name"] == name and a.get("in_window") and a.get("confirmed")]

    def _cover_sha(self, vid: str, path: str) -> str | None:
        if vid not in self._sha_cache:
            self._sha_cache[vid] = sha256_file(path)
        return self._sha_cache[vid]

    def usable(self, p, allow_frame=True) -> bool:
        vid = p["video_id"]
        want = f"assets/covers/{vid}.jpg"
        # 画像は投稿IDの名前のものだけ（labels.json を手で直して別の画像を指させない）
        if p.get("cover") != want:
            return False
        path = os.path.join(self.case_dir, want)
        try:
            with open(path, "rb") as f:
                if f.read(3) != b"\xff\xd8\xff":       # 名前だけ .jpg の WebP・HEIC は枠に引き伸ばされる
                    return False
        except OSError:
            return False
        m = self.manifest.get(vid) or {}
        if m.get("ok") is False:
            return False
        if not allow_frame and m.get("via") not in SEARCH_VIEW_VIA:
            return False              # 経路の分からない画像や動画のコマを「検索画面の見え方」として出さない
        sha = self._cover_sha(vid, path)
        if sha:
            first = self.usage.sha_seen.setdefault(sha, vid)
            if first != vid:
                return False          # 同じ画像の転載・再投稿は上位の1本だけを例にする
        return True

    @staticmethod
    def clean_url(u):
        """紙面のリンクは投稿URLそのものだけ（?以降は落とす）。形が違えばリンクを張らない"""
        u = re.sub(r"[?#].*$", "", str(u or "").strip())
        return u if re.fullmatch(r"https://(www\.)?tiktok\.com/@[\w.\-]+/(video|photo)/\d{6,25}", u) else None

    def card(self, p, page: int, **extra) -> dict:
        self.usage.use(p, page)
        c = {"video_id": p["video_id"], "cover": p["cover"], "url": self.clean_url(p.get("url")),
             "views": p.get("views"), "views_label": views_label(p.get("views")),
             "rank": p.get("_rank"), "axis": p.get("_axis"), "tile": p.get("_tile"),
             "is_pr": bool(p.get("is_pr")), "poster": p.get("poster"), "author": p.get("author"),
             "media": p.get("media"), "image_count": p.get("image_count"),
             "angle": p.get("angle"), "appeal": p.get("appeal")}
        c.update(extra)
        return c

    def pick_cards(self, ps, page: int, n: int, key=None, allow_frame=True, want=None) -> list[dict]:
        """例示に使える投稿を n 本まで選ぶ（まだ割り当てはしない）。同じ投稿・同じ作者は1ページに1回。
        want(p) を渡すと、その条件を満たす投稿だけを選ぶ"""
        out, vids, authors = [], set(), set()
        for p in sorted(ps, key=key) if key else ps:
            if len(out) >= n:
                break
            au = (p.get("author") or "").lower()
            if p["video_id"] in vids or (au and au in authors):
                continue
            if want and not want(p):
                continue
            if self.usable(p, allow_frame) and self.usage.ok(p, page):
                out.append(p)
                vids.add(p["video_id"])
                if au:
                    authors.add(au)
        return out

    @staticmethod
    def classified(ps, field) -> int:
        """その項目を判定できた本数（unknown＝判定不可は分母に入れない。仕様C）"""
        return sum(1 for p in ps if p.get(field) not in (None, "unknown"))

    def dist(self, ps, field) -> list[dict]:
        table = self.A if field == "angle" else self.P
        n = self.classified(ps, field)
        cnt: dict[str, list] = {}
        for p in ps:
            k = p.get(field)
            if k and k != "unknown":
                cnt.setdefault(k, []).append(p)
        rows = []
        for k, grp in cnt.items():
            v = [g["views"] for g in grp if g.get("views") is not None]
            rows.append({"id": k, "label": table[k]["label"], "short": table[k]["short"],
                         "phrase": table[k].get("phrase", ""), "count": len(grp),
                         "share": len(grp) / n if n else 0, "median": st.median(v) if v else None,
                         "authors": len({(g.get("author") or "").lower() for g in grp}), "posts": grp})
        rows.sort(key=lambda r: (r["id"] in RESERVED, -r["count"], -(r["median"] or 0)))
        return rows

    def top(self, rows):
        return next((r for r in rows if r["id"] not in RESERVED), None)

    # ─────────────── 文言
    def choose(self, key: str, cands: list, limit: str, numbers: set | None = None) -> str:
        cands = [c for c in cands if c]
        fits = [c for c in cands if jl(c) <= LIMITS[limit]]
        self.alt[key] = fits
        ov = self.copy.get(key)
        if isinstance(ov, dict) and "variant" in ov:
            i = int(ov["variant"]) - 1
            if not 0 <= i < len(fits):
                raise Stop(f"[致命的] fv_copy.json {key} の variant={ov['variant']} はありません（候補 {len(fits)} 件。--list-copy で確認）")
            return fits[i]
        if isinstance(ov, dict) and "text" in ov:
            t = ov["text"]
            if jl(t) > LIMITS[limit]:
                raise Stop(f"[致命的] fv_copy.json {key} が長すぎます（{jl(t):.0f} > {LIMITS[limit]}）")
            if not ov.get("by") or not ov.get("reason"):
                raise Stop(f"[致命的] fv_copy.json {key} の自由記述には by（氏名）と reason が要ります")
            if QUANTITY_WORDS.search(t):
                # 「九割」「大半」は数字の照合をすり抜ける。量は機械の数字で書く
                raise Stop(f"[致命的] fv_copy.json {key} に漢数字・割合の言葉があります（{QUANTITY_WORDS.search(t).group(0)}）。"
                           "量は算用数字で書いてください（機械の値と照合します）")
            nums = set(re.findall(r"\d+(?:\.\d+)?", t))
            # 使ってよい数字＝機械が出した値（テンプレ候補に出てくる数字）。それ以外の数字は書かせない
            allowed = set(numbers or set()) | {n for c in cands for n in re.findall(r"\d+(?:\.\d+)?", c)}
            if nums - allowed:
                raise Stop(f"[致命的] fv_copy.json {key} の数字 {sorted(nums - allowed)} が機械の値と合いません")
            self.manual.append({"key": key, "text": t, "by": ov["by"], "reason": ov["reason"]})
            return t
        if not fits:
            raise Stop(f"[致命的] {key}: どの見出し案も上限{LIMITS[limit]}字を超えます。"
                       "社名・カテゴリ名・検索語の短い表示名（case.json の brands[].short / category / keywords[].label）を"
                       f"設定するか、fv_copy.json に text で書いてください。候補: {cands}")
        return fits[0]

    def word(self, share: float) -> str:
        return "ばかり" if share >= CLAIM["strong"] else "が中心" if share >= CLAIM["center"] else "が多い"

    def brand_short(self, b) -> str:
        return short_of(b)

    # ─────────────── P2 いま、検索するとこう見える
    def page_now(self):
        k = self.kw
        rel = self.rel("category", k["name"])
        n_win = sum(1 for p in self.posts for a in p["axes"]
                    if a["kind"] == "category" and a["name"] == k["name"] and a.get("in_window"))
        grid = self.pick_cards(rel, 2, 8, allow_frame=False)
        size = 8 if len(grid) >= 8 else 6 if len(grid) >= 6 else 4 if len(grid) >= 4 else 0
        if not size:
            why = (f"例示できる投稿が{len(grid)}本（関連・検索画面のカバーがあるもの。4本以上が要る）。"
                   "カテゴリ語が広すぎるか、カバーの取得に失敗している")
            self.status["now"] = ("dropped", why)
            return None
        grid = grid[:size]
        groups = {"official": "公式", "creator_pr": "クリエイター", "creator": "クリエイター",
                  "consumer": "個人", "media": "メディア"}
        gcount: dict[str, int] = {}
        for p in rel:
            g = groups.get(p.get("poster"), "個人")
            gcount[g] = gcount.get(g, 0) + 1
        gtop = max(gcount, key=gcount.get) if gcount else None
        gshare = gcount.get(gtop, 0) / len(rel) if rel else 0
        g_ok = bool(gtop) and gcount.get(gtop, 0) >= CLAIM["now_angle_k"] and gshare >= CLAIM["now_angle_share"]
        ad = self.dist(rel, "angle")
        n_cls = self.classified(rel, "angle")
        a1 = self.top(ad)
        a2 = next((r for r in ad if r is not a1 and r["id"] not in RESERVED), None)
        strong_a = bool(a1) and a1["share"] >= CLAIM["now_angle_share"] and a1["count"] >= CLAIM["now_angle_k"]
        # 「{投稿者}の「{切り口}」投稿」と言うのは、その組み合わせ自体が基準を満たすときだけ。
        # 投稿者は a1 の投稿の中で最多のもの（全体の最多ではない）
        jg, jk = None, 0
        if strong_a:
            jc: dict[str, int] = {}
            for p in a1["posts"]:
                g = groups.get(p.get("poster"), "個人")
                jc[g] = jc.get(g, 0) + 1
            jg = max(jc, key=jc.get)
            jk = jc[jg]
        joint_ok = strong_a and jk >= CLAIM["now_angle_k"] and n_cls and jk / n_cls >= CLAIM["now_angle_share"]
        q = self.qlabel
        cands = []          # (見出し, 補足の種類)
        if joint_ok:
            cands.append((f"「{q}」の上位は、{jg}の「{a1['short']}」投稿{self.word(jk / n_cls)}", "joint"))
        if strong_a:
            cands.append((f"「{q}」の上位は、「{a1['short']}」投稿{self.word(a1['share'])}", "angle"))
        if a1 and a2 and not strong_a:
            cands.append((f"「{q}」の上位は、「{a1['short']}」と「{a2['short']}」が混在", "mix"))
        if g_ok:
            cands.append((f"「{q}」の上位は、{gtop}の投稿{self.word(gshare)}", "group"))
        if not strong_a and gshare < CLAIM["center"]:
            # 「ばらばら」は主張が無いときだけ（長い検索語で主張のある候補が字数で落ちたときに出さない）
            cands.append((f"「{q}」の上位は、投稿がばらばら", "none"))
        head = self.choose("now.headline", [c for c, _ in cands], "headline", {str(len(rel))})
        kind = next((kd for c, kd in cands if c == head), "angle" if strong_a else "group" if g_ok else "none")
        m, known, on = self.official_count(self.own) if self.own else (None, False, None)
        own_line = f"{self.client}公式は上位{on}本中{m}本" if known else None
        # 補足は見出しを数字で裏づける（投稿者の内訳の帯は本編に出さない。フォロワーで分けた数なので付録へ）
        if kind in ("joint",):
            base = f"関連{len(rel)}本中{jk}本が{jg}の「{a1['short']}」"
        elif kind in ("angle", "mix") and a1:
            base = f"関連{len(rel)}本中{a1['count']}本が「{a1['short']}」"
        elif kind == "group":
            base = f"関連{len(rel)}本中{gcount[gtop]}本が{gtop}の投稿"
        else:
            base = f"表示順の上位{n_win}本のうち関連は{len(rel)}本"
        subs = [f"{base}。{own_line}" if own_line else None, base]
        nums = {str(n_win), str(len(rel)), str(jk), str(gcount.get(gtop, 0)), str(m), str(on)}
        if a1:
            nums.add(str(a1["count"]))
        sub = self.choose("now.sub", subs, "sub", nums)
        cards = [self.card(p, 2) for p in grid]
        self.status["now"] = ("ready" if size == 8 else "degraded", f"格子 {size}枚")
        return {"headline": head, "sub": sub, "query": q, "caption": "", "kicker": "いま、検索するとこう見える",
                "cards": cards, "n_window": n_win, "n_relevant": len(rel),
                "numbers": {"n_window": n_win, "n_relevant": len(rel), "group": gtop,
                            "group_count": gcount.get(gtop, 0), "own_official": m if known else None,
                            "official_n": on if known else None}}

    def official_count(self, brand) -> tuple[int | None, bool, int | None]:
        """(本数, 言えるか, 分母)。主カテゴリの表示順上位 min(30,取得数) 本に、その社の公式アカウントが何本出ているか。
        labels ではなく取得JSONから機械で数える。official_status が confirmed / none の社だけ「0本」と言える。
        official_status が無いときは unknown（intake が推測で入れた公式IDだけでは「0本」と断定しない。仕様B）"""
        if not brand:
            return None, False, None
        status = brand.get("official_status") or "unknown"
        if status not in ("confirmed", "none"):
            return None, False, None
        ids = official_ids(brand)
        win = self.kw_raw[:30]
        if not win:
            return None, False, None
        k = sum(1 for v in win if str((v.get("author") or {}).get("uniqueId") or "").lower() in ids)
        return k, True, len(win)

    # ─────────────── P3 競合はこう発信している
    def page_competitors(self):
        if not self.comps:
            self.status["competitors"] = ("dropped", "競合の検索が無い")
            return None
        cols = []
        for i, b in enumerate(self.comps):
            rel = self.rel("competitor", b["name"])
            if len(rel) < CLAIM["col_min_n"]:
                self.warnings.append(f"競合 {b['name']}: 関連が{len(rel)}本で少ないため列を出しません（{CLAIM['col_min_n']}本以上）")
                continue
            ad, pd = self.dist(rel, "angle"), self.dist(rel, "appeal")
            ta, tp = self.top(ad), self.top(pd)
            share_ok = len(rel) >= CLAIM["col_share_n"]

            def claim(r):
                return r if (r and share_ok and r["share"] >= CLAIM["col_top_share"] and r["count"] >= CLAIM["col_top_k"]) else None
            ca, cp = claim(ta), claim(tp)
            thumbs = self.pick_cards(rel, 3, 2, key=lambda p: -(p.get("views") or 0))
            if not thumbs:
                self.warnings.append(f"競合 {b['name']}: 例示できるカバーが無いため列を出しません")
                continue
            cols.append({
                "brand": b["name"], "short": self.brand_short(b), "color_index": i + 1, "n": len(rel),
                "angle": {"label": ca["label"], "short": ca["short"], "count": ca["count"]} if ca else None,
                "appeal": {"label": cp["label"], "short": cp["short"], "count": cp["count"]} if cp else None,
                "note": None if share_ok else f"関連{len(rel)}本（少数）",
                "scattered": share_ok and not ca,
                "cards": [self.card(p, 3, brand=b["name"], short=self.brand_short(b), color_index=i + 1) for p in thumbs],
                "confirmed_by_client": b.get("confirmed_by_client", True) is not False,
                "paid_line": self.paid_lines.get(b["name"]),
            })
        if not cols:
            self.status["competitors"] = ("dropped", "関連が3本以上・カバーのある競合が無い")
            return None
        ap = [c for c in cols if c["appeal"]]
        an = [c for c in cols if c["angle"]]
        cands = []
        # 訴求の主張 → 切り口の主張 → 主張なし、の順。「そろって」は紙面の全社が同じ訴求のときだけ
        if len(ap) == len(cols) >= 2 and len({c["appeal"]["short"] for c in ap}) == 1:
            cands.append(f"競合はそろって「{ap[0]['appeal']['short']}」を押している")
        if len(ap) >= 2 and ap[0]["appeal"]["short"] != ap[1]["appeal"]["short"]:
            a, b = ap[0], ap[1]
            cands.append(f"{a['short']}は「{a['appeal']['short']}」、{b['short']}は「{b['appeal']['short']}」を押している")
            cands.append(f"{a['short']}は「{a['appeal']['short']}」、{b['short']}は「{b['appeal']['short']}」")
        if ap:
            cands.append(f"{ap[0]['short']}は「{ap[0]['appeal']['short']}」を押している")
        if len(an) >= 2 and an[0]["angle"]["short"] != an[1]["angle"]["short"]:
            a, b = an[0], an[1]
            cands.append(f"{a['short']}は「{a['angle']['short']}」、{b['short']}は「{b['angle']['short']}」で語られている")
        if len(an) == len(cols) >= 2 and len({c["angle"]["short"] for c in an}) == 1:
            cands.append(f"競合はそろって「{an[0]['angle']['short']}」で語られている")
        if an:
            cands.append(f"{an[0]['short']}は「{an[0]['angle']['short']}」で語られている")
        if all(c["scattered"] for c in cols):
            cands.append("競合の発信は、切り口がばらけている")
        cands.append(f"競合{len(cols)}社の、検索上位の発信" if len(cols) >= 2 else f"{cols[0]['short']}の、検索上位の発信")
        head = self.choose("competitors.headline", cands, "headline")
        # 補足に手法（「切り口と訴求で分類」）は書かない。手法は付録1（上長FB「前提・取り方は要らない」）
        subs = ["※競合は弊社の想定です。ご確認ください"] if any(not c["confirmed_by_client"] for c in cols) else []
        sub = self.choose("competitors.sub", subs, "sub") if (subs or "competitors.sub" in self.copy) else ""
        self.status["competitors"] = ("ready" if len(cols) >= 2 else "degraded", f"{len(cols)}社")
        return {"headline": head, "sub": sub, "columns": cols, "kicker": "競合はこう発信している"}

    # ─────────────── P4 競合がお金をかけて広げている訴求
    def paid_pool(self):
        pool = []
        for i, b in enumerate(self.comps):
            for p in self.rel("competitor", b["name"], window_only=False):
                # 関連（その社のカテゴリ商品が主役）× PR表記または公式アカウント
                if p.get("is_pr") or p.get("poster") == "official":
                    pool.append((i, b, p))
        return pool

    def majority(self, ps, field):
        """(最多の行, 判定できた本数)。最多が単独で過半のときだけ行を返す（同数1位は言わない）"""
        rows = [r for r in self.dist(ps, field) if r["id"] not in RESERVED]
        n = self.classified(ps, field)
        if not rows or not n:
            return None, n
        t = rows[0]
        if len(rows) > 1 and rows[1]["count"] == t["count"]:
            return None, n
        return (t if t["count"] / n > CLAIM["paid_major"] else None), n

    def page_paid(self):
        """P3 より先に呼ぶ（例示の割り当ては P2→P4→P3 の順。仕様D）。
        独立ページにしないときは、P3 の各列に1行で吸収する（self.paid_lines）"""
        self.paid_lines = {}
        pool = self.paid_pool()

        def absorb(reason):
            for b in self.comps:
                mine = [p for _, bb, p in pool if bb["name"] == b["name"]]
                if len(mine) < CLAIM["paid_min"]:
                    continue
                t, n = self.majority(mine, "appeal")
                if t:
                    line = f"お金をかけて押しているのは「{t['short']}」（PR・公式{n}本中{t['count']}本）"
                    if jl(line) > LIMITS["sub"]:
                        line = f"お金をかけて押しているのは「{t['short']}」"
                    self.paid_lines[b["name"]] = line
            self.status["paid"] = ("dropped", reason)
            return None

        tp, n_cls = self.majority([p for _, _, p in pool], "appeal")
        if len(pool) < CLAIM["paid_min"] or not tp:
            return absorb(f"PR・公式の関連投稿{len(pool)}本（{CLAIM['paid_min']}本以上かつ最多訴求が単独で過半のとき独立）")
        by = {}
        for i, b, p in pool:
            if p.get("appeal") == tp["id"]:
                by.setdefault(b["name"], []).append(p)
        lead = max(by, key=lambda k: len(by[k]))
        lead_b = next(b for b in self.comps if b["name"] == lead)
        # カードは見出しの訴求（tp）の投稿だけ。先導社 → 他社の順、再生の多い順。
        # 「その他」「判定不可」の投稿をカードにしない（仕様C）
        order = sorted([x for x in pool if x[2].get("appeal") == tp["id"]],
                       key=lambda x: (x[1]["name"] != lead, -(x[2].get("views") or 0)))
        picked, vids, authors = [], set(), set()
        for want_new_brand in (True, False):
            for i, b, p in order:
                if len(picked) >= 4:
                    break
                if want_new_brand and any(bb["name"] == b["name"] for _, bb, _ in picked):
                    continue
                au = (p.get("author") or "").lower()
                if p["video_id"] in vids or (au and au in authors):
                    continue
                if self.usable(p) and self.usage.ok(p, 4):
                    picked.append((i, b, p))
                    vids.add(p["video_id"])
                    if au:
                        authors.add(au)
        if len(picked) < 2:
            # 見出しを画で裏づけられない文字だけのページは作らない
            return absorb(f"訴求「{tp['short']}」のPR・公式投稿でカバーのあるものが{len(picked)}本（2本以上で独立）")
        cards = [self.card(p, 4, brand=b["name"], short=self.brand_short(b), color_index=i + 1,
                           badge="公式" if p.get("poster") == "official" else "PR",
                           appeal_label=self.P[p["appeal"]]["label"]) for i, b, p in picked]
        head = self.choose("paid.headline", [
            f"{self.brand_short(lead_b)}は、お金をかけて「{tp['short']}」を広げている",
            f"競合がお金をかけているのは「{tp['short']}」",
        ], "headline")
        sub = self.choose("paid.sub", [
            f"PR・公式の投稿{n_cls}本中{tp['count']}本が「{tp['short']}」",
        ], "sub", {str(n_cls), str(tp["count"])})
        self.status["paid"] = ("ready", f"PR・公式 {len(pool)}本")
        return {"headline": head, "sub": sub, "cards": cards, "n": n_cls, "top": tp["id"],
                "kicker": "競合がお金をかけて広げている訴求"}

    # ─────────────── P6 いま伸びている型（先に計算して P5・P7 で使う）
    def compute_winning(self):
        rel = self.rel("category", self.kw["name"])
        pool = [p for p in rel if (p.get("views") or 0) >= CLAIM["min_views"]]
        recent_note = ""
        if self.acquired_on:
            try:
                acq = dt.date.fromisoformat(str(self.acquired_on)[:10])
            except ValueError:
                acq = None
            rec = []
            for p in pool if acq else []:
                try:
                    d = dt.date.fromtimestamp(p["create_time"]) if p.get("create_time") else None
                except (TypeError, ValueError, OSError, OverflowError):
                    d = None              # 読めない投稿日時の投稿だけを外す（全体の絞り込みは続ける）
                if d and (acq - d).days <= CLAIM["recent_days"]:
                    rec.append(p)
            if len(rec) >= CLAIM["recent_min"]:
                pool = rec
                recent_note = "直近1年"
        views = [p["views"] for p in pool if p.get("views") is not None]
        base = st.median(views) if views else None
        rows = [r for r in self.dist(pool, "angle") if r["id"] not in RESERVED
                and r["count"] >= CLAIM["win_k"] and r["authors"] >= CLAIM["win_authors"]]
        for r in rows:
            r["lift"] = (r["median"] / base) if (base and r["median"]) else None
        winners = []
        if base and base >= CLAIM["min_views"]:
            winners = sorted([r for r in rows if r["lift"] and r["lift"] >= CLAIM["win_lift"]], key=lambda r: -r["lift"])[:3]
        many = sorted([r for r in rows if r["share"] >= 0.15], key=lambda r: -r["count"])[:3]
        return {"pool": pool, "base": base, "winners": winners, "many": many, "recent": recent_note, "rel": rel}

    def page_winning(self, W):
        cards_src = W["winners"] or W["many"]
        if not cards_src:
            self.status["winning"] = ("dropped", f"本数{CLAIM['win_k']}以上・作者2人以上の型が無い")
            return None
        cards = []
        for r in cards_src:
            ex = self.pick_cards(r["posts"], 6, 1, key=lambda p: -(p.get("views") or 0))
            lift = r.get("lift") if W["winners"] else None
            evid = [f"{r['count']}本の再生中央値{views_label(r['median'])}＝全体の{lift:.1f}倍" if lift else None,
                    f"{r['count']}本・中央値{views_label(r['median'])}再生" if r["median"] else None,
                    f"関連{len(W['pool'])}本中{r['count']}本"]
            evidence = next((e for e in evid if e and jl(e) <= LIMITS["evidence"]), evid[-1])
            cards.append({"angle": r["id"], "label": r["label"], "short": r["short"],
                          "phrase": self.phrase(r["phrase"]), "count": r["count"], "median": r["median"],
                          "lift": round(lift, 2) if lift else None, "lift_label": f"{lift:.1f}倍" if lift else None,
                          "evidence": evidence, "example": self.card(ex[0], 6) if ex else None})
            if not ex:
                self.warnings.append(f"型「{r['label']}」の代表投稿に使えるカバーが無い（空枠になります）")
        c1 = cards[0]
        if W["winners"]:
            head = self.choose("winning.headline", [
                f"「{self.category}」でいま伸びるのは「{c1['short']}」型", f"いま伸びるのは「{c1['short']}」型"], "headline")
            sub = self.choose("winning.sub", [
                f"{W['recent'] + 'の' if W['recent'] else ''}関連投稿の再生中央値{views_label(W['base'])}と比べた倍率",
                f"再生中央値{views_label(W['base'])}と比べた倍率"], "sub")
        else:
            head = self.choose("winning.headline", [
                f"「{self.category}」は、まだ勝ち型が決まっていない", "まだ勝ち型が決まっていない"], "headline")
            sub = self.choose("winning.sub", ["本数の多い型。再生で抜けた型はまだ無い"], "sub")
        self.status["winning"] = ("ready" if W["winners"] else "degraded", f"{len(cards)}型")
        # 勝ち型が無い版で「いま伸びている型」「お土産」と見出しの上に書かない（見出しと逆のことになる）
        return {"headline": head, "sub": sub, "cards": cards, "winners": bool(W["winners"]),
                "base": W["base"], "n": len(W["pool"]),
                "kicker": "いま伸びている型" if W["winners"] else "いま多い型",
                "tag": "お土産" if W["winners"] else ""}

    def phrase(self, ph: str) -> str:
        if "{product}" in ph:
            return ph.replace("{product}", self.products[0]) if self.products and \
                jl(ph.replace("{product}", self.products[0])) <= LIMITS["phrase"] + 6 else ph.replace("{product}に", "").replace("{product}", "")
        return ph

    # ─────────────── P5 {client}に足りていない発信
    def page_gap(self, W):
        own_rel = self.rel("own", self.own["name"]) if (self.own and self.own.get("file")) else []
        own_ok = self.own is not None and len(own_rel) >= CLAIM["gap_own_n"]
        heat: dict[str, dict] = {}
        srcs = [("category", self.kw["name"], None)] + [("competitor", b["name"], (i, b)) for i, b in enumerate(self.comps)]
        for kind, name, meta in srcs:
            rel = self.rel(kind, name)
            if len(rel) < CLAIM["col_share_n"]:
                continue
            for r in self.dist(rel, "angle"):
                if r["id"] in RESERVED or r["count"] < CLAIM["gap_k"] or r["share"] < CLAIM["gap_heat"]:
                    continue
                h = heat.setdefault(r["id"], {"heat": 0, "where": [], "posts": []})
                h["heat"] = max(h["heat"], r["share"])
                h["where"].append((kind, name, meta, r["count"], len(rel)))
                h["posts"] += [(kind, name, meta, p) for p in r["posts"]]
        rows = []
        lifted = {r["id"]: r.get("lift") for r in W["winners"]}
        order = sorted(heat.items(), key=lambda kv: (-(lifted.get(kv[0]) or 0), -kv[1]["heat"]))
        for aid, h in order:
            own_k = sum(1 for p in own_rel if p.get("angle") == aid) if own_ok else None
            if own_ok and own_k > 0:
                continue
            comp_posts = [x for x in h["posts"] if x[0] == "competitor"]
            if not own_ok and comp_posts:
                continue            # 自社軸なし: 競合もまだ使っていない型だけを「空席」と言う
            # 実例と根拠の数字は同じ出所から取る（別の社の画像に別の社の数字を添えない）
            where = sorted([w for w in h["where"] if w[0] == "competitor"] or h["where"],
                           key=lambda w: -(w[3] / w[4]))
            left, k0 = None, None
            for w in where:
                cand = sorted([x for x in h["posts"] if x[0] == w[0] and x[1] == w[1]],
                              key=lambda x: -(x[3].get("views") or 0))
                for kind, name, meta, p in cand:
                    if self.usable(p) and self.usage.ok(p, 5):
                        extra = {"caption": (self.brand_short(meta[1]) if meta else f"「{self.query}」上位"),
                                 "color_index": (meta[0] + 1) if meta else 0}
                        left, k0 = self.card(p, 5, **extra), w
                        break
                if left:
                    break
            if not left:
                continue
            src_label = self.brand_short(k0[2][1]) if k0[2] else f"「{self.qlabel}」"
            # 右の枠（まだ無し）が貴社の0本を画で言っているので、根拠行は出所の本数だけにする
            evid = f"{src_label}は{k0[4]}本中{k0[3]}本"
            # 「競合が押す」と言えるのは、実例の出所が競合で、P3 の「主な切り口」と同じ基準を満たすときだけ
            pushed = k0[0] == "competitor" and k0[3] >= CLAIM["col_top_k"] and k0[3] / k0[4] >= CLAIM["col_top_share"]
            rows.append({"angle": aid, "label": self.A[aid]["label"], "short": self.A[aid]["short"],
                         "left": left, "right": None, "pushed": pushed,
                         "right_text": "まだ無し" if own_ok else "まだ空席", "evidence": evid})
            if len(rows) >= 3:
                break
        m, known, on = self.official_count(self.own) if self.own else (None, False, None)
        if not rows:
            if known and m == 0:
                head = self.choose("gap.headline", [f"「{self.qlabel}」の上位に、{self.client}公式は0本"], "headline")
                self.status["gap"] = ("degraded", "型の空白なし・公式0本で成立")
                # 補足に数え方は書かない（図の下の1行が「上位N本のうち…」と言っている。手法は付録）
                return {"headline": head, "sub": "", "rows": [], "mode": "official", "official_n": on,
                        "kicker": f"{self.client}に足りていない発信"}
            self.status["gap"] = ("dropped", "言える空白が無い（自社の関連5本以上で0本の型、または公式0本が要る）")
            return None
        r1 = rows[0]
        winners = {w["id"] for w in W["winners"]}
        cands = []
        if own_ok:
            if r1["pushed"]:
                cands.append(f"競合が押す「{r1['short']}」、{self.client}はまだ0本")
            if r1["angle"] in winners:
                cands.append(f"伸びている「{r1['short']}」、{self.client}はまだ0本")
            cands.append(f"「{r1['short']}」、{self.client}はまだ0本")
        else:
            # 自社の検索が無い版は {client} を主語にしない（言えるのは「競合もまだ使っていない」まで）
            if r1["angle"] in winners:
                cands.append(f"「{r1['short']}」は伸びているのに、まだ空席")
            cands.append(f"「{r1['short']}」は、まだ空席")
        head = self.choose("gap.headline", cands, "headline")
        subs = []
        if known:
            subs.append(f"「{self.qlabel}」上位{on}本に{self.client}公式は{m}本")
        subs.append(f"左が実例、右が{self.client}" if own_ok else "左が市場の実例、右が競合各社")
        sub = self.choose("gap.sub", subs, "sub", {str(m), str(on)})
        self.status["gap"] = ("ready" if len(rows) >= 2 else "degraded", f"{len(rows)}型")
        return {"headline": head, "sub": sub, "rows": rows, "mode": "own" if own_ok else "none",
                "right_label": self.client if own_ok else "競合", "official_n": on,
                "kicker": f"{self.client}に足りていない発信" if own_ok else "まだ空いている発信"}

    # ─────────────── P7 まずこの3本
    def page_plans(self, W, gap):
        ids = self.copy.get("plans.angles")
        if ids:
            bad = [i for i in ids if i not in self.A or i in RESERVED]
            if bad:
                raise Stop(f"[致命的] fv_copy.json plans.angles に語彙外の id: {bad}")
            src = [{"id": i, "label": self.A[i]["label"], "short": self.A[i]["short"], "lift": None} for i in ids[:3]]
            basis = "chosen"
        else:
            # 伸びている型（lift順・貴社が0本の型を先）→ 本数の多い型 → 差のページの型、の順に3つまで。
            # P6 には「伸びている」と言える型しか出さないが、企画の種は3つ用意する
            gap_ids = [r["angle"] for r in (gap or {}).get("rows", [])]
            src = sorted(W["winners"], key=lambda r: (r["id"] not in gap_ids, -(r.get("lift") or 0)))
            for r in W["many"]:
                if len(src) < 3 and all(x["id"] != r["id"] for x in src):
                    src.append({**r, "lift": None})
            for aid in gap_ids:
                if len(src) < 3 and all(x["id"] != aid for x in src):
                    src.append({"id": aid, "label": self.A[aid]["label"], "short": self.A[aid]["short"], "lift": None})
            src = src[:3]
            win_ids = {w["id"] for w in W["winners"]}
            basis = "winners" if src and all(r["id"] in win_ids for r in src) else "many"
        if not src:
            self.status["plans"] = ("dropped", "型の候補が無い")
            return None
        items = []
        cat_rel = W["rel"]
        comp_rel = [p for b in self.comps for p in self.rel("competitor", b["name"])]
        for j, r in enumerate(src):
            # 参考投稿はカテゴリの検索から。無ければ競合の検索から
            posts = [p for p in cat_rel if p.get("angle") == r["id"]] or \
                    [p for p in comp_rel if p.get("angle") == r["id"]]
            ap = self.top(self.dist(posts, "appeal")) if posts else None
            prod = self.products[j % len(self.products)] if self.products else None
            titles = [f"{prod}を「{r['short']}」で見せる" if prod else None,
                      f"「{r['label']}」で1本" if not prod else None,
                      f"「{r['short']}」で1本"]
            title = next((t for t in titles if t and jl(t) <= LIMITS["plan"]), titles[-1])
            ref = self.pick_cards(posts, 7, 1, key=lambda p: -(p.get("views") or 0))
            reason = []
            if W["winners"] and r.get("lift") and r["lift"] >= CLAIM["win_lift"]:
                reason.append(f"市場で{r['lift']:.1f}倍")
            if gap and r["id"] in [x["angle"] for x in gap.get("rows", [])] and gap.get("mode") == "own":
                reason.append(f"{self.client}は0本")
            items.append({"angle": r["id"], "title": title, "angle_short": r["short"],
                          "appeal_short": ap["short"] if ap else None, "product": prod,
                          "reason": "・".join(reason), "reference": self.card(ref[0], 7) if ref else None})
        head = self.choose("plans.headline", [f"{self.client}なら、まずこの{len(items)}本から",
                                              f"まずこの{len(items)}本から"], "headline")
        # 補足は企画の出どころどおりに言う（伸びていない型に「伸びている型」と書かない。
        # 注力商品が無ければ「商品に当てはめた」と書かない）
        what = {"winners": "伸びている型", "many": "上位に多い型", "chosen": "選んだ型"}[basis]
        on_prod = any(it["product"] for it in items)
        subs = ([f"{what}を、貴社の商品に当てはめた企画の種", f"{what}を商品に当てはめた企画の種"] if on_prod
                else [f"{what}から作る企画の種"])
        sub = self.choose("plans.sub", subs, "sub")
        photo = sum(1 for p in cat_rel if p.get("media") == "photo") > len(cat_rel) / 2 if cat_rel else False
        self.status["plans"] = ("ready" if len(items) == 3 else "degraded", f"{len(items)}本")
        return {"headline": head, "sub": sub, "items": items, "photo_major": photo, "basis": basis,
                "kicker": f"まずこの{len(items)}本"}

    # ─────────────── P8 次回
    def page_next(self, plans):
        n = len(plans["items"]) if plans else 0
        kind = "構成案" if plans and plans.get("photo_major") else "台本"
        head = self.choose("next.headline", [
            f"次回、この{n}本を「{kind}」にしてお持ちします" if n else None,
            f"次回、伸びる型を「{kind}」にしてお持ちします"], "headline")
        ask = []
        if any(b.get("confirmed_by_client") is False for b in self.comps) or not self.comps:
            ask.append("比較する競合（2〜3社）のご確認")
        st_own = (self.own or {}).get("official_status") or "unknown"
        if st_own not in ("confirmed", "none"):
            ask.append("公式TikTokアカウントの有無")
        if not self.products:
            ask.append("注力している商品（1〜3つ）")
        for x in ("いま意識している競合", "注力している商品の優先順位", "動画の制作・投稿の体制"):
            if len(ask) >= 3:
                break
            # 同じことを2回聞かない（商品・競合はどちらかの言い方だけにする）
            topic = "商品" if "商品" in x else "競合" if "競合" in x else x
            if not any(topic in a for a in ask):
                ask.append(x)
        bring = [f"この{n}本の{kind}と撮影の段取り" if n else f"伸びる型の{kind}",
                 "参考にした上位投稿の分解", "検索順位の測り方と目標"]
        for x in bring + ask:
            if jl(x) > LIMITS["item"]:
                raise Stop(f"[致命的] 次回ページの項目が長すぎます: {x}")
        # 補足行は置かない（右の列の見出し「教えていただきたいこと」が同じことを言っている）
        sub = ""
        self.status["next"] = ("ready", "")
        return {"headline": head, "sub": sub, "bring": bring, "ask": ask[:3], "kicker": "次回",
                "service": "台本→撮影→投稿→検索順位の計測まで、まとめてお任せいただけます"}

    # ─────────────── 付録
    def appendix(self, pages, W):
        rows_t = []
        for ax in self.axes:
            vs, _m = load_axis(self.case_dir, ax["file"], allow_empty=ax["kind"] != "category")
            dec = self.decided(ax["kind"], ax["name"])
            cnt = {}
            for _p, a in dec:
                cnt[a["relevance"]] = cnt.get(a["relevance"], 0) + 1
            rel = self.rel(ax["kind"], ax["name"])
            fol = [((v.get("author") or {}).get("followerCount")) for v in vs]
            tiers = [sum(1 for f in fol if f and f < 10_000), sum(1 for f in fol if f and 10_000 <= f < 100_000),
                     sum(1 for f in fol if f and 100_000 <= f < 1_000_000), sum(1 for f in fol if f and f >= 1_000_000),
                     sum(1 for f in fol if not f)]
            v = [p["views"] for p in rel if p.get("views") is not None]
            label = {"category": "カテゴリ", "competitor": "競合", "own": "貴社"}[ax["kind"]]
            q = next((x.get("query") for x in (self.cfg.get("keywords") or []) + (self.cfg.get("brands") or [])
                      if x.get("name") == ax["name"] and x.get("query")), ax["name"])
            rows_t.append([f"{label}｜{q}", str(len(vs)), str(len(dec)), str(len(rel)),
                           f"{cnt.get('irrelevant', 0)}/{cnt.get('other_brand', 0)}/{cnt.get('off_category', 0)}/{cnt.get('unsure', 0)}",
                           str(sum(1 for p in rel if p.get("is_pr"))), str(sum(1 for p in rel if p.get("poster") == "official")),
                           str(sum(1 for x in vs if x.get("mediaType") == "photo")),
                           views_label(st.median(v)) if v else "—", "/".join(str(t) for t in tiers)])
        head = ["検索", "取得", "判定", "関連", "除外 無関係/他社/外/不可", "PR", "公式", "写真", "再生中央値",
                "フォロワー 1万未満/10万/100万/以上/不明"]
        col_w = [3.4, 0.9, 0.9, 0.9, 2.6, 0.8, 0.8, 0.8, 1.5, 5.1]
        # 切り口の分布（●多い ○無い △少し —判断できない）
        mcols = [ax for ax in self.axes if ax["kind"] != "category" or ax["name"] == self.kw["name"]]
        dists = {}
        for ax in mcols:
            rel = self.rel(ax["kind"], ax["name"])
            dists[axis_key(ax)] = (len(rel), {r["id"]: r for r in self.dist(rel, "angle")})
        ids = [e["id"] for e in self.vocab["angles"] if e["id"] not in RESERVED
               and any(e["id"] in d for _n, d in dists.values())][:8]
        mrows = []
        for aid in ids:
            row = [self.A[aid]["label"]]
            for ax in mcols:
                n, d = dists[axis_key(ax)]
                r = d.get(aid)
                if n < 5:
                    row.append("—")
                elif r and r["count"] >= 2 and r["share"] >= 0.20:
                    row.append(f"● {r['count']}")
                elif not r:
                    row.append("○ 0")
                else:
                    row.append(f"△ {r['count']}")
            mrows.append(row)
        mhead = ["切り口"] + [("カテゴリ" if ax["kind"] == "category" else self.client if ax["kind"] == "own"
                             else next((short_of(b) for b in self.comps if b["name"] == ax["name"]), ax["name"]))
                            for ax in mcols]
        pr_basis_count = {"isAd": 0, "tag": 0, "body": 0}
        for p in self.posts:
            for b_ in p.get("pr_basis") or []:
                pr_basis_count[b_] = pr_basis_count.get(b_, 0) + 1
        if self.acquired_on:
            day = fmt_date(self.acquired_on)
        elif self.acquired_ref:
            day = f"不明（取得JSONのファイル日付は{fmt_date(self.acquired_ref)}。参考）"
        else:
            day = "不明"
        # 集計の対象は実際にある軸と、実際に判定した本数（窓の設定値ではなく min(窓, 取得数)）
        win = self.labels.get("window") or {}
        parts = []
        for kind, label in (("category", "カテゴリ"), ("competitor", "競合"), ("own", self.client)):
            axs = [ax for ax in self.axes if ax["kind"] == kind]
            if not axs:
                continue
            w = win.get("category" if kind == "category" else "own" if kind == "own" else "brand") or 0
            ns = sorted({min(w, self.fetched.get(axis_key(ax), 0)) for ax in axs})
            cnt = f"{ns[0]}本" if len(ns) == 1 else f"{ns[0]}〜{ns[-1]}本"
            parts.append(f"{label}{'各' if len(axs) > 1 else ''}{cnt}")
        vname = self.vocab.get("title") or self.vocab.get("name") or "案件の語彙"
        vver = f" v{self.vocab['version']}" if self.vocab.get("version") else ""
        premise = [
            ["取得日", f"{day}。TikTokの検索画面が実際に表示した順（ログインなし・並び替えなし）。表示順は時刻・地域で変わるスナップショット。"],
            ["集計の対象", f"各検索の表示順上位（{'・'.join(parts)}）を1本ずつ画像と本文で判定し、「関連」の投稿だけを数えた。"
             + ("競合のPR投稿は順位の外も確認した。" if any(ax["kind"] == "competitor" for ax in self.axes) else "")],
            ["分類の方法", f"切り口・訴求は固定の選択肢（{vname}{vver}）から1つずつ選んだ。"
             "判定はカバー画像を開いた証拠（一覧シートのコード）付き。投稿者の種類は公式ID・PR表記・フォロワー数で機械的に決めた。"],
            ["PRの判定", f"TikTokの広告フラグ、#PR・#提供・#タイアップ等のタグ、本文の【PR】表記のいずれか（根拠の内訳 広告フラグ{pr_basis_count['isAd']}／タグ{pr_basis_count['tag']}／本文{pr_basis_count['body']}）。広告該当性は判定しない。"],
            ["伸びの定義", f"型の再生中央値 ÷ カテゴリ検索の関連投稿{('（' + W['recent'] + '）') if W['recent'] else ''}の再生中央値。"
             f"{CLAIM['win_k']}本以上・作者{CLAIM['win_authors']}人以上・{CLAIM['win_lift']}倍以上を「伸びている」とした（再生{CLAIM['min_views']:,}未満は除外）。"],
            ["主張の基準", f"現状の型＝関連の{CLAIM['now_angle_share']:.0%}以上かつ{CLAIM['now_angle_k']}本以上／競合の主な切り口・訴求＝関連{CLAIM['col_share_n']}本以上で{CLAIM['col_top_share']:.0%}以上／"
             f"「{self.client}はまだ0本」＝{self.client}の関連{CLAIM['gap_own_n']}本以上で0本／公式0本＝公式IDを確認した社だけ。"
             "割合の分母は判定できた投稿（判定不可を除く）。"],
            ["因果について", "上位に多い型は「上位に多い傾向」で、上位表示の原因とは断定しない。"
             + (f"「まずこの{len(pages['plans']['items'])}本」は仮説で、効果は次回以降の検証で確かめる。" if pages.get("plans") else "")],
        ]
        if self.manual:
            premise.append(["手修正", f"{len(self.manual)}件（" + "／".join(f"{m['key']}: {m['by']}・{m['reason']}" for m in self.manual) + "）"])
        return {"premise": premise, "table": {"head": head, "rows": rows_t, "col_w": col_w},
                "matrix": {"title": "切り口の分布（● 多い　○ 無い　△ 少し　— 関連5本未満で判断しない）",
                           "head": mhead, "rows": mrows, "col_w": [4.2] + [(17.7 - 4.2) / max(1, len(mcols))] * len(mcols)}}

    # ─────────────── 組み立て
    def build(self) -> dict:
        self.alt: dict[str, list] = {}
        if self.blocking:
            return self._result(None)
        # 例示の割り当て優先（同じ投稿を取り合ったとき先に取るページ）は P2→P4→P3→P5→P7→P6（仕様D）。
        # 紙面の並びは order で別に決めるので、呼ぶ順はこのとおりでよい
        now = self.page_now()
        self.paid_lines = {}
        paid = self.page_paid() if self.comps else None
        comp = self.page_competitors()
        W = self.compute_winning()
        gap = self.page_gap(W)
        plans = self.page_plans(W, gap)
        win = self.page_winning(W)
        nxt = self.page_next(plans)
        pages = {"now": now, "competitors": comp, "paid": paid, "gap": gap, "winning": win, "plans": plans, "next": nxt}
        allow = set(((self.cfg.get("first_visit") or {}).get("allow_drop")) or [])
        for k, v in pages.items():
            if v is None and k != "paid":
                why = self.status.get(k, ("dropped", "理由不明"))[1]
                msg = f"ページ「{k}」を出せません: {why}"
                if k not in DROPPABLE:
                    self.blocking.append(msg + "（このページは資料の入口なので省けません）")
                elif k in allow:
                    self.warnings.append(msg + "（allow_drop で許可済み）")
                else:
                    self.blocking.append(msg + "（出さずに進めるなら case.json first_visit.allow_drop に書く）")
        if self.blocking:
            return self._result(None)
        return self._result(pages, W)

    def _result(self, pages, W=None) -> dict:
        if pages is None:
            return {"ok": False, "blocking": self.blocking, "warnings": self.warnings,
                    "pages": [{"id": k, "status": s, "reason": r} for k, (s, r) in self.status.items()]}
        order = [k for k in PAGE_ORDER if pages[k]]
        # 表紙: 関連・カバーあり・P2/P3 に使っていない投稿を再生順に3枚
        # 表紙はカテゴリの投稿を優先する（貴社自身の投稿は相手が一番よく知っている）
        rel_all = []
        for ax in sorted(self.axes, key=lambda a: {"category": 0, "competitor": 1, "own": 2}[a["kind"]]):
            rel_all += [(0 if ax["kind"] == "category" else 1, p) for p in self.rel(ax["kind"], ax["name"])]
        rel_all = [p for _k, p in sorted(rel_all, key=lambda kp: (kp[0], -(kp[1].get("views") or 0)))]
        seen = set()
        cover_cards = []
        for p in rel_all:
            if p["video_id"] in seen:
                continue
            seen.add(p["video_id"])
            used = self.usage.pages.get(p["video_id"], [])
            if any(pg in (2, 3) for pg in used) or len(used) >= MAX_USE:
                continue
            if self.usable(p) and self.usage.ok(p, 1):       # 同じ作者の投稿を表紙に2枚並べない
                cover_cards.append(self.card(p, 1))
            if len(cover_cards) >= 3:
                break
        # 表紙の日付: 訪問日 → 取得日。取得日が分からないときは日付を出さない（ファイル日付は付録の参考だけ）
        dlabel = fmt_date(self.cfg.get("visit_date") or (self.cfg.get("project") or {}).get("date") or self.acquired_on)
        pj = self.cfg.get("project") or {}
        project = {
            "cover_title": f"「{self.category}」のTikTok\n伸びている投稿と、競合の打ち手",
            "recipient": pj.get("recipient") or (f"{(self.cfg.get('client') or {}).get('client_name')} 御中"
                                                 if (self.cfg.get("client") or {}).get("client_name") else ""),
            "producer": pj.get("producer") or "", "date_label": dlabel,
            "client": (self.cfg.get("client") or {}).get("client_name") or self.client,
            "client_short": self.client, "category": self.category, "query": self.query,
            "acquired_on": self.acquired_on,
            "footer": f"{self.client}様｜{fmt_date(self.acquired_on)}取得" if self.acquired_on else f"{self.client}様",
        }
        doc = {"version": 3, "ok": True, "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
               "project": project, "order": order, "page_no": phys_pages(order),
               "pages": pages, "cover_cards": cover_cards,
               "appendix": self.appendix(pages, W), "claim": CLAIM, "manual": self.manual,
               "alternatives": self.alt,
               "pages_status": [{"id": k, "status": s, "reason": r} for k, (s, r) in self.status.items()],
               "warnings": self.warnings, "inputs_sha256": self.inputs_sha()}
        # 紙面に出る文字列の最終検査（None・undefined 等が混ざったら止める）
        def walk(o, path):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in ("headline", "sub", "label", "short", "phrase", "evidence", "title", "reason",
                             "caption", "note", "paid_line", "right_text", "service", "cover_title", "kicker",
                             "tag", "footer", "date_label", "recipient", "appeal_label", "right_label"):
                        if isinstance(v, str):
                            assert_clean(f"{path}.{k}", v)
                    walk(v, f"{path}.{k}")
            elif isinstance(o, list):
                for i, v in enumerate(o):
                    # 付録の表・前提（文字列の2次元配列）や次回の項目も紙面に出る
                    if isinstance(v, str):
                        assert_clean(f"{path}[{i}]", v)
                    walk(v, f"{path}[{i}]")
        walk({"pages": pages, "project": project, "appendix": doc["appendix"]}, "fv")
        return doc

    def inputs_sha(self) -> dict:
        files = ["case.json", "labels.json", "fv_copy.json", "assets/covers/manifest.json"]
        files += [ax["file"] for ax in self.axes]
        out = {f: sha256_file(os.path.join(self.case_dir, f)) for f in files}
        out["_vocab"] = self.vocab.get("_sha")
        return out


# ─────────────────────────────── 書き出し

def used_images(doc) -> dict:
    """video_id → {url, cover, axes, pages, tile, author}。pages は紙面の番号（表紙=1）"""
    out = {}

    def add(c, page):
        if not c or not c.get("cover"):
            return
        e = out.setdefault(c["video_id"], {"url": c.get("url"), "cover": c["cover"], "axes": [],
                                           "pages": [], "tile": c.get("tile"), "author": c.get("author")})
        if page not in e["pages"]:
            e["pages"].append(page)
        # 同じ投稿を別の軸で載せたら（P2=カテゴリ、P3=競合）両方の軸を照合対象にする
        if c.get("axis") and c["axis"] not in e["axes"]:
            e["axes"].append(c["axis"])
    for c in doc.get("cover_cards") or []:
        add(c, 1)
    pg = doc["pages"]
    for k, no in (doc.get("page_no") or phys_pages(doc["order"])).items():
        p = pg.get(k)
        if not p:
            continue
        for c in p.get("cards") or []:
            add(c, no)
            add(c.get("example"), no)
        for col in p.get("columns") or []:
            for c in col.get("cards") or []:
                add(c, no)
        for r in p.get("rows") or []:
            add(r.get("left"), no)
            add(r.get("right"), no)
        for it in p.get("items") or []:
            add(it.get("reference"), no)
    return out


def write_assets_md(case_dir, imgs, fv_sha):
    # first_visit_sha256 は generate.js と verify_assets.py が照合する（first_visit.json の手修正を止める）
    L = ["# FV ASSETS", "", "<!-- build_first_visit.py が書く。verify_assets.py が照合に使う（手で直さない） -->",
         f"<!-- first_visit_sha256: {fv_sha} -->", ""]
    for vid, e in imgs.items():
        L += [f"#### VIDEO {vid}", f"- url: {e['url'] or ''}", f"- image_path: {e['cover']}"]
        L += [f"- axis: {a}" for a in e["axes"]] or ["- axis: "]
        L += [f"- pages: {','.join(str(x) for x in sorted(e['pages']))}", ""]
    with open(os.path.join(case_dir, "FV_ASSETS.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def thumb_data_uri(path, max_w=360):
    try:
        from PIL import Image
        with Image.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((max_w, max_w * 2))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=78)
            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        with open(path, "rb") as f:
            return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    except OSError:
        return ""                      # 読めない画像はレビューで空枠にする（資料側は usable() で弾いている）


REASONS = ["案件と関係ない", "その社の商品ではない", "型の分類が違う", "載せたくない画像（顔・炎上・古い）"]


def write_review(case_dir, doc, imgs):
    out = os.path.join(case_dir, "review")
    os.makedirs(out, exist_ok=True)
    pj = doc["project"]
    pages = doc["pages"]
    pno = doc.get("page_no") or phys_pages(doc["order"])
    alts_all = doc.get("alternatives") or {}
    # ページ名は紙面のキッカーと同じ文言・同じ番号（P4 が落ちたら詰めた番号）にする
    names = {1: "表紙"}
    for k, no in pno.items():
        names[no] = (pages.get(k) or {}).get("kicker") or k
    n_plans = len((pages.get("plans") or {}).get("items") or [])

    def variant_lines(key):
        alts = alts_all.get(key) or []
        cur = (pages.get(key.split(".")[0]) or {}).get(key.split(".")[1], "")
        return [(i + 1, a, a == cur) for i, a in enumerate(alts)]

    # 前日チェック（選択式）
    md = [f"# 初訪 前日チェック（{pj['client']}・{pj['date_label'] or '日付未設定'}）", "",
          "資料を開き、各項目で1つ選ぶ。「差し替え」は理由も選ぶ。結果は review/初訪_レビュー.html の「結果をコピー」でも作れる。", "",
          "- [ ] 掲載サムネに案件と関係ない投稿が無い　［なし／あり→ 番号: ＿＿ ］",
          "- [ ] 競合はクライアントの認識と合う　［確認済み／未確認→次回ページで聞く］",
          "- [ ] 「いま伸びている型」の型で良い　［はい／差し替え→候補は付録2の表から選ぶ］",
          f"- [ ] 「まずこの{n_plans}本」の商品は合っている　［はい／違う→ focus_products を直す］",
          "- [ ] 見出しはこのままで良い　［はい／別案に変える→ 下の案の番号を fv_copy.json に {\"<キー>\": {\"variant\": 番号}}］", ""]
    for key in alts_all:
        if key.endswith("headline") and len(alts_all[key]) > 1:
            md.append(f"  - {key}: " + " ／ ".join(f"{i}) {a}{'（いま）' if cur else ''}" for i, a, cur in variant_lines(key)))
    md += ["", "## 掲載している投稿", ""]
    for vid, e in imgs.items():
        md.append(f"- p{','.join(str(x) for x in sorted(e['pages']))}　…{vid[-6:]}　@{e['author'] or ''}　"
                  f"{' / '.join(e['axes'])}　{e['url'] or ''}")
    if doc.get("warnings"):
        md += ["", "## 警告", ""] + [f"- {w}" for w in doc["warnings"]]
    with open(os.path.join(out, "初訪_前日チェック.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    # レビュー用 HTML（1ファイルで完結。サムネは data URI）。全ページに節を作る（画像の無い次回ページも見出しを選べる）
    esc = html.escape
    by_page: dict[int, list] = {}
    for vid, e in imgs.items():
        for pgno in e["pages"]:
            by_page.setdefault(pgno, []).append((vid, e))
    key_of = {no: k for k, no in pno.items()}
    blocks = []
    for no in [1] + sorted(key_of):
        key = key_of.get(no)
        head = (pages.get(key) or {}).get("headline", "") if key else pj["cover_title"].replace("\n", " ")
        opts = ""
        if key and len(alts_all.get(f"{key}.headline") or []) > 1:
            hk = f"{key}.headline"
            opts = "".join(
                f'<label><input type="radio" name="h{no}" value="{i}" data-key="{esc(hk)}" data-cur="{1 if cur else 0}"'
                f'{" checked" if cur else ""}> 案{i}{"（いま）" if cur else ""}: {esc(a)}</label>'
                for i, a, cur in variant_lines(hk))
        cards = []
        for vid, e in by_page.get(no, []):
            v = esc(vid, quote=True)
            uri = thumb_data_uri(os.path.join(case_dir, e["cover"]))
            reasons = "".join(f"<option>{esc(r)}</option>" for r in REASONS)
            cards.append(f'<div class="c"><img src="{uri}" alt=""><div class="m">…{esc(vid[-6:])}　@{esc(e["author"] or "")}</div>'
                         f'<label><input type="radio" name="v{no}_{v}" value="ok" checked> OK</label>'
                         f'<label><input type="radio" name="v{no}_{v}" value="ng" data-vid="{v}" data-page="{no}"> 差し替え</label>'
                         f'<select data-vid="{v}" data-page="{no}">{reasons}</select></div>')
        blocks.append(f'<section><h2>P{no}　{esc(names.get(no, ""))}</h2><p class="h">{esc(head)}</p>'
                      f'<div class="alts" data-page="{no}">{opts}</div><div class="g">{"".join(cards)}</div></section>')
    # <script> の中は HTML の実体参照が効かない。JS の文字列は json.dumps で作る（「P&G」「L'Oréal」「\\u」でも壊れない）
    title_js = json.dumps(f"初訪レビュー結果（{pj['client']}）", ensure_ascii=False).replace("<", "\\u003c")
    page_html = f"""<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>初訪レビュー</title><style>
:root{{--bg:#F6F4EF;--ink:#17181C;--sub:#6E6B66;--rule:#D9D5CC;--acc:#A24765}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif}}
header{{position:sticky;top:0;background:var(--ink);color:#fff;padding:12px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;z-index:2}}
button{{background:var(--acc);color:#fff;border:0;padding:8px 14px;border-radius:4px;font-size:13px}}
section{{padding:8px 16px 18px;border-bottom:1px solid var(--rule)}} h2{{font-size:15px;margin:14px 0 4px}}
.h{{font-family:"Hiragino Mincho ProN",serif;font-size:19px;font-weight:bold;margin:4px 0 8px}}
.alts label{{display:block;font-size:13px;margin:2px 0}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}}
.c{{background:#FAF8F4;border:1px solid var(--rule);border-radius:6px;padding:8px;font-size:12px}}
.c img{{width:100%;border-radius:4px;min-height:40px;background:#e8e5de}} .m{{color:var(--sub);margin:4px 0}} .c label{{margin-right:8px}} select{{width:100%;margin-top:4px}}
textarea{{width:calc(100% - 32px);margin:12px 16px;height:120px}}
</style><header><b>初訪レビュー（{esc(pj['client'])}）</b><button id="cp">結果をコピー</button>
<span style="font-size:12px;color:#bbb">コピーした結果を、資料を作った担当（Claude）にそのまま貼ってください</span></header>
{''.join(blocks)}<textarea id="out" readonly></textarea>
<script>
document.getElementById('cp').onclick=()=>{{
 const L=[{title_js}];
 document.querySelectorAll('.alts').forEach(a=>{{const r=a.querySelector('input:checked');if(r&&r.dataset.cur!=='1')L.push(`P${{a.dataset.page}} 見出し: 案${{r.value}}（fv_copy.json: {{"${{r.dataset.key}}": {{"variant": ${{r.value}}}}}}）`);}});
 document.querySelectorAll('input[value=ng]:checked').forEach(i=>{{const s=document.querySelector(`select[data-vid="${{i.dataset.vid}}"][data-page="${{i.dataset.page}}"]`);L.push(`差し替え P${{i.dataset.page}} …${{i.dataset.vid.slice(-6)}}（${{i.dataset.vid}}）理由: ${{s.value}}`);}});
 if(L.length===1)L.push('すべてOK');
 const t=L.join('\\n');const o=document.getElementById('out');o.value=t;o.select();
 try{{navigator.clipboard.writeText(t);}}catch(e){{document.execCommand('copy');}}
}};
</script></html>"""
    with open(os.path.join(out, "初訪_レビュー.html"), "w", encoding="utf-8") as f:
        f.write(page_html)
    # 掲載サムネ一覧
    try:
        from PIL import Image, ImageDraw, ImageFont
        items = [(vid, e) for vid, e in imgs.items()]
        cols, tw, th = 6, 220, 391
        rows = (len(items) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, max(1, rows) * (th + 34)), (245, 244, 239))
        dr = ImageDraw.Draw(sheet)
        try:
            font = ImageFont.load_default(size=20)
        except TypeError:
            font = ImageFont.load_default()
        for i, (vid, e) in enumerate(items):
            x, y = (i % cols) * tw, (i // cols) * (th + 34)
            try:
                im = Image.open(os.path.join(case_dir, e["cover"])).convert("RGB")
                im.thumbnail((tw - 8, th - 8))
                sheet.paste(im, (x + (tw - im.width) // 2, y + 34))
            except OSError:
                pass
            dr.text((x + 6, y + 6), f"p{','.join(str(p) for p in sorted(e['pages']))} ..{vid[-6:]}", fill=(23, 24, 28), font=font)
        sheet.save(os.path.join(out, "初訪_掲載サムネ一覧.jpg"), quality=82)
    except ImportError:
        pass



def _utf8_stdio():
    """日本語 Windows のパイプ（cp932）で絵文字入りのキャプションを print すると落ちる。置換して続ける"""
    for st_ in (sys.stdout, sys.stderr):
        if hasattr(st_, "reconfigure"):
            try:
                st_.reconfigure(errors="replace")
            except (ValueError, OSError):
                pass

def main() -> int:
    _utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--case", required=True)
    ap.add_argument("--dry-run", action="store_true", help="何も書かない")
    ap.add_argument("--json", action="store_true", help="結果を JSON で標準出力（gaps.py 用）")
    ap.add_argument("--list-copy", action="store_true", help="見出しの別案を番号つきで出す（fv_copy.json で選ぶ）")
    args = ap.parse_args()
    case_dir = os.path.abspath(os.path.expanduser(args.case))
    try:
        b = Builder(case_dir, dry=args.dry_run)
        doc = b.build()
    except SystemExit as e:
        if args.json:
            print(json.dumps({"ok": False, "blocking": [str(e.code)], "warnings": [], "pages": []}, ensure_ascii=False))
            return 1
        raise
    if args.json:
        print(json.dumps({"ok": doc.get("ok", False), "blocking": doc.get("blocking", []),
                          "warnings": doc.get("warnings", []),
                          "pages": doc.get("pages_status") or doc.get("pages", [])}, ensure_ascii=False, indent=1))
        return 0 if doc.get("ok") else 1
    if not doc.get("ok"):
        print("[停止] 初訪資料を作れません:")
        for x in doc["blocking"]:
            print("  - " + x)
        for w in doc.get("warnings", []):
            print("  ! " + w)
        return 1
    if args.list_copy:
        for k, alts in doc["alternatives"].items():
            print(f"{k}:")
            for i, a in enumerate(alts, start=1):
                print(f"  {i}) {a}")
        print('\n選ぶときは fv_copy.json に {"now.headline": {"variant": 2}} のように書く')
        return 0
    if args.dry_run:
        print("dry-run: 何も書いていません")
        return 0
    imgs = used_images(doc)
    raw = json.dumps(doc, ensure_ascii=False, indent=1).encode("utf-8")
    with open(os.path.join(case_dir, "first_visit.json"), "wb") as f:
        f.write(raw)
    write_assets_md(case_dir, imgs, hashlib.sha256(raw).hexdigest())
    write_review(case_dir, doc, imgs)
    print(f"→ {os.path.join(case_dir, 'first_visit.json')}")
    print(f"本編: 表紙 → {' → '.join(doc['order'])} → 付録2枚（計 {1 + len(doc['order']) + 2}枚）")
    for k in doc["order"]:
        print(f"  P{doc['page_no'][k]} {doc['pages'][k]['headline']}")
    print(f"前日レビュー: review/初訪_レビュー.html ・ review/初訪_前日チェック.md（掲載画像 {len(imgs)}枚）")
    if doc["warnings"]:
        print(f"警告 {len(doc['warnings'])}件:")
        for w in doc["warnings"]:
            print("  - " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
