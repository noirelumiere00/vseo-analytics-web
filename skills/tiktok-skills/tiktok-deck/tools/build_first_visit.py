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
                   views_label, width_units, is_domestic_lang)
from label_posts import axes_of, axis_key, validate  # noqa: E402

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
PAGE_NO = {"now": 2, "competitors": 3, "paid": 4, "gap": 5, "winning": 6, "plans": 7, "next": 8}


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
        self.posts = self.labels["posts"]
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
        self.category = self.cfg.get("category") or self.kw["name"]
        self.products = [p for p in (self.cfg.get("focus_products") or []) if p][:3]
        self.acquired_on = self.cfg.get("acquired_on")
        if not self.acquired_on:
            f = os.path.join(case_dir, self.kw["file"])
            self.acquired_note = "（取得JSONのファイル日付。参考）"
            self.acquired_on = dt.date.fromtimestamp(os.path.getmtime(f)).isoformat() if os.path.exists(f) else None
        else:
            self.acquired_note = ""
        self._check_primary_axis()

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

    def _check_primary_axis(self):
        vs, meta = load_axis(self.case_dir, self.kw["file"])
        ok, why = order_is_display(meta)
        if not ok:
            self.blocking.append(f"カテゴリ検索「{self.query}」: {why}")
        top = vs[:20]
        foreign = [v for v in top if not is_domestic_lang(v.get("textLanguage"))]
        if top and len(foreign) / len(top) > CLAIM["foreign_max"]:
            self.blocking.append(f"カテゴリ検索の上位20本のうち外国語が{len(foreign)}本。取得地域が日本でない疑い。取り直してください")
        self.kw_raw = vs

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

    def usable(self, p, allow_frame=True) -> bool:
        if not p.get("cover") or not os.path.exists(os.path.join(self.case_dir, p["cover"])):
            return False
        m = self.manifest.get(p["video_id"]) or {}
        if not allow_frame and m.get("via") == "frame":
            return False
        sha = m.get("sha256")
        if sha:
            first = self.usage.sha_seen.setdefault(sha, p["video_id"])
            if first != p["video_id"]:
                return False          # 同じ画像の転載・再投稿は上位の1本だけを例にする
        return True

    def card(self, p, page: int, **extra) -> dict:
        self.usage.use(p, page)
        c = {"video_id": p["video_id"], "cover": p["cover"], "url": p.get("url"),
             "views": p.get("views"), "views_label": views_label(p.get("views")),
             "rank": p.get("_rank"), "axis": p.get("_axis"), "tile": p.get("_tile"),
             "is_pr": bool(p.get("is_pr")), "poster": p.get("poster"), "author": p.get("author"),
             "media": p.get("media"), "image_count": p.get("image_count"),
             "angle": p.get("angle"), "appeal": p.get("appeal")}
        c.update(extra)
        return c

    def pick_cards(self, ps, page: int, n: int, key=None, allow_frame=True) -> list[dict]:
        out = []
        for p in sorted(ps, key=key) if key else ps:
            if len(out) >= n:
                break
            if self.usable(p, allow_frame) and self.usage.ok(p, page):
                out.append(p)
        return out

    def dist(self, ps, field) -> list[dict]:
        table = self.A if field == "angle" else self.P
        n = len(ps)
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
            nums = set(re.findall(r"\d+(?:\.\d+)?", t))
            # 使ってよい数字＝機械が出した値（テンプレ候補に出てくる数字）。それ以外の数字は書かせない
            allowed = set(numbers or set()) | {n for c in cands for n in re.findall(r"\d+(?:\.\d+)?", c)}
            if nums - allowed:
                raise Stop(f"[致命的] fv_copy.json {key} の数字 {sorted(nums - allowed)} が機械の値と合いません")
            self.manual.append({"key": key, "text": t, "by": ov["by"], "reason": ov["reason"]})
            return t
        if not fits:
            raise Stop(f"[致命的] {key}: どの見出し案も上限{LIMITS[limit]}字を超えます。"
                       f"社名・カテゴリ名の短縮名（case.json の short / category）を設定してください。候補: {cands}")
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
        grid = []
        for p in rel:
            if len(grid) >= 8:
                break
            if self.usable(p, allow_frame=False) and self.usage.ok(p, 2):
                grid.append(p)
        size = 8 if len(grid) >= 8 else 6 if len(grid) >= 6 else 4 if len(grid) >= 4 else 0
        if not size:
            self.blocking.append(f"現状ページ: 例示できる投稿が{len(grid)}本（関連・カバーあり・検索画面のカバー）。"
                                 "4本未満ではカテゴリ語が広すぎるか、カバーの取得に失敗している")
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
        ad = self.dist(rel, "angle")
        a1 = self.top(ad)
        a2 = next((r for r in ad if r is not a1 and r["id"] not in RESERVED), None)
        strong_a = a1 and a1["share"] >= CLAIM["now_angle_share"] and a1["count"] >= CLAIM["now_angle_k"]
        joint = sum(1 for p in rel if groups.get(p.get("poster"), "個人") == gtop and a1 and p.get("angle") == a1["id"]) / len(rel) if rel else 0
        q = self.query
        cands = []
        if strong_a and gtop:
            cands.append(f"「{q}」の上位は、{gtop}の「{a1['short']}」投稿{self.word(joint)}")
        if strong_a:
            cands.append(f"「{q}」の上位は、「{a1['short']}」投稿{self.word(a1['share'])}")
        if a1 and a2 and not strong_a:
            cands.append(f"「{q}」の上位は、「{a1['short']}」と「{a2['short']}」が混在")
        if gtop:
            cands.append(f"「{q}」の上位は、{gtop}の投稿{self.word(gshare)}")
        cands.append(f"「{q}」の上位は、投稿がばらばら")
        head = self.choose("now.headline", cands, "headline", {str(len(rel))})
        m, known = self.official_count(self.own) if self.own or self.cfg.get("client") else (None, False)
        subs = []
        if gtop:
            if known:
                subs.append(f"関連{len(rel)}本中{gcount[gtop]}本が{gtop}。{self.client}公式は{m}本")
            subs.append(f"関連{len(rel)}本中{gcount[gtop]}本が{gtop}の投稿")
        sub = self.choose("now.sub", subs or [f"表示順の上位{n_win}本"], "sub",
                          {str(n_win), str(len(rel)), str(gcount.get(gtop, 0)), str(m)})
        mix = [{"id": g, "label": g, "short": g, "count": c} for g, c in sorted(gcount.items(), key=lambda x: -x[1])]
        cards = [self.card(p, 2) for p in grid]
        self.status["now"] = ("ready" if size == 8 else "degraded", f"格子 {size}枚")
        return {"headline": head, "sub": sub, "query": q, "caption": "",
                "cards": cards, "poster_mix": mix, "n_window": n_win, "n_relevant": len(rel),
                "numbers": {"n_window": n_win, "n_relevant": len(rel), "group": gtop,
                            "group_count": gcount.get(gtop, 0), "own_official": m if known else None}}

    def official_count(self, brand) -> tuple[int | None, bool]:
        """主カテゴリの表示順上位 min(30,取得数) 本に、その社の公式アカウントが何本出ているか。
        labels ではなく取得JSONから機械で数える。official_status が confirmed / none の社だけ「0本」と言える"""
        if not brand:
            return None, False
        status = brand.get("official_status") or ("confirmed" if brand.get("official") else "unknown")
        if status == "unknown":
            return None, False
        ids = official_ids(brand)
        win = self.kw_raw[:30]
        k = sum(1 for v in win if str((v.get("author") or {}).get("uniqueId") or "").lower() in ids)
        return k, True

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
            cols.append({
                "brand": b["name"], "short": self.brand_short(b), "color_index": i + 1, "n": len(rel),
                "angle": {"label": ca["label"], "short": ca["short"], "count": ca["count"]} if ca else None,
                "appeal": {"label": cp["label"], "short": cp["short"], "count": cp["count"]} if cp else None,
                "note": None if share_ok else f"関連{len(rel)}本（少数）",
                "scattered": share_ok and not ca,
                "cards": [self.card(p, 3, brand=b["name"], color_index=i + 1) for p in thumbs],
                "confirmed_by_client": b.get("confirmed_by_client", True) is not False,
            })
        if not cols:
            self.status["competitors"] = ("dropped", "関連が3本以上ある競合が無い")
            return None
        claimed = [c for c in cols if c["appeal"]]
        cands = []
        if len(claimed) >= 2 and claimed[0]["appeal"]["short"] != claimed[1]["appeal"]["short"]:
            a, b = claimed[0], claimed[1]
            cands.append(f"{a['short']}は「{a['appeal']['short']}」、{b['short']}は「{b['appeal']['short']}」を押している")
            cands.append(f"{a['short']}は「{a['appeal']['short']}」、{b['short']}は「{b['appeal']['short']}」")
        if len(claimed) >= 2 and len({c["appeal"]["short"] for c in claimed}) == 1:
            cands.append(f"競合はそろって「{claimed[0]['appeal']['short']}」を押している")
        if claimed:
            cands.append(f"{claimed[0]['short']}は「{claimed[0]['appeal']['short']}」を押している")
        cands.append("競合の発信は、切り口がばらけている")
        head = self.choose("competitors.headline", cands, "headline")
        if any(not c["confirmed_by_client"] for c in cols):
            subs = ["※競合は弊社の想定です。ご確認ください"]
        else:
            subs = ["各社の検索上位の関連投稿を、切り口と訴求で分類", "各社の検索上位を、切り口と訴求で分類"]
        sub = self.choose("competitors.sub", subs, "sub")
        self.status["competitors"] = ("ready" if len(cols) >= 2 else "degraded", f"{len(cols)}社")
        return {"headline": head, "sub": sub, "columns": cols}

    # ─────────────── P4 競合がお金をかけて広げている訴求
    def page_paid(self, comp_page):
        pool = []
        for i, b in enumerate(self.comps):
            for p in self.rel("competitor", b["name"], window_only=False):
                # 関連（その社のカテゴリ商品が主役）× PR表記または公式アカウント
                if p.get("is_pr") or p.get("poster") == "official":
                    pool.append((i, b, p))
        pd = self.dist([p for _, _, p in pool], "appeal")
        tp = self.top(pd)
        if len(pool) < CLAIM["paid_min"] or not tp or tp["count"] / len(pool) <= CLAIM["paid_major"]:
            # 独立ページにせず、P3 の各列に1行で吸収する
            if comp_page:
                for c in comp_page["columns"]:
                    mine = [p for _, b, p in pool if b["name"] == c["brand"]]
                    t = self.top(self.dist(mine, "appeal"))
                    if mine and t:
                        c["paid_line"] = f"お金をかけて押しているのは「{t['short']}」"
            self.status["paid"] = ("dropped", f"PR・公式の関連投稿{len(pool)}本（{CLAIM['paid_min']}本以上かつ最多訴求が過半で独立）")
            return None
        by = {}
        for i, b, p in pool:
            if p.get("appeal") == tp["id"]:
                by.setdefault(b["name"], []).append(p)
        lead = max(by, key=lambda k: len(by[k]))
        lead_b = next(b for b in self.comps if b["name"] == lead)
        cards = []
        # 見出しの主張（{lead}が「{top}」を広げている）を画で裏づける順に並べる:
        # 先導社×最多訴求 → 他社×最多訴求 → それ以外。見出しと違う訴求のカードばかりにしない
        order = sorted(pool, key=lambda x: (x[2].get("appeal") != tp["id"], x[1]["name"] != lead,
                                            -(x[2].get("views") or 0)))
        for want_new_brand in (True, False):
            for i, b, p in order:
                if len(cards) >= 4:
                    break
                if want_new_brand and any(c["brand"] == b["name"] for c in cards):
                    continue
                if any(c["video_id"] == p["video_id"] for c in cards):
                    continue
                if self.usable(p) and self.usage.ok(p, 4):
                    cards.append(self.card(p, 4, brand=b["name"], color_index=i + 1,
                                           badge="公式" if p.get("poster") == "official" else "PR",
                                           appeal_label=self.P[p["appeal"]]["label"] if p.get("appeal") else "—"))
        head = self.choose("paid.headline", [
            f"{self.brand_short(lead_b)}は、お金をかけて「{tp['short']}」を広げている",
            f"競合がお金をかけているのは「{tp['short']}」",
        ], "headline")
        sub = self.choose("paid.sub", [
            f"PR・公式の投稿{len(pool)}本中{tp['count']}本が「{tp['short']}」",
        ], "sub", {str(len(pool)), str(tp["count"])})
        self.status["paid"] = ("ready", f"PR・公式 {len(pool)}本")
        return {"headline": head, "sub": sub, "cards": cards, "n": len(pool), "top": tp["id"]}

    # ─────────────── P6 いま伸びている型（先に計算して P5・P7 で使う）
    def compute_winning(self):
        rel = self.rel("category", self.kw["name"])
        pool = [p for p in rel if (p.get("views") or 0) >= CLAIM["min_views"]]
        recent_note = ""
        if self.acquired_on:
            try:
                acq = dt.date.fromisoformat(str(self.acquired_on)[:10])
                rec = [p for p in pool if p.get("create_time")
                       and (acq - dt.date.fromtimestamp(p["create_time"])).days <= CLAIM["recent_days"]]
                if len(rec) >= CLAIM["recent_min"]:
                    pool = rec
                    recent_note = "直近1年"
            except (ValueError, OSError, OverflowError):
                pass
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
        return {"headline": head, "sub": sub, "cards": cards, "winners": bool(W["winners"]),
                "base": W["base"], "n": len(W["pool"])}

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
            src_label = self.brand_short(k0[2][1]) if k0[2] else f"「{self.query}」"
            # 右の枠（まだ無し）が貴社の0本を画で言っているので、根拠行は出所の本数だけにする
            evid = f"{src_label}は{k0[4]}本中{k0[3]}本"
            rows.append({"angle": aid, "label": self.A[aid]["label"], "short": self.A[aid]["short"],
                         "left": left, "right": None,
                         "right_text": "まだ無し" if own_ok else "まだ空席", "evidence": evid})
            if len(rows) >= 3:
                break
        m, known = self.official_count(self.own) if self.own else (None, False)
        if not rows:
            if known and m == 0:
                head = self.choose("gap.headline", [f"「{self.query}」の上位に、{self.client}公式は0本"], "headline")
                self.status["gap"] = ("degraded", "型の空白なし・公式0本で成立")
                return {"headline": head, "sub": self.choose("gap.sub", ["上位30本を公式アカウントで数えた"], "sub"),
                        "rows": [], "mode": "official"}
            self.status["gap"] = ("dropped", "言える空白が無い（自社の関連5本以上で0本の型、または公式0本が要る）")
            return None
        r1 = rows[0]
        if own_ok:
            cands = [f"競合が押す「{r1['short']}」、{self.client}はまだ0本",
                     f"「{r1['short']}」、{self.client}はまだ0本"]
        else:
            cands = [f"「{r1['short']}」は伸びているのに、まだ空席", f"「{r1['short']}」は、まだ空席"]
        head = self.choose("gap.headline", cands, "headline")
        subs = []
        if known:
            subs.append(f"「{self.query}」上位30本に{self.client}公式は{m}本")
        subs.append(f"左が実例、右が{self.client}" if own_ok else "左が市場の実例、右が競合各社")
        sub = self.choose("gap.sub", subs, "sub", {str(m)})
        self.status["gap"] = ("ready" if len(rows) >= 2 else "degraded", f"{len(rows)}型")
        return {"headline": head, "sub": sub, "rows": rows, "mode": "own" if own_ok else "none",
                "right_label": self.client if own_ok else "競合"}

    # ─────────────── P7 まずこの3本
    def page_plans(self, W, gap):
        ids = self.copy.get("plans.angles")
        if ids:
            bad = [i for i in ids if i not in self.A or i in RESERVED]
            if bad:
                raise Stop(f"[致命的] fv_copy.json plans.angles に語彙外の id: {bad}")
            src = [{"id": i, "label": self.A[i]["label"], "short": self.A[i]["short"], "lift": None} for i in ids[:3]]
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
        sub = self.choose("plans.sub", ["伸びている型を、貴社の商品に当てはめた企画の種",
                                        "伸びている型を当てはめた企画の種"], "sub")
        photo = sum(1 for p in cat_rel if p.get("media") == "photo") > len(cat_rel) / 2 if cat_rel else False
        self.status["plans"] = ("ready" if len(items) == 3 else "degraded", f"{len(items)}本")
        return {"headline": head, "sub": sub, "items": items, "photo_major": photo}

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
        st_own = (self.own or {}).get("official_status") or ("confirmed" if (self.own or {}).get("official") else "unknown")
        if st_own == "unknown":
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
        return {"headline": head, "sub": sub, "bring": bring, "ask": ask[:3],
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
        premise = [
            ["取得日", f"{fmt_date(self.acquired_on)}{self.acquired_note}。TikTokの検索画面が実際に表示した順（ログインなし・並び替えなし）。表示順は時刻・地域で変わるスナップショット。"],
            ["集計の対象", f"各検索の表示順上位（カテゴリ{self.labels['window']['category']}本・競合{self.labels['window']['brand']}本・"
             f"{self.client}{self.labels['window']['own']}本）を1本ずつ画像と本文で判定し、「関連」の投稿だけを数えた。競合のPR投稿は順位の外も確認した。"],
            ["分類の方法", f"切り口・訴求は固定の選択肢（{self.vocab.get('title')} v{self.vocab.get('version')}）から1つずつ選んだ。"
             "判定はカバー画像を開いた証拠（一覧シートのコード）付き。投稿者の種類は公式ID・PR表記・フォロワー数で機械的に決めた。"],
            ["PRの判定", f"TikTokの広告フラグ、#PR・#提供・#タイアップ等のタグ、本文の【PR】表記のいずれか（根拠の内訳 広告フラグ{pr_basis_count['isAd']}／タグ{pr_basis_count['tag']}／本文{pr_basis_count['body']}）。広告該当性は判定しない。"],
            ["伸びの定義", f"型の再生中央値 ÷ カテゴリ検索の関連投稿{('（' + W['recent'] + '）') if W['recent'] else ''}の再生中央値。"
             f"{CLAIM['win_k']}本以上・作者{CLAIM['win_authors']}人以上・{CLAIM['win_lift']}倍以上を「伸びている」とした（再生{CLAIM['min_views']:,}未満は除外）。"],
            ["主張の基準", f"現状の型＝関連の{CLAIM['now_angle_share']:.0%}以上かつ{CLAIM['now_angle_k']}本以上／競合の主な切り口・訴求＝関連{CLAIM['col_share_n']}本以上で{CLAIM['col_top_share']:.0%}以上／"
             f"「{self.client}はまだ0本」＝{self.client}の関連{CLAIM['gap_own_n']}本以上で0本／公式0本＝公式IDを確認した社だけ。"],
            ["因果について", "上位に多い型は「上位に多い傾向」で、上位表示の原因とは断定しない。「まずこの3本」は仮説で、効果は次回以降の検証で確かめる。"],
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
        now = self.page_now()
        comp = self.page_competitors()
        paid = self.page_paid(comp) if self.comps else None
        W = self.compute_winning()
        # P5/P7 は P6 の結果を使うが、例示の割り当て優先は P5→P7→P6（ページ番号順ではない）
        gap = self.page_gap(W)
        plans_pre = None
        win = self.page_winning(W)
        plans = self.page_plans(W, gap)
        nxt = self.page_next(plans)
        del plans_pre
        pages = {"now": now, "competitors": comp, "paid": paid, "gap": gap, "winning": win, "plans": plans, "next": nxt}
        allow = set(((self.cfg.get("first_visit") or {}).get("allow_drop")) or [])
        for k, v in pages.items():
            if v is None and k != "paid":
                why = self.status.get(k, ("dropped", ""))[1]
                msg = f"ページ「{k}」を出せません: {why}"
                if k in allow:
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
        order = [k for k in ("now", "competitors", "paid", "gap", "winning", "plans", "next") if pages[k]]
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
            if self.usable(p):
                cover_cards.append(self.card(p, 1))
            if len(cover_cards) >= 3:
                break
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
               "project": project, "order": order, "pages": pages, "cover_cards": cover_cards,
               "appendix": self.appendix(pages, W), "claim": CLAIM, "manual": self.manual,
               "alternatives": self.alt,
               "pages_status": [{"id": k, "status": s, "reason": r} for k, (s, r) in self.status.items()],
               "warnings": self.warnings, "inputs_sha256": self.inputs_sha()}
        # 紙面に出る文字列の最終検査（None・undefined 等が混ざったら止める）
        def walk(o, path):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in ("headline", "sub", "label", "short", "phrase", "evidence", "title", "reason",
                             "caption", "note", "paid_line", "right_text", "service", "cover_title"):
                        if isinstance(v, str):
                            assert_clean(f"{path}.{k}", v)
                    walk(v, f"{path}.{k}")
            elif isinstance(o, list):
                for i, v in enumerate(o):
                    if isinstance(v, str) and path.endswith(("bring", "ask")):
                        assert_clean(path, v)
                    walk(v, f"{path}[{i}]")
        walk({"pages": pages, "project": project}, "fv")
        return doc

    def inputs_sha(self) -> dict:
        files = ["case.json", "labels.json", "fv_copy.json", "assets/covers/manifest.json"]
        files += [ax["file"] for ax in self.axes]
        out = {f: sha256_file(os.path.join(self.case_dir, f)) for f in files}
        out["_vocab"] = self.vocab.get("_sha")
        return out


# ─────────────────────────────── 書き出し

def used_images(doc) -> dict:
    """video_id → {url, cover, axis, pages, tile, author}"""
    out = {}

    def add(c, page):
        if not c or not c.get("cover"):
            return
        e = out.setdefault(c["video_id"], {"url": c.get("url"), "cover": c["cover"], "axis": c.get("axis"),
                                           "pages": [], "tile": c.get("tile"), "author": c.get("author")})
        if page not in e["pages"]:
            e["pages"].append(page)
    for c in doc.get("cover_cards") or []:
        add(c, 1)
    pg = doc["pages"]
    for k, no in PAGE_NO.items():
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


def write_assets_md(case_dir, imgs):
    L = ["# FV ASSETS", "", "<!-- build_first_visit.py が書く。verify_assets.py が照合に使う（手で直さない） -->", ""]
    for vid, e in imgs.items():
        L += [f"#### VIDEO {vid}", f"- url: {e['url']}", f"- image_path: {e['cover']}",
              f"- axis: {e['axis'] or ''}", f"- pages: {','.join(str(x) for x in sorted(e['pages']))}", ""]
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


REASONS = ["案件と関係ない", "その社の商品ではない", "型の分類が違う", "載せたくない画像（顔・炎上・古い）"]


def write_review(case_dir, doc, imgs):
    out = os.path.join(case_dir, "review")
    os.makedirs(out, exist_ok=True)
    pj = doc["project"]
    pages = doc["pages"]
    names = {1: "表紙", 2: "いま検索するとこう見える", 3: "競合はこう発信している", 4: "競合がお金をかけている訴求",
             5: f"{pj['client_short']}に足りていない発信", 6: "いま伸びている型", 7: "まずこの3本", 8: "次回"}
    # 前日チェック（選択式）
    md = [f"# 初訪 前日チェック（{pj['client']}・{pj['date_label']}）", "",
          "資料を開き、各項目で1つ選ぶ。「差し替え」は理由も選ぶ。結果は review/初訪_レビュー.html の「結果をコピー」でも作れる。", "",
          "- [ ] 掲載サムネに案件と関係ない投稿が無い　［なし／あり→ 番号: ＿＿ ］",
          "- [ ] 競合はクライアントの認識と合う　［確認済み／未確認→P8で聞く］",
          "- [ ] 「いま伸びている型」の3つで良い　［はい／差し替え→候補は付録2の表から選ぶ］",
          "- [ ] 「まずこの3本」の商品は合っている　［はい／違う→ focus_products を直す］",
          "- [ ] 見出しはこのままで良い　［はい／別案に変える→ 下の候補番号を fv_copy.json に］", ""]
    for key, alts in (doc.get("alternatives") or {}).items():
        if key.endswith("headline") and len(alts) > 1:
            md.append(f"  - {key}: " + " ／ ".join(f"{i + 1}) {a}" for i, a in enumerate(alts)))
    md += ["", "## 掲載している投稿", ""]
    for vid, e in imgs.items():
        md.append(f"- p{','.join(str(x) for x in sorted(e['pages']))}　…{vid[-6:]}　@{e['author'] or ''}　{e['axis'] or ''}　{e['url']}")
    if doc.get("warnings"):
        md += ["", "## 警告", ""] + [f"- {w}" for w in doc["warnings"]]
    with open(os.path.join(out, "初訪_前日チェック.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    # レビュー用 HTML（1ファイルで完結。サムネは data URI）
    blocks = []
    by_page: dict[int, list] = {}
    for vid, e in imgs.items():
        for pgno in e["pages"]:
            by_page.setdefault(pgno, []).append((vid, e))
    for no in sorted(by_page):
        key = next((k for k, v in PAGE_NO.items() if v == no), None)
        head = (pages.get(key) or {}).get("headline", "") if key else pj["cover_title"].replace("\n", " ")
        alts = (doc.get("alternatives") or {}).get(f"{key}.headline", []) if key else []
        opts = "".join(f'<label><input type="radio" name="h{no}" value="{i}"{" checked" if i == 0 else ""}> '
                       f'{"このまま" if i == 0 else "別案" + str(i)}: {html.escape(a)}</label>' for i, a in enumerate(alts[:3])) \
            if len(alts) > 1 else ""
        cards = []
        for vid, e in by_page[no]:
            uri = thumb_data_uri(os.path.join(case_dir, e["cover"]))
            reasons = "".join(f'<option>{r}</option>' for r in REASONS)
            cards.append(f'<div class="c"><img src="{uri}" alt=""><div class="m">…{vid[-6:]}　@{html.escape(e["author"] or "")}</div>'
                         f'<label><input type="radio" name="v{no}_{vid}" value="ok" checked> OK</label>'
                         f'<label><input type="radio" name="v{no}_{vid}" value="ng" data-vid="{vid}" data-page="{no}"> 差し替え</label>'
                         f'<select data-vid="{vid}" data-page="{no}">{reasons}</select></div>')
        blocks.append(f'<section><h2>P{no}　{html.escape(names.get(no, ""))}</h2><p class="h">{html.escape(head)}</p>'
                      f'<div class="alts" data-page="{no}">{opts}</div><div class="g">{"".join(cards)}</div></section>')
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
.c img{{width:100%;border-radius:4px}} .m{{color:var(--sub);margin:4px 0}} .c label{{margin-right:8px}} select{{width:100%;margin-top:4px}}
textarea{{width:calc(100% - 32px);margin:12px 16px;height:120px}}
</style><header><b>初訪レビュー（{html.escape(pj['client'])}）</b><button id="cp">結果をコピー</button>
<span style="font-size:12px;color:#bbb">コピーした結果を、資料を作った担当（Claude）にそのまま貼ってください</span></header>
{''.join(blocks)}<textarea id="out" readonly></textarea>
<script>
document.getElementById('cp').onclick=()=>{{
 const L=['初訪レビュー結果（{html.escape(pj['client'])}）'];
 document.querySelectorAll('.alts').forEach(a=>{{const r=a.querySelector('input:checked');if(r&&r.value!=='0')L.push(`P${{a.dataset.page}} 見出し: 別案${{r.value}}`);}});
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
    with open(os.path.join(case_dir, "first_visit.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    write_assets_md(case_dir, imgs)
    write_review(case_dir, doc, imgs)
    print(f"→ {os.path.join(case_dir, 'first_visit.json')}")
    print(f"本編: 表紙 → {' → '.join(doc['order'])} → 付録2枚（計 {1 + len(doc['order']) + 2}枚）")
    for k in doc["order"]:
        print(f"  P{PAGE_NO[k]} {doc['pages'][k]['headline']}")
    print(f"前日レビュー: review/初訪_レビュー.html ・ review/初訪_前日チェック.md（掲載画像 {len(imgs)}枚）")
    if doc["warnings"]:
        print(f"警告 {len(doc['warnings'])}件:")
        for w in doc["warnings"]:
            print("  - " + w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
