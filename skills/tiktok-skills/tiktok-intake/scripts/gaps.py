#!/usr/bin/env python3
"""足りない入力を「次の一手」に翻訳する（受付モジュール）。

`build_deck.py` は不足入力を検出できるが、それを**何をすれば埋まるか**に
変換していなかった。「不足しています」だけ言われると営業は止まる。
本スクリプトは同じ判定結果を、次の3つに翻訳する。

    ① 足りないもの → 具体的なアクション（何を聞けば/実行すれば埋まるか）
    ② いま出せる章 → 実数つきで提示（足りなくても資料は成立する）
    ③ データから見つけたこと → 提案の切り口になる発見

**判定ロジックを二重に持たない。** 資料側のツールを呼んでその結果を読む。
  - 初訪        : tiktok-deck/tools/build_first_visit.py --case <案件> --dry-run --json
                  （ラベル前などで呼べないときは、初訪の必須入力のチェックリストに落とす）
  - それ以外の型: tiktok-deck/tools/build_deck.py --run-dir <run-dir> --status <型>
文言は suggestions.json 側にあるので、コードを触らず変えられる。

    python3 gaps.py --status 初訪 --case <案件ディレクトリ>
    python3 gaps.py --status 初訪 --run-dir <run-dir>          # intake.json から入力の揃い具合だけ見る
    python3 gaps.py --run-dir <run-dir> --status 具体提案
    python3 gaps.py --run-dir <run-dir> --status 具体提案 --json
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# tiktok-deck の場所（このスキルの隣 → インストール先）。旧配布の番号付きフォルダ名も見る
DECK_DIRS = [
    Path(os.environ["TIKTOK_DECK_DIR"]) if os.environ.get("TIKTOK_DECK_DIR") else None,
    HERE.parent.parent / "tiktok-deck",
    HERE.parent.parent / "03-deck",
    Path.home() / ".claude/skills/tiktok-deck",
]
# 旧レンダラを legacy/ へ移したとき、受付が使い続けている build_deck.py まで
# 一緒に持って行ってしまい、このコマンドが全OSで実行不能になっていた。
# いまは tiktok-deck/tools/ にある（標準ライブラリだけで動く現行の依存）
DECK_CANDIDATES = [
    Path(os.environ["TIKTOK_DECK_SCRIPTS"]) / "build_deck.py" if os.environ.get("TIKTOK_DECK_SCRIPTS") else None,
] + [d / "tools" / "build_deck.py" for d in DECK_DIRS if d]
PY_CANDIDATES = [
    HERE.parent / ".venv/bin/python",
    Path.home() / ".claude/skills/.venv/bin/python",            # install.sh が作る共有 venv
    Path.home() / ".claude/skills/.tiktok-shared-venv/bin/python",
    Path.home() / ".claude/skills/tiktok-deck/.venv/bin/python",
    Path(sys.executable),
]
PRESETS = ("food", "beauty", "general")


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def first_existing(paths):
    for p in paths:
        try:
            if p and Path(p).exists():
                return Path(p)
        except (OSError, TypeError):
            continue
    return None


def deck_dir():
    for d in DECK_DIRS:
        if d and (d / "tools").is_dir():
            return d
    return None


def load_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_suggestions():
    p = HERE / "suggestions.json"
    if not p.exists():
        fail(f"suggestions.json がありません: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def build_spec(run_dir: Path, status, modules):
    """build_deck.py を呼んで spec を得る。判定は向こうに任せる。"""
    deck = first_existing(DECK_CANDIDATES)
    if not deck:
        fail("build_deck.py が見つかりません。TIKTOK_DECK_SCRIPTS で場所を指定してください")
    py = first_existing(PY_CANDIDATES) or Path(sys.executable)
    out = run_dir / "_intake_spec.json"
    cmd = [str(py), str(deck), "--run-dir", str(run_dir), "--out", str(out)]
    if status:
        cmd += ["--status", status]
    if modules:
        cmd += ["--modules", modules]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if not out.exists():
        fail(f"build_deck.py が spec を出せませんでした\n{proc.stderr[-500:]}")
    return json.loads(out.read_text(encoding="utf-8"))


def load_recs(run_dir):
    if not run_dir:
        return []
    p = run_dir / "normalized" / "videos.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return 0
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def compute_findings(recs, axes_count, rules, status=None):
    """データから「提案の切り口になる発見」を拾う。ルールは suggestions.json 側。"""
    total = len(recs)
    if not total:
        return []
    from datetime import datetime, timezone, timedelta
    JST = timezone(timedelta(hours=9))
    now = datetime.now(JST)

    photo = sum(1 for r in recs if r.get("media_type") == "photo")
    small = sum(1 for r in recs if 0 < (r.get("follower_count") or 0) < 10000)
    recent = 0
    for r in recs:
        pa = r.get("posted_at")
        if not pa:
            continue
        try:
            if (now - datetime.fromisoformat(pa)).days <= 7:
                recent += 1
        except (ValueError, TypeError):
            pass

    pr = [r for r in recs if r.get("pr_status_prelim") == "pr"]
    no = [r for r in recs if r.get("pr_status_prelim") != "pr"]
    ad = [r for r in recs if r.get("is_ad_platform_flag")]
    both = sum(1 for r in recs if r.get("pr_status_prelim") == "pr" and r.get("is_ad_platform_flag"))

    def sr(g):
        return _median([r["saves"] / r["views"] * 100 for r in g
                        if (r.get("views") or 0) > 0 and r.get("saves") is not None])

    verified = sum(1 for r in recs if r.get("creator_verified"))
    ctx = {
        "verified": verified, "verified_ratio": verified / total,
        "verified_pct": round(verified / total * 100, 1),
        "total": total, "photo": photo, "photo_ratio": photo / total,
        "photo_pct": round(photo / total * 100, 1),
        "small": small, "small_follower_ratio": small / total,
        "small_pct": round(small / total * 100, 1),
        "recent7_ratio": recent / total, "recent_pct": round(recent / total * 100, 1),
        "pr_save_rate": sr(pr), "no_pr_save_rate": sr(no),
        "pr_views": _median([r.get("views") for r in pr]),
        "no_pr_views": _median([r.get("views") for r in no]),
        "ad_only": len(ad) - both,
        "axes_count": axes_count,
    }
    ctx["views_ratio"] = round(ctx["pr_views"] / max(ctx["no_pr_views"], 1), 2)
    ctx["save_ratio"] = round(ctx["pr_save_rate"] / max(ctx["no_pr_save_rate"], 0.01), 2)

    found = []
    for rule in rules:
        if status and status in (rule.get("skip_status") or []):
            continue
        try:
            if eval(rule["when"], {"__builtins__": {}}, ctx):  # noqa: S307 - ルールは同梱ファイル由来
                found.append({"id": rule["id"], "text": rule["text"].format(**ctx)})
        except Exception:
            continue
    return found


# ─────────────────────────────── 初訪

def _dry_run(case_dir: Path, deck: Path):
    """build_first_visit.py --dry-run --json を呼ぶ。読めなければ (None, 理由)"""
    tool = deck / "tools" / "build_first_visit.py" if deck else None
    if not tool or not tool.exists():
        return None, "tiktok-deck/tools/build_first_visit.py が見つかりません（TIKTOK_DECK_DIR で場所を指定できます）"
    py = first_existing(PY_CANDIDATES) or Path(sys.executable)
    cmd = [str(py), str(tool), "--case", str(case_dir), "--dry-run", "--json"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    except (subprocess.SubprocessError, OSError) as e:
        return None, f"build_first_visit.py を実行できませんでした: {e}"
    out = (proc.stdout or "").strip()
    d = None
    try:
        d = json.loads(out)
    except json.JSONDecodeError:
        a, b = out.find("{"), out.rfind("}")
        if a >= 0 and b > a:
            try:
                d = json.loads(out[a:b + 1])
            except json.JSONDecodeError:
                d = None
    if not isinstance(d, dict) or not isinstance(d.get("pages"), list):
        tail = (proc.stderr or out or "").strip().splitlines()[-3:]
        return None, (f"--dry-run の結果を読めませんでした（終了コード {proc.returncode}）"
                      + (": " + " / ".join(tail) if tail else ""))
    return d, None


def _files_state(case_dir, rel):
    """case.json の file が揃っているか → (ok, 本数 or 理由)"""
    if not rel:
        return False, "file 未設定"
    p = (case_dir / rel) if case_dir else None
    if not p or not p.exists():
        return False, "未取得"
    d = load_json(p)
    if isinstance(d, dict) and d.get("ok") is False:
        return False, f"取得失敗（{d.get('errorCode') or d.get('error')}）"
    vs = d.get("videos") if isinstance(d, dict) else d
    return True, len(vs or [])


def fv_checklist(case_dir, cfg, intake, fvs):
    """初訪の必須入力と工程のチェックリスト。state: ok / ask / ai / todo / opt"""
    C = fvs.get("checklist", {})
    items = []

    def add(key, state, detail, **extra):
        e = {"id": key, "state": state, "detail": detail, **(C.get(key) or {})}
        e.update(extra)
        items.append(e)

    if cfg is None:
        # case.json がまだ無い: 依頼票（intake.json）から入力の揃い具合だけ見る
        fv = (intake or {}).get("first_visit") or {}
        src = "依頼票" if intake else "未受領"
        v = fv.get("vocab")
        add("vocab", "ok" if v else "ask", v or f"未選択（{src}）")
        add("category", "ok" if fv.get("category") else "ai", fv.get("category") or f"未定（{src}）")
        comps = fv.get("competitors") or []
        add("competitors", "ok" if comps else "ask",
            "、".join(f"{c['name']}（{'確認済み' if c.get('confirmed_by_client') else '想定'}）" for c in comps)
            or f"未定（{src}）")
        ost = (fv.get("official") or {}).get("status", "unknown")
        add("official", "ok" if ost in ("confirmed", "none") else "ai",
            {"confirmed": "@" + ", @".join((fv.get("official") or {}).get("ids") or []),
             "none": "無し（確定）"}.get(ost, "不明"))
        add("focus_products", "ok" if fv.get("focus_products") else "opt",
            "、".join(fv.get("focus_products") or []) or "未指定")
        add("visit_date", "ok" if fv.get("visit_date") else "opt", fv.get("visit_date") or "未指定")
        add("case_json", "todo", "案件ディレクトリの case.json がまだありません")
        return items

    kws = cfg.get("keywords") or []
    primary = next((k for k in kws if k.get("primary")), kws[0] if kws else None)
    brands = cfg.get("brands") or []
    own = next((b for b in brands if b.get("own")), None)
    comps = [b for b in brands if not b.get("own")]

    v = cfg.get("vocab")
    v_ok = bool(v) and (v in PRESETS or (case_dir and (case_dir / str(v)).is_file()) or Path(str(v)).is_file())
    add("vocab", "ok" if v_ok else "ask", v or "未設定（case.json の vocab）")
    cat = cfg.get("category") or (primary or {}).get("name")
    add("category", "ok" if cat else "ai", cat or "未設定")
    if primary:
        ok, n = _files_state(case_dir, primary.get("file"))
        add("category_search", "ok" if ok else "todo",
            f"「{primary.get('query') or primary.get('name')}」" + (f" {n}本" if ok else f" … {n}"),
            query=primary.get("query") or primary.get("name"), file=primary.get("file"))
    else:
        add("category_search", "todo", "keywords が空です")
    if comps:
        parts, missing = [], []
        for b in comps[:4]:
            ok, n = _files_state(case_dir, b.get("file"))
            conf = "確認済み" if b.get("confirmed_by_client") else "想定"
            parts.append(f"{b.get('short') or b['name']}（{conf}・{f'{n}本' if ok else n}）")
            if not ok:
                missing.append({"query": b.get("query"), "file": b.get("file"), "name": b["name"]})
        add("competitors", "ok" if not missing else "todo", "、".join(parts),
            to_acquire=missing, few=len(comps) < 2)
    else:
        add("competitors", "ask", "case.json に競合がありません")
    ost = (own or {}).get("official_status") or "unknown"
    add("official", "ok" if ost in ("confirmed", "none") else "ai",
        {"confirmed": "@" + ", @".join((own or {}).get("official") or []) or "confirmed（ID未記入）",
         "none": "無し（確定）"}.get(ost, "不明（0本とは書かない）"))
    if own and own.get("file"):
        ok, n = _files_state(case_dir, own.get("file"))
        add("own_search", "ok" if ok else "todo", f"「{own.get('query') or own['name']}」" + (f" {n}本" if ok else f" … {n}"),
            query=own.get("query"), file=own.get("file"))
    else:
        add("own_search", "opt", "しない（P5 は対象ブランドについて主張しない版）")
    fp = cfg.get("focus_products") or []
    add("focus_products", "ok" if fp else "opt", "、".join(fp) or "未指定")
    add("visit_date", "ok" if cfg.get("visit_date") else "opt", cfg.get("visit_date") or "未指定")
    add("acquired_on", "ok" if cfg.get("acquired_on") else "todo", cfg.get("acquired_on") or "未設定")
    covers = list((case_dir / "assets" / "covers").glob("*.jpg")) if case_dir else []
    covers = [c for c in covers if not c.name.startswith("_")]
    add("covers", "ok" if covers else "todo", f"{len(covers)}枚" if covers else "まだ")
    labels = load_json(case_dir / "labels.json") if case_dir and (case_dir / "labels.json").exists() else None
    if labels is None:
        add("labels", "todo", "labels.json がまだ")
    else:
        posts = labels.get("posts") or []
        conf = sum(1 for p in posts if p.get("confirmed"))
        add("labels", "ok", f"{len(posts)}本")
        add("labels_confirmed", "ok" if posts and conf == len(posts) else "todo", f"{conf}/{len(posts)}本 確定")
    return items


def fv_next_steps(case_dir, items, deck, dry):
    """最初に詰まっている工程から、打つコマンドを並べる"""
    D = str(deck) if deck else "../tiktok-deck"
    C = str(case_dir) if case_dir else "<案件ディレクトリ>"
    st = {i["id"]: i for i in items}
    steps = []
    if "case_json" in st:
        steps.append(f"python3 scripts/intake_form.py --file <依頼票> --case-json {C}   # case.json の下書き")
    asks = [i for i in items if i["state"] == "ask"]
    if asks:
        steps.append("ターン2の1回の確認で聞く: " + " ／ ".join(i.get("label", i["id"]) for i in asks)
                     + "（返事を待たずにカテゴリの取得から始める）")
    acq = []
    for key in ("category_search", "own_search"):
        i = st.get(key)
        if i and i["state"] == "todo" and i.get("file"):
            acq.append((i.get("query"), i.get("file")))
    for m in (st.get("competitors") or {}).get("to_acquire") or []:
        if m.get("file"):
            acq.append((m.get("query"), m.get("file")))
    for q, f in acq:
        steps.append(f'cd <tiktok-acquire>/scripts && node search.mjs --query "{q}" --max 50 --out {C}/{f}')
    if acq or (st.get("acquired_on") or {}).get("state") == "todo":
        steps.append("取得した日を case.json の acquired_on（YYYY-MM-DD）に入れる")
    if "case_json" in st:
        return steps
    if (st.get("covers") or {}).get("state") == "todo":
        steps.append(f"python3 {D}/tools/fetch_covers.py --case {C}")
    if (st.get("labels") or {}).get("state") == "todo":
        steps.append(f"python3 {D}/tools/label_posts.py --case {C} --init")
    if (st.get("labels") or {}).get("state") == "todo" or (st.get("labels_confirmed") or {}).get("state") == "todo":
        steps.append(f"python3 {D}/tools/label_posts.py --case {C} --options   # 選べる値（語彙の中だけ）")
        steps.append(f"python3 {D}/tools/label_posts.py --case {C} --contact   # 一覧シートを作り、画像を実際に見る")
        steps.append(f"python3 {D}/tools/label_posts.py --case {C} --apply patch.csv && "
                     f"python3 {D}/tools/label_posts.py --case {C} --check")
        return steps
    if dry and dry.get("blocking"):
        steps.append("止まっている理由を解消する（上の ⛔）→ もう一度 gaps.py")
        return steps
    steps += [
        f"python3 {D}/tools/build_first_visit.py --case {C}",
        f"cd {D} && node src/generate.js --case {C} --mode 初訪",
        f"python3 {D}/tools/preflight.py {C}/output/TikTok_Competitive_Research_初訪.pptx",
        f"python3 {D}/tools/verify_assets.py --case {C}",
        f"{C}/review/初訪_前日チェック.md を訪問の前日に見る",
    ]
    return steps


def first_visit_report(case_dir, run_dir, sug):
    fvs = sug.get("first_visit") or {}
    cfg = load_json(case_dir / "case.json") if case_dir and (case_dir / "case.json").exists() else None
    intake = None
    for d in (run_dir, case_dir):
        if d and (d / "intake.json").exists():
            intake = load_json(d / "intake.json")
            break
    items = fv_checklist(case_dir, cfg, intake, fvs)
    deck = deck_dir()
    dry, dry_err = None, None
    if cfg is not None and (case_dir / "labels.json").exists():
        dry, dry_err = _dry_run(case_dir, deck)
    elif cfg is None:
        dry_err = "case.json がまだ無いので章は判定できません"
    else:
        dry_err = "labels.json がまだ無いので章は判定できません（ラベルを付けてから build_first_visit.py --dry-run で判定）"
    names = fvs.get("pages") or {}
    pages = []
    for p in (dry or {}).get("pages") or []:
        pages.append({"id": p.get("id"), "name": names.get(p.get("id"), p.get("id")),
                      "status": p.get("status"), "reason": p.get("reason") or ""})
    axes = 0
    if cfg:
        axes = len(cfg.get("keywords") or []) + len(cfg.get("brands") or [])
    findings = compute_findings(load_recs(run_dir), axes, sug.get("findings_rules", []), status="初訪")
    return {
        "status": "初訪",
        "case_dir": str(case_dir) if case_dir else None,
        "run_dir": str(run_dir) if run_dir else None,
        "mode": "dry_run" if dry else "checklist",
        "dry_run_error": dry_err,
        "pages": pages,
        "blocking": (dry or {}).get("blocking") or [],
        "warnings": (dry or {}).get("warnings") or [],
        "checklist": items,
        "next_steps": fv_next_steps(case_dir, items, deck, dry),
        "findings": findings,
    }


def print_first_visit(r, fvs):
    mark = fvs.get("state_mark") or {}
    pmark = fvs.get("page_mark") or {}
    if r["mode"] == "dry_run" and not r["pages"]:
        print(f"■ 「初訪」の資料（本編5〜8枚＋付録2枚）：まだ組めません（⛔ 止まっている理由 {len(r['blocking'])}件）\n")
    elif r["mode"] == "dry_run":
        ready = sum(1 for p in r["pages"] if p["status"] == "ready")
        deg = sum(1 for p in r["pages"] if p["status"] == "degraded")
        drop = sum(1 for p in r["pages"] if p["status"] == "dropped")
        print(f"■ 「初訪」の資料（本編5〜8枚＋付録2枚）：{len(r['pages'])}ページ中 {ready}ページはそのまま、"
              f"{deg}ページは縮めて出せます" + (f"（{drop}ページは出さない）" if drop else "")
              + ("。⛔ 止まっている理由あり" if r["blocking"] else "") + "\n")
    else:
        print("■ 「初訪」の資料（本編5〜8枚＋付録2枚）：いま出せる章はまだ判定できません")
        print(f"  {r['dry_run_error']}")
        print("  先に初訪の入力と工程の揃い具合を出します。\n")

    if r["findings"]:
        print("【データを見て気づいた点】")
        for f in r["findings"]:
            print(f"  ・{f['text']}")
        print()

    if r["mode"] == "dry_run":
        print("【いま出せる章】")
        for p in r["pages"]:
            why = f" — {p['reason']}" if p["reason"] and p["status"] != "ready" else ""
            print(f"  {pmark.get(p['status'], '?')} {p['name']}{why}")
        for b in r["blocking"]:
            print(f"  ⛔ {b}")
        for w in r["warnings"]:
            print(f"  ⚠️ {w}")
        print()

    print("【初訪の入力と工程】")
    for i in r["checklist"]:
        print(f"  {mark.get(i['state'], '?')} {i.get('label', i['id'])}: {i['detail']}")
        if i["state"] in ("ask", "ai", "todo"):
            if i.get("why"):
                print(f"       なぜ必要か : {i['why']}")
            if i["state"] == "ask" and i.get("ask"):
                print(f"       営業に聞く  : {i['ask']}")
            if i["state"] == "ai" and i.get("auto"):
                print(f"       こちらで補う: {i['auto']}")
            if i.get("warn"):
                print(f"       ⚠️ {i['warn']}")
        if i["id"] == "competitors" and i.get("few"):
            print("       ⚠️ 1社だけです。2〜4社あると「競合はこう発信している」が比べやすくなります")
    print()
    print("【次の一手】")
    for n, s in enumerate(r["next_steps"], 1):
        print(f"  {n}. {s}")
    print()


def main():
    ap = argparse.ArgumentParser(description="足りない入力を次の一手に翻訳する")
    ap.add_argument("--run-dir", help="計測の作業フォルダ（初訪以外は必須）")
    ap.add_argument("--case", help="案件ディレクトリ（case.json のある場所。初訪で使う）")
    ap.add_argument("--status", help="営業ステータス（例: 初訪）")
    ap.add_argument("--modules", help="モジュールID（例: 1-1,3-2）")
    ap.add_argument("--json", action="store_true", help="JSON で出す")
    args = ap.parse_args()
    if not args.status and not args.modules:
        fail("--status か --modules を指定してください")

    run_dir = Path(args.run_dir).expanduser().resolve() if args.run_dir else None
    if run_dir and not run_dir.exists():
        fail(f"run-dir がありません: {run_dir}")
    case_dir = Path(args.case).expanduser().resolve() if args.case else None
    if case_dir and not case_dir.exists():
        fail(f"案件ディレクトリがありません: {case_dir}")
    sug = load_suggestions()

    statuses = [s.strip() for s in re.split(r"[,、，]", args.status or "") if s.strip()]
    if "初訪" in statuses and not args.modules:
        # 初訪は単独の資料。旧 modules.json の 1-1〜1-6 には対応させない
        rest = [s for s in statuses if s != "初訪"]
        r = first_visit_report(case_dir, run_dir, sug)
        if rest:
            r["note"] = (f"初訪は単独で出します。{'・'.join(rest)} は "
                         f"gaps.py --run-dir <run-dir> --status {','.join(rest)} で別に見てください")
        if args.json:
            print(json.dumps(r, ensure_ascii=False, indent=2))
            return
        if r.get("note"):
            print(f"※ {r['note']}\n")
        print_first_visit(r, sug.get("first_visit") or {})
        return

    if not run_dir:
        fail("--run-dir を指定してください（初訪以外は計測の作業フォルダから判定します）")
    spec = build_spec(run_dir, args.status, args.modules)
    recs = load_recs(run_dir)
    by_input = sug["by_missing_input"]

    # ① 足りないもの → アクション（同じ入力名でまとめる）
    gaps = {}
    for b in spec.get("blocked_detail", []):
        for m in b["missing"]:
            g = gaps.setdefault(m, {"blocks": [], **(by_input.get(m) or {})})
            g["blocks"].append(f"{b['id']} {b['name']}")

    # ② いま出せる章（実数の要約つき）
    ready = []
    for c in spec.get("chapters", []):
        if c["status"] != "ready":
            continue
        head = None
        d = c.get("data") or {}
        for k, v in d.items():
            if k == "note" or k.startswith("_"):
                continue
            if not isinstance(v, (list, dict)):
                head = f"{k} {v}"
                break
            if isinstance(v, list) and v and isinstance(v[0], dict):
                head = f"{len(v)}件"
                break
        ready.append({"id": c["id"], "name": c["name"], "highlight": head})

    axes = len(spec.get("dataset", {}).get("roles") or [])
    findings = compute_findings(recs, axes, sug.get("findings_rules", []), status=args.status)

    result = {
        "run_dir": str(run_dir),
        "keyword": spec.get("keyword"),
        "selection": args.status or args.modules,
        "summary": spec.get("summary"),
        "gaps": gaps,
        "ready_chapters": ready,
        "findings": findings,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # ── 人が読む形（営業へそのまま出せる文面）──
    sm = spec.get("summary", {})
    print(f"■ 「{args.status or args.modules}」の資料：全{sm.get('total')}章のうち "
          f"{sm.get('ready')}章はいま作れます（{sm.get('blocked')}章が入力不足）\n")

    if findings:
        print("【データを見て気づいた点】")
        for f in findings:
            print(f"  ・{f['text']}")
        print()

    if ready:
        print("【いま出せる章】")
        for c in ready:
            hl = f"（{c['highlight']}）" if c["highlight"] else ""
            print(f"  ✅ {c['id']} {c['name']}{hl}")
        print()

    if gaps:
        print("【足りないもの／次の一手】")
        for name, g in gaps.items():
            print(f"  ⛔ {name}")
            print(f"     止まっている章: {', '.join(g['blocks'])}")
            if g.get("why"):
                print(f"     なぜ必要か  : {g['why']}")
            if g.get("ask"):
                print(f"     営業に聞く   : {g['ask']}")
            if g.get("example"):
                print(f"     {g['example']}")
            if g.get("auto"):
                print(f"     こちらで補える: {g['auto']}")
            if g.get("warn"):
                print(f"     ⚠️ {g['warn']}")
            if g.get("unlocks"):
                print(f"     埋まると増える章: {', '.join(g['unlocks'])}")
            print()
    else:
        print("【足りないもの】なし。このまま資料化できます。\n")


if __name__ == "__main__":
    main()
