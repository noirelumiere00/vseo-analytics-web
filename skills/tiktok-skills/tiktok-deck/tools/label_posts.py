#!/usr/bin/env python3
"""label_posts.py — 初訪資料に使う投稿へ「選択式」のラベルを付ける

なぜ選択式か（2026-09 上長FB）:
  前回の初訪資料は、作った人が数字を「翻訳」して文章にしていたため、
  担当者によって中身も質もぶれた。判断を固定語彙からの選択に置き換え、
  文章は語彙と集計からテンプレで組む。これで誰が回しても同じ資料になる。
  また、案件と無関係の投稿（冷凍食品の資料に特撮番組の投稿）が例として載った。
  例に載せられるのは、画像を見て「関連」と確定した投稿だけにする。

選ぶもの（値は tools/vocab/<preset>.json と _common.json の id）:
  relevance  軸ごとに判定。関連／他社の商品（ブランド軸のみ）／カテゴリ外／無関係／判定不可
  angle      切り口＝カバーと冒頭で分かる“作り”（一覧の上ほど優先）       … 関連なら必須
  appeal     訴求＝テロップ・本文が推している“価値の言葉”                … ブランド軸で関連、または PR 投稿なら必須
  投稿者（公式／PR／クリエイター／一般／メディア）は選ばない。機械で決める。

見た証拠:
  --contact が軸ごとの一覧シート（review/contact_<軸コード>_NN.jpg）を作り、各タイルに
  タイル番号（K1-3 など）と4文字のコードを焼き込む。コードは画像の中にしか無い
  （labels.json には遅いハッシュ PBKDF2 だけを置く。総当たりで復元するには1タイルに数時間かかる）。
  patch にはタイル番号とそのコードを書く。見ていない投稿を「見た」扱いにしない
  （過去に「未実見」と書いたコマを紙面に載せた事故がある）。判定は、シートで見せた画像に結び付けて記録し、
  あとでカバーが差し替わっていたら確定を拒む。

使い方:
  python3 tools/label_posts.py --case . --init             # 候補を選ぶ（選択欄は空のまま。機械の推定は guess にだけ）
  python3 tools/label_posts.py --case . --options          # 選べる値と迷ったときの決まり（AI はまずこれを読む）
  python3 tools/label_posts.py --case . --contact          # 一覧シートを作る（コード入り）
  #   → review/contact_*.jpg を開き、タイルごとに patch の行を書く
  python3 tools/label_posts.py --case . --apply review/patch_K1.csv review/patch_C1.csv
  python3 tools/label_posts.py --case . --check            # 未判定・欠け・語彙外・古いラベルを検査（あれば終了コード1）
  python3 tools/label_posts.py --case . --lint-vocab       # 語彙の検査だけ

patch の形（CSV。見出し行必須。値は id・表示名・短縮名のどれでもよい）:
  tile,code,relevance,angle,appeal
  K1-1,K7QA,関連,アレンジ調理,
  C1-3,C3MZ,関連,実食レビュー,おいしさ
  C1-4,X9PE,無関係,,

依存: 標準ライブラリ（一覧シートだけ Pillow。無ければ作れないので案内して止まる）
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fvlib import (load_case, load_vocab, load_json, load_axis, pr_basis, safe_vid, to_epoch,  # noqa: E402
                   is_domestic_lang, official_ids, sha256_file, lint_vocab, RESERVED, order_is_display)

FIELD_JA = {"relevance": "関連性", "angle": "切り口", "appeal": "訴求"}
VOCAB_KEY = {"relevance": "relevance", "angle": "angles", "appeal": "appeals"}
WINDOW_DEFAULT = {"category": 30, "brand": 20, "own": 20}
UNSURE_MAX = 0.25        # 判定不可がこれを超える軸は、カバーだけでは判断できていない
RUBBER_STAMP = 0.9       # 確定ラベルがこの割合以上「機械の推定のまま」なら、見ていない疑い
CODE_ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"   # 0/O/1/I/L は読み違えるので使わない
CODE_LEN = 4                                     # 31^4 ≒ 92万通り
PROOF_ITER = 60_000                              # PBKDF2 の反復回数（1回数十ミリ秒。総当たりは1タイル数時間）


# ─────────────────────────────── 軸

def window_of(cfg: dict) -> dict:
    w = dict(WINDOW_DEFAULT)
    w.update(((cfg.get("first_visit") or {}).get("window")) or {})
    return w


def axes_of(cfg: dict) -> list[dict]:
    """軸の一覧。code はシート名・タイルに焼く短い記号（K1=カテゴリ語1、C1=競合1、S=自社）"""
    out = []
    kws = cfg.get("keywords") or []
    prim = next((k for k in kws if k.get("primary")), kws[0] if kws else None)
    for i, k in enumerate(kws, start=1):
        out.append({"kind": "category", "name": k["name"], "file": k["file"], "code": f"K{i}",
                    "match": k.get("match") or "", "primary": k is prim})
    ci = 0
    for b in cfg.get("brands") or []:
        if not b.get("file"):
            # 「自社の検索：しない」等で取得していない社は軸にしない（公式IDだけは公式露出の判定に使う）
            continue
        if b.get("own"):
            out.append({"kind": "own", "name": b["name"], "file": b["file"], "code": "S",
                        "match": b.get("match") or re.escape(b["name"])})
        else:
            ci += 1
            out.append({"kind": "competitor", "name": b["name"], "file": b["file"], "code": f"C{ci}",
                        "match": b.get("match") or re.escape(b["name"])})
    return out


def axis_key(a: dict) -> str:
    return f"{a['kind']}:{a['name']}"


def category_pattern(cfg: dict) -> str:
    parts = []
    for k in cfg.get("keywords") or []:
        parts.append(k.get("match") or re.escape(k.get("query") or k["name"]))
    if cfg.get("category"):
        parts.append(re.escape(str(cfg["category"])))
    return "|".join(p for p in parts if p)


def text_of(v: dict) -> str:
    return (v.get("desc") or "") + " " + " ".join("#" + t for t in (v.get("hashtags") or []))


def poster_from(author, is_pr: bool, followers, cfg: dict) -> tuple[str, str | None]:
    """投稿者は選ばせない。公式ID・PR根拠・メディア一覧・フォロワー数で機械的に決める。
    build_first_visit.py もこれで数え直す（--init 後に case.json の公式IDを直しても食い違わないように）"""
    uid = str(author or "").lstrip("@").lower()
    for b in cfg.get("brands") or []:
        if uid and uid in official_ids(b):
            return "official", b["name"]
    if is_pr:
        return "creator_pr", None
    if uid and uid in {str(x).lstrip("@").lower() for x in cfg.get("media_accounts") or []}:
        return "media", None
    return ("creator" if followers and followers >= 10_000 else "consumer"), None


def poster_of(v: dict, cfg: dict) -> tuple[str, str | None]:
    au = v.get("author") or {}
    return poster_from(au.get("uniqueId"), bool(pr_basis(v)), au.get("followerCount"), cfg)


def guess(v: dict, ax: dict, catpat: str, vocab: dict, official_brand: str | None) -> dict:
    """機械の推定。選択欄には入れない（前日レビューや --options の参考表示にだけ使う）"""
    t = text_of(v)
    cat_hit = bool(catpat and re.search(catpat, t, re.I))
    brand_hit = bool(ax.get("match") and re.search(ax["match"], t, re.I)) or official_brand == ax["name"]
    if not is_domestic_lang(v.get("textLanguage")):
        rel = "unsure"
    elif ax["kind"] == "category":
        rel = "relevant" if cat_hit else "unsure"
    else:
        rel = "relevant" if (cat_hit and brand_hit) else ("off_category" if brand_hit else "unsure")

    def first_hit(key):
        for e in vocab[key]:
            if e["id"] not in RESERVED and e.get("hint") and re.search(e["hint"], t, re.I):
                return e["id"]
        return None
    return {"relevance": rel, "angle": first_hit("angles"), "appeal": first_hit("appeals"),
            "basis": f"カテゴリ語{'一致' if cat_hit else '不一致'}・ブランド{'一致' if brand_hit else '不一致'}"}


def srate(v):
    s = v.get("stats") or {}
    p = s.get("playCount") or 0
    return round((s.get("collectCount") or 0) / p * 100, 2) if p else None


def record(v: dict, case_dir: str, cfg: dict) -> dict:
    au = v.get("author") or {}
    s = v.get("stats") or {}
    vid = str(v.get("id"))
    cover = f"assets/covers/{vid}.jpg"
    basis = pr_basis(v)
    poster, off_brand = poster_of(v, cfg)
    miss = set(v.get("missingFields") or []) | ({"stats.playCount", "stats.collectCount"} if not s else set())
    return {
        "video_id": vid, "url": v.get("url"),
        "author": au.get("uniqueId"), "author_name": au.get("nickname"),
        "verified": bool(au.get("verified")),
        # search.mjs は欠損を 0 で返すことがある。0 を「フォロワー0人」と読まない
        "followers": au.get("followerCount") or None,
        # search.mjs は取れなかった stats を 0 で出して missingFields に列挙する。0再生と読まない
        "views": None if "stats.playCount" in miss else s.get("playCount"),
        "saves": None if "stats.collectCount" in miss else s.get("collectCount"),
        "save_rate": None if miss & {"stats.playCount", "stats.collectCount"} else srate(v),
        "is_pr": bool(basis), "pr_basis": basis, "is_ad": v.get("isAd") is True,
        "poster": poster, "official_brand": off_brand,
        "media": v.get("mediaType") or None, "image_count": v.get("imageCount") or None,
        "lang": v.get("textLanguage"), "create_time": to_epoch(v.get("createTime")),
        "caption": re.sub(r"\s+", " ", (v.get("desc") or "")).strip(),
        "hashtags": v.get("hashtags") or [],
        "cover": cover if os.path.exists(os.path.join(case_dir, cover)) else None,
        "angle": None, "appeal": None,
        "axes": [],
    }


# ─────────────────────────────── 必須欄と検査（build_first_visit.py もこれを使う）

def required_fields(p: dict, a: dict) -> list[str]:
    need = ["relevance"]
    if a.get("relevance") == "relevant":
        need.append("angle")
        if a["kind"] in ("competitor", "own") or p.get("is_pr"):
            need.append("appeal")
    return need


def value_of(p: dict, a: dict, f: str):
    return a.get("relevance") if f == "relevance" else p.get(f)


def resolve_value(field, raw, vocab):
    """id・表示名・短縮名のどれでも受ける。語彙外は None"""
    s = str(raw or "").strip()
    if not s:
        return None
    for e in vocab[VOCAB_KEY[field]]:
        if s in (e["id"], e["label"], e.get("short")):
            return e["id"]
    return None


def raw_shas(case_dir: str, cfg: dict) -> dict:
    return {axis_key(a): sha256_file(os.path.join(case_dir, a["file"])) for a in axes_of(cfg)}


def validate(case_dir: str, cfg: dict, vocab: dict, doc: dict) -> tuple[list[str], list[str], list[str]]:
    """(errors, warnings, lines)。errors があれば初訪資料は作らない"""
    errors, warnings, lines = [], [], []
    if doc.get("vocab") != vocab["name"]:
        errors.append(f"labels.json の語彙（{doc.get('vocab')}）と case.json の vocab（{vocab['name']}）が違う。--init --reset でやり直す")
    elif doc.get("vocab_sha") and doc.get("vocab_sha") != vocab.get("_sha"):
        errors.append("語彙ファイルがラベル付けの後に変わった。--check で差分を確認し、必要なら --init からやり直す")
    cur = raw_shas(case_dir, cfg)
    had = set((doc.get("raw_sha") or {}).keys())
    if had and had != set(cur):
        # 競合を足した・外した等。軸が変わると窓と分母が変わるので、ラベルを作り直す
        errors.append("case.json の検索軸がラベル付けの後に変わった"
                      f"（増: {sorted(set(cur) - had) or 'なし'} / 減: {sorted(had - set(cur)) or 'なし'}）。--init をやり直す（判定済みは引き継ぐ）")
    for k, sha in (doc.get("raw_sha") or {}).items():
        if k in cur and cur[k] != sha:
            errors.append(f"取得JSONがラベル付けの後に変わった（{k}）。順位と窓が変わるので --init からやり直す")
    posts = doc.get("posts") or []
    per_axis = {}
    for p in posts:
        for f in ("angle", "appeal"):
            v = p.get(f)
            if v is not None and resolve_value(f, v, vocab) != v:
                errors.append(f"{p['video_id']}: {FIELD_JA[f]}={v} は語彙外（id で持つ）")
        for a in p["axes"]:
            st = per_axis.setdefault(axis_key(a), {"win": 0, "done": 0, "unsure": 0, "rel": 0, "undecided": []})
            if a.get("relevance") is not None and resolve_value("relevance", a["relevance"], vocab) != a["relevance"]:
                errors.append(f"{p['video_id']}: 関連性={a['relevance']} は語彙外")
            if a.get("relevance") == "other_brand" and a["kind"] == "category":
                errors.append(f"{p['video_id']}: カテゴリ軸で「他社の商品」は使えない（カテゴリ軸では他社の商品も「関連」）")
            if a.get("in_window"):
                st["win"] += 1
                if a.get("confirmed"):
                    st["done"] += 1
                    st["unsure"] += a.get("relevance") == "unsure"
                    st["rel"] += a.get("relevance") == "relevant"
                else:
                    st["undecided"].append(a.get("tile") or p["video_id"][-6:])
            if a.get("confirmed"):
                miss = [FIELD_JA[f] for f in required_fields(p, a) if not value_of(p, a, f)]
                if miss:
                    errors.append(f"{p['video_id']}（{axis_key(a)}）: 確定済みなのに未選択（{'・'.join(miss)}）")
                if a.get("relevance") == "relevant" and p.get("cover"):
                    # 紙面に載りうるのは relevant だけ。判定時に見せた画像と今の画像が同じであること
                    now = sha256_file(os.path.join(case_dir, p["cover"]))
                    if not now:
                        errors.append(f"{p['video_id']}: 判定したカバー画像が消えた。fetch_covers.py で取り直し、--contact で見直す")
                    elif not a.get("cover_sha"):
                        errors.append(f"{p['video_id']}（{axis_key(a)}）: カバーが無い状態で「関連」と確定し、後からカバーが付いた。"
                                      "--contact で画像を見て --apply し直す")
                    elif now != a["cover_sha"]:
                        errors.append(f"{p['video_id']}: 判定した後にカバー画像が変わった。見直して --apply し直す")
    for k, st in per_axis.items():
        lines.append(f"  {k}: 窓内 判定 {st['done']}/{st['win']}・関連 {st['rel']}・判定不可 {st['unsure']}")
        if st["undecided"]:
            errors.append(f"{k}: 未判定 {' '.join('#' + str(x) for x in st['undecided'][:15])}"
                          f"{' …' if len(st['undecided']) > 15 else ''} を判定してください（窓内は全件判定が必要）")
        if st["done"] and st["unsure"] / max(st["win"], 1) > UNSURE_MAX:
            errors.append(f"{k}: 判定不可が{st['unsure']}/{st['win']}本。カバーだけでは判断できない投稿が多すぎる。"
                          "tools/extract_frames.py で冒頭を抜いて見直す")
    conf = [(p, a) for p in posts for a in p["axes"] if a.get("confirmed") and a.get("relevance") == "relevant"]
    if len(conf) >= 10:
        same = sum(1 for p, a in conf if a.get("relevance") == (p.get("guess_by_axis") or {}).get(axis_key(a), {}).get("relevance")
                   and p.get("angle") == (p.get("guess") or {}).get("angle")
                   and p.get("appeal") == (p.get("guess") or {}).get("appeal"))
        if same / len(conf) >= RUBBER_STAMP:
            warnings.append(f"確定ラベルの{same / len(conf):.0%}が機械の推定と同じ。画像を見て判定したか確認する"
                            "（推定は本文のキーワード一致でしかない）")
    return errors, warnings, lines


# ─────────────────────────────── 各コマンド

def cmd_init(case_dir, cfg, vocab, args):
    win = window_of(cfg)
    catpat = category_pattern(cfg)
    lp = os.path.join(case_dir, "labels.json")
    old = {} if args.reset or not os.path.exists(lp) else {p["video_id"]: p for p in load_json(lp).get("posts", [])}
    posts, by_id = [], {}
    for ax in axes_of(cfg):
        vs, meta = load_axis(case_dir, ax["file"], allow_empty=ax["kind"] != "category")
        ok_order, why = order_is_display(meta)
        if not ok_order:
            # 並べ替えた結果や CAPTCHA 下の取得を「上位」として扱わない（主カテゴリ以外の軸も同じ）
            raise SystemExit(f"[致命的] {ax['kind']}:{ax['name']}（{ax['file']}）: {why}")
        top = win["category"] if ax["kind"] == "category" else win["own"] if ax["kind"] == "own" else win["brand"]
        picked = [(r, v, True) for r, v in enumerate(vs, start=1) if r <= top]
        if ax["kind"] == "competitor":
            # 競合がお金をかけて広げている訴求（P4）は下位にあることが多い。PR は順位に関係なく候補に入れる
            picked += [(r, v, False) for r, v in enumerate(vs, start=1) if r > top and pr_basis(v)]
        for rank, v, in_window in picked:
            vid = safe_vid(v.get("id"))
            if not vid:
                # 投稿IDはパスと HTML に使う。数字以外（手で直した raw 等）は候補に入れない
                print(f"  ! {ax['kind']}:{ax['name']} {rank}位: 投稿ID {str(v.get('id'))[:40]!r} が数字でないため外しました")
                continue
            if vid not in by_id:
                r = record(v, case_dir, cfg)
                prev = old.get(vid)
                if prev:
                    r["angle"], r["appeal"] = prev.get("angle"), prev.get("appeal")
                by_id[vid] = r
                posts.append(r)
            r = by_id[vid]
            if any(a["kind"] == ax["kind"] and a["name"] == ax["name"] for a in r["axes"]):
                continue
            g = guess(v, ax, catpat, vocab, r["official_brand"])
            r.setdefault("guess_by_axis", {})[axis_key(ax)] = {"relevance": g["relevance"], "basis": g["basis"]}
            if not r.get("guess"):
                r["guess"] = {"angle": g["angle"], "appeal": g["appeal"]}
            entry = {"kind": ax["kind"], "name": ax["name"], "code": ax["code"], "rank": rank,
                     "in_window": in_window, "relevance": None, "confirmed": False}
            prev_a = next((a for a in (old.get(vid) or {}).get("axes", [])
                           if a["kind"] == ax["kind"] and a["name"] == ax["name"]), None)
            if prev_a and prev_a.get("confirmed"):
                # 確定済みの判定は引き継ぐ（取得をやり直していなければ順位も同じ）
                for k in ("relevance", "confirmed", "cover_sha", "labeled_at", "tile", "sheet"):
                    entry[k] = prev_a.get(k)
            r["axes"].append(entry)
    if not posts:
        raise SystemExit("[致命的] 候補投稿が0件です。case.json の keywords / brands と取得JSONを確認してください")
    for r in posts:
        r["confirmed"] = all(a.get("confirmed") for a in r["axes"])
    doc = {"vocab": vocab["name"], "vocab_version": vocab.get("version"), "vocab_sha": vocab.get("_sha"),
           "raw_sha": raw_shas(case_dir, cfg), "window": win, "salt": secrets.token_hex(8),
           "generated_at": dt.datetime.now().isoformat(timespec="seconds"), "posts": posts}
    save(case_dir, doc)
    n_tiles = sum(len(p["axes"]) for p in posts)
    nocov = sum(1 for p in posts if not p["cover"])
    print(f"→ {lp}（投稿 {len(posts)}本・判定するタイル {n_tiles}枚 / カバー無し {nocov}本）")
    if nocov:
        print("  ! カバーが無い投稿は例示に使えません。先に tools/fetch_covers.py --case . を実行し、--init をやり直してください")
    print("次: --options を読む → --contact → 一覧シートを見て patch を書く → --apply → --check")
    return 0


def code_hash(salt, vid, akey, code, iters=PROOF_ITER):
    """見た証拠のハッシュ。3文字×sha256 だと labels.json の salt から約2秒で全タイルを復元できた
    （2026-09 レビュー）。4文字×PBKDF2 にして、画像を開くほうがずっと早いようにする"""
    return hashlib.pbkdf2_hmac("sha256", str(code).encode(), f"{salt}|{vid}|{akey}".encode(), iters).hex()


def cmd_contact(case_dir, cfg, vocab, args):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise SystemExit("[致命的] 一覧シートには Pillow が要ります（pip install Pillow）。"
                         "見た証拠のコードはシートの画像にしか出ないため、シート無しでは確定できません")
    lp = os.path.join(case_dir, "labels.json")
    if not os.path.exists(lp):
        raise SystemExit("[致命的] labels.json がありません。先に --init を実行してください")
    doc = load_json(lp)
    out_dir = os.path.join(case_dir, "review")
    os.makedirs(out_dir, exist_ok=True)
    cols, rows_, tw, th = 4, 3, 300, 533
    per = cols * rows_
    try:
        font = ImageFont.load_default(size=26)
        small = ImageFont.load_default(size=20)
    except TypeError:
        font = small = ImageFont.load_default()
    used = set()
    made = []
    for ax in axes_of(cfg):
        if args.axis and args.axis not in (ax["code"], ax["name"]):
            continue
        entries = [(p, a) for p in doc["posts"] for a in p["axes"]
                   if a["kind"] == ax["kind"] and a["name"] == ax["name"] and not a.get("confirmed")]
        entries.sort(key=lambda pa: (not pa[1]["in_window"], pa[1]["rank"]))
        if not entries:
            continue
        for si in range(0, len(entries), per):
            chunk = entries[si:si + per]
            sheet_no = si // per + 1
            name = f"contact_{ax['code']}_{sheet_no:02d}"
            img = Image.new("RGB", (cols * tw, ((len(chunk) + cols - 1) // cols) * (th + 44)), (245, 244, 239))
            dr = ImageDraw.Draw(img)
            listing = []
            for i, (p, a) in enumerate(chunk):
                x, y = (i % cols) * tw, (i // cols) * (th + 44)
                n = si + i + 1
                code = "".join(secrets.choice(CODE_ALPHA) for _ in range(CODE_LEN))
                while code in used:
                    code = "".join(secrets.choice(CODE_ALPHA) for _ in range(CODE_LEN))
                used.add(code)
                a["code_hash"] = code_hash(doc["salt"], p["video_id"], axis_key(a), code)
                a["proof_iter"] = PROOF_ITER
                a["tile"] = f"{ax['code']}-{n}"
                a["sheet"] = f"review/{name}.jpg"
                # シートに実際に見せた画像。確定時に今のカバーと照合する（見た後の差し替えを検知する）
                a["shown_sha"] = sha256_file(os.path.join(case_dir, p["cover"])) if p.get("cover") else None
                if p.get("cover"):
                    try:
                        im = Image.open(os.path.join(case_dir, p["cover"])).convert("RGB")
                        im.thumbnail((tw - 10, th - 10))
                        img.paste(im, (x + (tw - im.width) // 2, y + 44 + (th - im.height) // 2))
                    except OSError:
                        dr.text((x + 12, y + 260), "unreadable", fill=(160, 0, 0), font=font)
                else:
                    dr.text((x + 12, y + 260), "no cover", fill=(160, 0, 0), font=font)
                # ASCII だけを焼く（既定フォントに日本語の字形が無い）
                dr.rectangle([x + 4, y + 4, x + 112, y + 40], fill=(23, 24, 28))
                dr.text((x + 12, y + 8), code, fill=(255, 255, 255), font=font)
                tag = f"{a['tile']} r{a['rank']}" + (" PR" if p.get("is_pr") else "") + \
                      (" OFF" if p.get("poster") == "official" else "") + ("" if a["in_window"] else " +")
                dr.text((x + 120, y + 12), tag, fill=(23, 24, 28), font=small)
                listing.append(f"{a['tile']}\t{a['rank']}位{'' if a['in_window'] else '（窓外PR）'}\t"
                               f"{p['video_id']}\t{'PR ' if p.get('is_pr') else ''}{'公式 ' if p.get('poster') == 'official' else ''}"
                               f"{p.get('views') or 0:,}再生\t{p['caption'][:60]}")
            img.save(os.path.join(out_dir, name + ".jpg"), quality=85)
            with open(os.path.join(out_dir, name + ".txt"), "w", encoding="utf-8") as f:
                f.write(f"# {name}.jpg の中身（{ax['kind']}:{ax['name']}）。コードは画像の中にだけある\n")
                f.write("\n".join(listing) + "\n")
            made.append((name, len(chunk)))
    save(case_dir, doc)
    if not made:
        print("未確定のタイルはありません")
        return 0
    for name, n in made:
        print(f"→ review/{name}.jpg（{n}枚）と review/{name}.txt")
    print("各タイルの左上の4文字コードとタイル番号（K1-3 等）を patch の code・tile 列に書く（コードは画像にしか無い）。"
          "patch は review/patch_<軸コード>.csv に1軸ずつ書くとよい。--contact をやり直すとコードと番号は変わる")
    return 0


def read_patch(path):
    if path.lower().endswith(".json"):
        d = load_json(path)
        return d.get("rows") if isinstance(d, dict) else d
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def cmd_apply(case_dir, cfg, vocab, args):
    lp = os.path.join(case_dir, "labels.json")
    if not os.path.exists(lp):
        raise SystemExit("[致命的] labels.json がありません。先に --init を実行してください")
    doc = load_json(lp)
    by_tile = {}
    for p in doc["posts"]:
        for a in p["axes"]:
            if a.get("code_hash") and a.get("tile"):
                by_tile[a["tile"]] = (p, a)
    bad, staged, seen_tiles = [], [], set()
    batch_vals: dict[tuple, str] = {}
    rows = [(path, r) for path in args.apply for r in read_patch(path)]
    for path, row in rows:
        tile = str(row.get("tile") or "").strip().upper()
        code = str(row.get("code") or "").strip().upper()
        where = f"{os.path.basename(path)} {tile or 'tile=空'}"
        if not tile or not code:
            bad.append(f"{where}: tile と code の両方が要る（一覧シートの画像のタイル左上に出ている）")
            continue
        if tile in seen_tiles:
            bad.append(f"{where}: 同じタイルが2回ある")
            continue
        seen_tiles.add(tile)
        hit = by_tile.get(tile)
        if not hit or hit[1].get("code_hash") != code_hash(doc["salt"], hit[0]["video_id"], axis_key(hit[1]), code,
                                                             hit[1].get("proof_iter") or PROOF_ITER):
            bad.append(f"{where}: タイル番号とコードが一致しません。最新の一覧シート（--contact で作り直すとコードも番号も変わる）を開いて読み直す")
            continue
        p, a = hit
        new = {}
        ok = True
        for f in ("relevance", "angle", "appeal"):
            raw = row.get(f)
            if raw in (None, ""):
                continue
            rv = resolve_value(f, raw, vocab)
            if rv is None or (f == "angle" and rv == "none"):
                opts = " / ".join(e["label"] for e in vocab[VOCAB_KEY[f]])
                bad.append(f"{where}: {FIELD_JA[f]}「{raw}」は語彙にない（選べる値: {opts}）")
                ok = False
                break
            new[f] = rv
        if not ok:
            continue
        rel = new.get("relevance")
        if not rel:
            bad.append(f"{where}: 関連性が空")
            continue
        if rel == "other_brand" and a["kind"] == "category":
            # カテゴリ軸では他社の商品でも「関連」。他社として外すと分母が変わる
            bad.append(f"{where}: 「他社の商品」はブランド軸だけで使う。カテゴリ軸では「関連」")
            continue
        if a.get("shown_sha") and p.get("cover") and sha256_file(os.path.join(case_dir, p["cover"])) != a["shown_sha"]:
            bad.append(f"{where}: 一覧シートで見せた後にカバー画像が変わった。--contact でシートを作り直して見直す")
            continue
        trial_a = {**a, "relevance": rel}
        trial_p = dict(p)
        for f in ("angle", "appeal"):
            if f in new:
                if p.get(f) and p[f] != new[f] and any(x.get("confirmed") for x in p["axes"] if x is not a):
                    bad.append(f"{where}: 同じ投稿に別の{FIELD_JA[f]}（{p[f]}）が既に確定している。どちらかに揃える")
                    ok = False
                # 同じ投稿を別の軸のタイルで同時に判定したとき、後の行が黙って上書きしないようにする
                prev = batch_vals.get((p["video_id"], f))
                if prev and prev != new[f]:
                    bad.append(f"{where}: 同じ投稿の別のタイルで{FIELD_JA[f]}を「{prev}」にしている。どちらかに揃える")
                    ok = False
                batch_vals[(p["video_id"], f)] = new[f]
                trial_p[f] = new[f]
        if not ok:
            continue
        miss = [FIELD_JA[f] for f in required_fields(trial_p, trial_a) if not value_of(trial_p, trial_a, f)]
        if miss:
            bad.append(f"{where}: 未選択（{'・'.join(miss)}）。推定値は引き継がない。画像を見て選ぶ")
            continue
        staged.append((p, a, new))
    if bad:
        # 1件でも問題があれば書き込まない（半端に反映すると、どこまで直したか分からなくなる）
        print("[停止] 次の行を直してから再実行してください。labels.json は変更していません:")
        for b in bad:
            print("  - " + b)
        return 1
    now = dt.datetime.now().isoformat(timespec="seconds")
    for p, a, new in staged:
        a["relevance"] = new["relevance"]
        for f in ("angle", "appeal"):
            if f in new:
                p[f] = new[f]
        a["confirmed"] = True
        a["labeled_at"] = now
        a["cover_sha"] = a.get("shown_sha")   # 判定に使った（シートで見せた）画像
        a["code_hash"] = None      # 1つのコードで2回確定させない
        p["confirmed"] = all(x.get("confirmed") for x in p["axes"])
    save(case_dir, doc)
    print(f"反映: {len(staged)}タイルを確定")
    return cmd_check(case_dir, cfg, vocab, args)


def cmd_check(case_dir, cfg, vocab, args):
    lp = os.path.join(case_dir, "labels.json")
    if not os.path.exists(lp):
        raise SystemExit("[致命的] labels.json がありません。先に --init を実行してください")
    doc = load_json(lp)
    errors, warnings, lines = validate(case_dir, cfg, vocab, doc)
    posts = doc["posts"]
    rel = [p for p in posts if any(a.get("confirmed") and a.get("relevance") == "relevant" for a in p["axes"])]
    print(f"投稿 {len(posts)}本 / 関連と確定 {len(rel)}本（うちカバーあり {sum(1 for p in rel if p.get('cover'))}本）")
    for ln in lines:
        print(ln)
    for w in warnings:
        print("  ! " + w)
    if errors:
        print("[停止] 次を直してください:")
        for e in errors:
            print("  - " + e)
        return 1
    print("OK: 初訪資料を作れます（python3 tools/build_first_visit.py --case .）")
    return 0


def cmd_options(vocab):
    print(f"語彙: {vocab['name']} v{vocab.get('version', '?')}（{vocab.get('title', '')}）")
    print("\n■ 迷ったときの決まり")
    for g in vocab.get("guide") or []:
        print(f"  ・{g}")
    print("\n■ relevance（関連性・軸ごと）")
    for e in vocab["relevance"]:
        print(f"  {e['id']:<13} {e['label']}　{e['hint']}")
    for f, title in (("angle", vocab.get("angles_title")), ("appeal", vocab.get("appeals_title"))):
        print(f"\n■ {f}（{title}）" + ("　一覧の上ほど優先" if f == "angle" else ""))
        for e in vocab[VOCAB_KEY[f]]:
            print(f"  {e['id']:<13} {e['label']}（{e['short']}）　{e.get('phrase', '')}")
    print("\n■ 必須欄: 関連以外→関連性だけ／カテゴリ軸で関連→＋切り口／ブランド軸で関連・PR投稿→＋切り口＋訴求"
          "\n  推定値は引き継がない。空欄の行は拒否される。「他社の商品」はブランド軸だけ。"
          "\n■ patch: tile,code,relevance,angle,appeal（tile と code は一覧シートの画像のタイル左上）")
    return 0


def save(case_dir, doc):
    with open(os.path.join(case_dir, "labels.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)



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
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--init", action="store_true")
    g.add_argument("--options", action="store_true")
    g.add_argument("--contact", action="store_true")
    g.add_argument("--apply", nargs="+", metavar="PATCH")
    g.add_argument("--check", action="store_true")
    g.add_argument("--lint-vocab", action="store_true")
    ap.add_argument("--axis", help="--contact を1軸だけ作る（軸コード K1/C1/S か軸名）")
    ap.add_argument("--reset", action="store_true", help="--init で確定済みラベルも捨てて作り直す")
    args = ap.parse_args()
    case_dir = os.path.abspath(os.path.expanduser(args.case))
    cfg = load_case(case_dir)
    vocab = load_vocab(cfg, case_dir, required=True)
    try:
        if args.lint_vocab:
            errs = lint_vocab(vocab)
            print("語彙OK" if not errs else "\n".join(errs))
            return 1 if errs else 0
        if args.options:
            return cmd_options(vocab)
        if args.init:
            return cmd_init(case_dir, cfg, vocab, args)
        if args.contact:
            return cmd_contact(case_dir, cfg, vocab, args)
        if args.apply:
            return cmd_apply(case_dir, cfg, vocab, args)
        return cmd_check(case_dir, cfg, vocab, args)
    except BrokenPipeError:          # | head で切られても traceback を出さない
        return 0


if __name__ == "__main__":
    sys.exit(main())
