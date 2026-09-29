"""fvlib.py — 初訪（first visit）ツール群の共通部品

fetch_covers.py / label_posts.py / build_first_visit.py が同じ定義を使うために1か所に置く。
PR 判定や文字数の数え方がツールごとに違うと、同じ投稿がラベル付けでは PR、
集計では非PR になり、資料の数字と前日レビューのシートが食い違う。

既存モード（build_input_md.py）の PR 定義はこれより狭い（isAd と #PR 系タグ4種）。
初訪は単独の資料なので拡張定義を使い、付録に内訳（isAd／タグ／本文表記）を出す。
"""
from __future__ import annotations

import hashlib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────── 文字数（src/helpers/text.js の widthUnits と同じ数え方）

def width_units(s) -> float:
    """全角=1 / ASCII=0.55。レンダラの fit() と同じ見積りにそろえる"""
    return sum(0.55 if ord(c) < 128 else 1.0 for c in str(s))


# ─────────────────────────────── 表記

def views_label(n) -> str:
    """再生数を紙面の短い表記に。1万未満「8,812」、1億未満「12.3万」（10万以上は整数）、1億以上「1.2億」"""
    if n is None:
        return "—"
    n = float(n)
    if n >= 100_000_000:
        return f"{n / 100_000_000:.1f}億".replace(".0億", "億")
    if n >= 100_000:
        return f"{round(n / 10_000):.0f}万"
    if n >= 10_000:
        return f"{n / 10_000:.1f}万".replace(".0万", "万")
    return f"{int(n):,}"


BAD_TOKENS = re.compile(r"(None|null|undefined|NaN|Infinity|\[DATA NOT PROVIDED\])")


def assert_clean(label: str, s: str) -> None:
    """紙面に出る文字列に未解決の値が混ざっていないか。混ざっていたら止める"""
    if s and BAD_TOKENS.search(str(s)):
        raise SystemExit(f"[致命的] 紙面の文言に未解決の値が入っています（{label}）: {s}")


# ─────────────────────────────── PR 判定（拡張定義）

PR_TAGS = {"pr", "ｐｒ", "pr案件", "タイアップ", "広告", "プロモーション", "提供", "ad", "sponsored"}
# 本文の先頭・末尾の【PR】[PR]（PR）PR: 表記。タグを付けずに本文で表記する投稿が多い
PR_BODY = re.compile(r"(^|\s)[【\[（(]\s*(PR|ＰＲ|プロモーション|広告)\s*[】\]）)]|(^|\s)(PR|ＰＲ)\s*[:：]", re.I)


def norm_tag(t: str) -> str:
    return str(t).strip().lstrip("#＃").strip().lower()


def pr_basis(v: dict) -> list[str]:
    """PR と判定した根拠（isAd / tag / body）。空なら非PR"""
    out = []
    if v.get("isAd") is True:
        out.append("isAd")
    tags = {norm_tag(t) for t in (v.get("hashtags") or [])}
    desc = v.get("desc") or ""
    # hashtags 欄が空でも本文に #PR が書かれていることがある
    tags |= {norm_tag(t) for t in re.findall(r"[#＃]([^\s#＃]+)", desc)}
    if tags & PR_TAGS:
        out.append("tag")
    if PR_BODY.search(desc):
        out.append("body")
    return out


# ─────────────────────────────── 言語

def is_domestic_lang(lang) -> bool:
    """textLanguage が ja・空・un（判定不能）なら国内扱い。絵文字やタグだけの本文は空や un になる"""
    return lang in (None, "", "ja", "un")


# ─────────────────────────────── 取得JSON

class AxisError(SystemExit):
    pass


def load_axis(case_dir: str, rel: str, allow_empty: bool = False) -> tuple[list[dict], dict]:
    """取得JSONの videos と meta を返す。

    取得失敗（ok=false）は 0件として扱わず止める。ただし allow_empty=True のときだけ、
    search.mjs が「本当に0件」と判定した TIKTOK_TRULY_EMPTY を 0本として受ける
    （BOT_WALL / CDN_DENIED などは従来どおり止める）。
    """
    p = os.path.join(case_dir, rel)
    if not os.path.exists(p):
        raise AxisError(f"[致命的] 取得JSONがありません: {rel}（case.json の file を確認）")
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    meta = d if isinstance(d, dict) else {}
    if meta.get("ok") is False:
        err = meta.get("error")
        code = meta.get("errorCode") or (err.get("code") if isinstance(err, dict) else None)
        if allow_empty and code == "TIKTOK_TRULY_EMPTY":
            return [], meta
        raise AxisError(f"[致命的] 取得に失敗した軸です（ok=false）: {rel} error={meta.get('error')} code={code}")
    vs = meta.get("videos") if meta else d
    return (vs or []), meta


def order_is_display(meta: dict) -> tuple[bool, str]:
    """表示順として使ってよい取得か。--sessions>1 の並べ替え結果や CAPTCHA 下の取得は使わない"""
    ob = meta.get("order_basis")
    if ob and ob != "search_display_order":
        return False, f"order_basis={ob}（表示順ではない。--sessions 1 で取り直してください）"
    diag = meta.get("diag") or {}
    if diag.get("captchaDetected"):
        return False, "CAPTCHA 検出下の取得（信用できない。時間か回線を変えて取り直してください）"
    return True, ""


def sha256_file(p: str) -> str | None:
    if not os.path.exists(p):
        return None
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def load_case(case_dir: str) -> dict:
    p = os.path.join(case_dir, "case.json")
    if not os.path.exists(p):
        raise SystemExit(f"[致命的] case.json がありません: {p}")
    return load_json(p)


RESERVED = ("other", "unknown", "none")


def _read_limits() -> dict:
    p = os.path.join(HERE, "vocab", "_limits.json")
    d = load_json(p) if os.path.exists(p) else {}
    return {k: v for k, v in d.items() if not k.startswith("_")}


LIMITS = _read_limits() or {"headline": 30, "sub": 40, "label": 12, "short": 6, "phrase": 20,
                            "evidence": 26, "item": 30, "brand_short": 6, "plan": 24, "body_chars": 160}


def load_vocab(cfg: dict, case_dir: str, required: bool = False) -> dict:
    """case.json の vocab（プリセット名 or JSON パス）＋共通の選択肢（_common.json）。
    vocab_extra で案件だけの語を各次元2つまで足せる（id は x_ で始める）"""
    if required and not cfg.get("vocab"):
        raise SystemExit("[致命的] 業種を選んでください: case.json の \"vocab\" に food / beauty / general のどれかを書く")
    name = str(cfg.get("vocab") or "general")
    cand = [os.path.join(HERE, "vocab", f"{name}.json"), os.path.join(case_dir, name), name]
    path = next((c for c in cand if os.path.isfile(c)), None)
    if not path:
        presets = sorted(x[:-5] for x in os.listdir(os.path.join(HERE, "vocab"))
                         if x.endswith(".json") and not x.startswith("_"))
        raise SystemExit(f"[致命的] 語彙 '{name}' が見つかりません。使えるプリセット: {' / '.join(presets)}"
                         "（case.json の \"vocab\" に書く。独自語彙は JSON のパスでも可）")
    v = load_json(path)
    common = load_json(os.path.join(HERE, "vocab", "_common.json"))
    v["relevance"] = common["relevance"]
    v["posters"] = common["posters"]
    extra = cfg.get("vocab_extra") or {}
    for k in ("angles", "appeals"):
        ex = extra.get(k) or []
        if len(ex) > 2:
            raise SystemExit(f"[致命的] vocab_extra.{k} は2つまで（語彙を増やすほど担当者で判断がぶれる）")
        for e in ex:
            if not str(e.get("id", "")).startswith("x_") or not e.get("label") or not e.get("short"):
                raise SystemExit(f"[致命的] vocab_extra.{k} には x_ で始まる id・label・short が必要です: {e}")
            if all(x["id"] != e["id"] for x in v[k]):
                tail = [x for x in v[k] if x["id"] in RESERVED]
                v[k] = [x for x in v[k] if x["id"] not in RESERVED] + [
                    {"id": e["id"], "label": e["label"], "short": e["short"],
                     "phrase": e.get("phrase", ""), "hint": e.get("hint", "")}] + tail
    errs = lint_vocab(v)
    if errs:
        raise SystemExit("[致命的] 語彙に問題があります:\n  " + "\n  ".join(errs))
    v["_path"] = path
    v["_sha"] = sha256_file(path)
    return v


def lint_vocab(v: dict) -> list[str]:
    """語彙の検査。長さ・次元をまたぐ重複・正規表現の粗さ（1文字の候補は誤爆する: 楽天→楽、味噌→味）"""
    errs = []
    seen_ids, seen_labels = {}, {}
    for k in ("angles", "appeals"):
        for e in v.get(k) or []:
            for f, lim in (("label", LIMITS["label"]), ("short", LIMITS["short"]), ("phrase", LIMITS["phrase"])):
                val = str(e.get(f, "")).replace("{product}", "")
                if width_units(val) > lim:
                    errs.append(f"{k}.{e.get('id')} の {f} が長すぎる（{width_units(val):.1f} > {lim}）: {e.get(f)}")
            if e["id"] in RESERVED:
                continue
            if e["id"] in seen_ids and seen_ids[e["id"]] != k:
                errs.append(f"id「{e['id']}」が {seen_ids[e['id']]} と {k} の両方にある（同じ事柄を2回数える）")
            if e["label"] in seen_labels and seen_labels[e["label"]] != k:
                errs.append(f"表示名「{e['label']}」が {seen_labels[e['label']]} と {k} の両方にある")
            seen_ids[e["id"]] = k
            seen_labels[e["label"]] = k
            h = e.get("hint") or ""
            if not h:
                continue
            try:
                re.compile(h)
            except re.error as ex:
                errs.append(f"{k}.{e['id']} の hint が正規表現として壊れている: {ex}")
                continue
            for alt in h.split("|"):
                # \\b や ^$() は長さに数えず、\\d+ のような文字クラスは1文字と数える（「\\d+円」は2文字相当）
                core = re.sub(r"\\[bB]|[\^$()]", "", alt)
                core = re.sub(r"\\[dswDSW][+*?]?|\\.", "X", core)
                core = re.sub(r"[+*?]", "", core)
                if len(core) < 2:
                    errs.append(f"{k}.{e['id']} の hint「{alt}」が短すぎる（1文字は誤爆する）")
    return errs


def official_ids(brand: dict) -> set[str]:
    return {str(u).lstrip("@").lower() for u in (brand.get("official") or [])}


def short_of(brand: dict) -> str:
    return brand.get("short") or brand.get("name") or ""
