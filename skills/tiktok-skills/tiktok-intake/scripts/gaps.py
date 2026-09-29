#!/usr/bin/env python3
"""足りない入力を「次の一手」に翻訳する（受付モジュール）。

`build_deck.py` は不足入力を検出できるが、それを**何をすれば埋まるか**に
変換していなかった。「不足しています」だけ言われると営業は止まる。
本スクリプトは同じ判定結果を、次の3つに翻訳する。

    ① 足りないもの → 具体的なアクション（何を聞けば/実行すれば埋まるか）
    ② いま出せる章 → 実数つきで提示（足りなくても資料は成立する）
    ③ データから見つけたこと → 提案の切り口になる発見

**判定ロジックを二重に持たない。** build_deck.py を呼んでその結果を読む。
文言は suggestions.json 側にあるので、コードを触らず変えられる。

    python3 gaps.py --run-dir <run-dir> --status 初訪
    python3 gaps.py --run-dir <run-dir> --status 初訪 --json
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# 03-deck の build_deck.py を探す（インストール先とリポジトリ内の両方に対応）
DECK_CANDIDATES = [
    Path(os.environ.get("TIKTOK_DECK_SCRIPTS", "")) / "build_deck.py",
    # 旧レンダラを legacy/ へ移したとき、⓪が使い続けている build_deck.py まで
    # 一緒に持って行ってしまい、このコマンドが全OSで実行不能になっていた。
    # いまは 03-deck/tools/ にある（標準ライブラリだけで動く現行の依存）
    HERE.parent.parent / "03-deck" / "tools" / "build_deck.py",
    Path.home() / ".claude/skills/tiktok-deck/tools/build_deck.py",
]
PY_CANDIDATES = [
    HERE.parent / ".venv/bin/python",
    Path.home() / ".claude/skills/.tiktok-shared-venv/bin/python",
    Path.home() / ".claude/skills/tiktok-deck/.venv/bin/python",
    Path(sys.executable),
]


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


def load_recs(run_dir: Path):
    p = run_dir / "normalized" / "videos.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
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


def compute_findings(recs, spec, rules):
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
        except ValueError:
            pass

    pr = [r for r in recs if r.get("pr_status_prelim") == "pr"]
    no = [r for r in recs if r.get("pr_status_prelim") != "pr"]
    ad = [r for r in recs if r.get("is_ad_platform_flag")]
    both = sum(1 for r in recs if r.get("pr_status_prelim") == "pr" and r.get("is_ad_platform_flag"))

    def sr(g):
        return _median([r["saves"] / r["views"] * 100 for r in g if (r.get("views") or 0) > 0])

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
        "axes_count": len(spec.get("dataset", {}).get("roles") or []),
    }
    ctx["views_ratio"] = round(ctx["pr_views"] / max(ctx["no_pr_views"], 1), 2)
    ctx["save_ratio"] = round(ctx["pr_save_rate"] / max(ctx["no_pr_save_rate"], 0.01), 2)

    found = []
    for rule in rules:
        try:
            if eval(rule["when"], {"__builtins__": {}}, ctx):  # noqa: S307 - ルールは同梱ファイル由来
                found.append({"id": rule["id"], "text": rule["text"].format(**ctx)})
        except Exception:
            continue
    return found


def main():
    ap = argparse.ArgumentParser(description="足りない入力を次の一手に翻訳する")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--status", help="営業ステータス（例: 初訪）")
    ap.add_argument("--modules", help="モジュールID（例: 1-1,3-2）")
    ap.add_argument("--json", action="store_true", help="JSON で出す")
    args = ap.parse_args()
    if not args.status and not args.modules:
        fail("--status か --modules を指定してください")

    run_dir = Path(args.run_dir).expanduser().resolve()
    if not run_dir.exists():
        fail(f"run-dir がありません: {run_dir}")

    sug = load_suggestions()
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

    findings = compute_findings(recs, spec, sug.get("findings_rules", []))

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
