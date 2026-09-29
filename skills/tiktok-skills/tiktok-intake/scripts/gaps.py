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
    python3 gaps.py --selftest        # suggestions.json に文言の無い不足入力が無いかを確かめる
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
# generate.js の MODES.alias と同じ別名を正式名に寄せる。build_deck.py は別名を知らないので、
# 「--status report」のまま渡すと止まるのに、前回の spec が残っていると別の型の章一覧を出していた（2026-09 監査）
STATUS_NAMES = ("初訪", "具体提案", "構成提案", "レポート", "競合差再提案")
STATUS_ALIAS = {
    "quick": "初訪", "初回": "初訪", "初回訪問": "初訪",
    "deep": "具体提案", "full": "具体提案", "提案": "具体提案",
    "構成": "構成提案",
    "競合差": "競合差再提案", "再提案": "競合差再提案",
    "report": "レポート", "効果測定": "レポート",
}
STATUS_ALIAS.update({str(i): n for i, n in enumerate(STATUS_NAMES, 1)})
# 子プロセス（build_deck.py / build_first_visit.py）の標準入出力を UTF-8 に固定する。
# 日本語 Windows では既定が cp932 で、⛔✅ を含む出力が化けるか UnicodeEncodeError で落ちる
CHILD_ENV = {**os.environ, "PYTHONIOENCODING": "utf-8"}


def utf8_stdio():
    """標準出力・標準エラーを UTF-8 にする（日本語 Windows のパイプで ✅⛔⚠️ が書けずに落ちていた）"""
    for st in (sys.stdout, sys.stderr):
        if hasattr(st, "reconfigure"):
            try:
                st.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def canon_statuses(arg):
    """--status の値 → 正式名のリスト。知らない名前は推測せずに止める"""
    out = []
    for raw in [x.strip() for x in re.split(r"[,、，＋+]", arg or "") if x.strip()]:
        name = raw if raw in STATUS_NAMES else STATUS_ALIAS.get(raw.lower(), STATUS_ALIAS.get(raw))
        if not name:
            fail(f"未知の営業ステータス: {raw}（使えるのは {' / '.join(STATUS_NAMES)}。"
                 "別名: quick=初訪, deep/full/提案=具体提案, 構成=構成提案, 競合差/再提案=競合差再提案, "
                 "report/効果測定=レポート）")
        if name not in out:
            out.append(name)
    return out


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
    # 前回の spec を先に消す。「ファイルがあるか」だけで成功扱いにしていたため、
    # build_deck.py が止まっても前回の（別の型の）章一覧をそのまま出して exit 0 で終わっていた（2026-09 監査）
    try:
        out.unlink()
    except FileNotFoundError:
        pass
    cmd = [str(py), str(deck), "--run-dir", str(run_dir), "--out", str(out)]
    if status:
        cmd += ["--status", status]
    if modules:
        cmd += ["--modules", modules]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          env=CHILD_ENV)
    if proc.returncode != 0 or not out.exists():
        tail = (proc.stderr or proc.stdout or "").strip()[-500:]
        fail(f"build_deck.py が止まりました（終了コード {proc.returncode}）。章の判定は出せません\n{tail}")
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


def is_ad(r):
    """広告として数えるか。build_deck.py の is_ad と同じ定義（#PR 表記 または TikTok の広告フラグ）。

    以前は #PR 表記だけで割っていたため、同じデータで 4-4 は「広告は再生11.0倍」、
    ここは「PR投稿は再生2.0倍」と食い違い、同じ出力の「どちらも広告として数えています」とも矛盾していた（2026-09 監査）。
    """
    if r.get("pr_status_prelim") == "pr":
        return True
    v = r.get("is_ad_platform_flag")
    return v is True or str(v).strip().lower() == "true"


def axis_count(recs):
    """検索軸の数（build_deck の _by_axis と同じくラベル単位）。role の種類数ではない。

    role で数えると、市場KWを2本取った run が「1軸」、自社＋市場KWが「2軸」になり、
    1-1 が出ないのに single_axis の注意も出なかった（2026-09 監査）。
    """
    keys = set()
    for r in recs:
        for a in (r.get("source_appearances") or [{"label": r.get("label"), "source_file": r.get("source_file")}]):
            keys.add(a.get("label") or a.get("source_file") or "(不明)")
    return len(keys)


def reference_time(run_dir):
    """「直近7日」の基準時刻。gaps.py を実行した日ではなく、データを作った日（build_dataset の built_at）。

    実行日を基準にすると、同じ検索面でも日が経つほど「直近7日」が減って判定が変わっていた（2026-09 監査）。
    分からなければ None（鮮度の発見は出さない。推測で基準日を作らない）。
    """
    from datetime import datetime
    cfg = load_json(run_dir / "confirmed_config.json") if run_dir else None
    ts = ((cfg or {}).get("dataset_provenance") or {}).get("built_at")
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return None


def compute_findings(recs, axes_count, rules, status=None, ref=None):
    """データから「提案の切り口になる発見」を拾う。ルールは suggestions.json 側。"""
    total = len(recs)
    if not total:
        return []
    from datetime import datetime, timezone, timedelta
    JST = timezone(timedelta(hours=9))

    photo = sum(1 for r in recs if r.get("media_type") == "photo")
    # フォロワー数が取れなかった投稿は None（古い build_dataset では 0）。分母から外して件数も示す
    known = [r for r in recs if (r.get("follower_count") or 0) > 0]
    small = sum(1 for r in known if r["follower_count"] < 10000)
    recent, dated = 0, 0
    if ref is not None:
        if ref.tzinfo is None:
            ref = ref.replace(tzinfo=JST)
        for r in recs:
            pa = r.get("posted_at")
            if not pa:
                continue
            try:
                t = datetime.fromisoformat(pa)
            except (ValueError, TypeError):
                continue
            if t.tzinfo is None:
                t = t.replace(tzinfo=JST)
            dated += 1
            if (ref - t).days <= 7:
                recent += 1

    # 広告は #PR 表記か広告フラグのどちらか（build_deck の 4-4 と同じ）。名前は既存ルール互換で pr_*
    pr = [r for r in recs if is_ad(r)]
    no = [r for r in recs if not is_ad(r)]
    ad_only = sum(1 for r in recs if r.get("pr_status_prelim") != "pr" and is_ad(r))

    def sr(g):
        return _median([r["saves"] / r["views"] * 100 for r in g
                        if (r.get("views") or 0) > 0 and r.get("saves") is not None])

    verified = sum(1 for r in recs if r.get("creator_verified"))
    ctx = {
        "verified": verified, "verified_ratio": verified / total,
        "verified_pct": round(verified / total * 100, 1),
        "total": total, "photo": photo, "photo_ratio": photo / total,
        "photo_pct": round(photo / total * 100, 1),
        "small": small, "follower_known": len(known),
        "small_follower_ratio": (small / len(known)) if known else 0,
        "small_pct": round(small / len(known) * 100, 1) if known else 0,
        "recent7_ratio": (recent / dated) if dated else None,
        "recent_pct": round(recent / dated * 100, 1) if dated else None,
        "ref_date": ref.date().isoformat() if ref is not None else None,
        "pr_save_rate": sr(pr), "no_pr_save_rate": sr(no),
        "pr_views": _median([r.get("views") for r in pr]),
        "no_pr_views": _median([r.get("views") for r in no]),
        "ad_count": len(pr),
        "ad_only": ad_only,
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
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180,
                              encoding="utf-8", errors="replace", env=CHILD_ENV)
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
    if d is None:
        return False, "JSON を読めない（取り直す）"
    if isinstance(d, dict) and d.get("ok") is False:
        if d.get("errorCode") == "TIKTOK_TRULY_EMPTY":
            # 0件の語は case.json に入れたままだと取得・組み立てが止まる。「検索されていない語」という発見として返し、語を替える
            return False, ("0件（TIKTOK_TRULY_EMPTY）。時間を置いて同じ条件で1回取り直し、"
                           "2回とも0件なら検索されていない語として別の語に替える")
        return False, f"取得失敗（{d.get('errorCode') or d.get('error')}）"
    vs = d.get("videos") if isinstance(d, dict) else d
    return True, len(vs or [])


def _is_empty(state):
    """_files_state の理由が「0件（TIKTOK_TRULY_EMPTY）」か。同じ条件で取り直しても0件なら語を替える"""
    return isinstance(state, str) and state.startswith("0件")


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
            query=primary.get("query") or primary.get("name"), file=primary.get("file"),
            empty=_is_empty(n))
    else:
        add("category_search", "todo", "keywords が空です")
    if comps:
        parts, missing = [], []
        for b in comps[:4]:
            ok, n = _files_state(case_dir, b.get("file"))
            conf = "確認済み" if b.get("confirmed_by_client") else "想定"
            parts.append(f"{b.get('short') or b['name']}（{conf}・{f'{n}本' if ok else n}）")
            if not ok:
                missing.append({"query": b.get("query"), "file": b.get("file"), "name": b["name"],
                                "empty": _is_empty(n)})
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
            query=own.get("query"), file=own.get("file"), empty=_is_empty(n))
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
    acq, empty = [], []
    for key in ("category_search", "own_search"):
        i = st.get(key)
        if i and i["state"] == "todo" and i.get("file"):
            (empty if i.get("empty") else acq).append((i.get("query"), i.get("file")))
    for m in (st.get("competitors") or {}).get("to_acquire") or []:
        if m.get("file"):
            (empty if m.get("empty") else acq).append((m.get("query"), m.get("file")))
    for q, f in empty:
        # 1回の TRULY_EMPTY では確定しない。0件のファイルを置いたままにすると組み立てが止まる
        steps.append(f"「{q}」は0件（TIKTOK_TRULY_EMPTY）。時間を置いて同じ条件で1回取り直し、"
                     f"2回とも0件なら検索されていない語として営業に伝え、case.json の語を替えて {f} を取り直す")
    for q, f in acq:
        steps.append(f'cd <tiktok-acquire>/scripts && node search.mjs --query "{q}" --max 50 --out {C}/{f}')
    if acq or (st.get("acquired_on") or {}).get("state") == "todo":
        steps.append("取得した日を case.json の acquired_on（YYYY-MM-DD）に入れる")
    if "case_json" in st or empty:
        return steps          # 語を替えるまで、ラベル以降の工程は進められない
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
    findings = compute_findings(load_recs(run_dir), axes, sug.get("findings_rules", []), status="初訪",
                                ref=reference_time(run_dir))
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


def load_module_defs():
    """tiktok-deck/tools/modules.json（入力ID⇔不足ラベル、章の needs）。読めなければ None"""
    d = deck_dir()
    return load_json(d / "tools" / "modules.json") if d else None


NOT_COMPUTED_PREFIX = "今回取得したデータの範囲では"


def gap_entries(spec, defs, by_input, intake):
    """build_deck の blocked_detail → 入力ごとの「次の一手」。文言は入力IDで引く"""
    labels = (defs or {}).get("input_labels") or {}
    label_to_id = {v: k for k, v in labels.items()}
    uses = {}
    for m in (defs or {}).get("modules") or []:
        if m.get("excluded"):
            continue            # 対象外の章（5-4 等）を「埋まると増える」と約束しない
        for k in m.get("needs") or []:
            uses.setdefault(k, []).append(m["id"])
    official_absent = bool((intake or {}).get("official_tiktok_absent"))
    gaps = {}
    for b in spec.get("blocked_detail", []):
        for m in b["missing"]:
            iid = label_to_id.get(m) or ("_not_computed" if m.startswith(NOT_COMPUTED_PREFIX) else None)
            g = gaps.get(m)
            if g is None:
                g = {"id": iid, "blocks": [], **(by_input.get(iid) or by_input.get(m) or {})}
                if iid and uses.get(iid):
                    g["uses"] = uses[iid]
                if iid == "official_tiktok_account" and official_absent:
                    # 営業が「公式TikTok：無し」と書いた事実を聞き返さない（intake.json が唯一の記録）。
                    # build_deck.py 側に「無し」を渡す口が無いので章は ⛔ のまま出る
                    g = {"id": iid, "blocks": [], "confirmed_absent": True,
                         "why": "公式TikTokは「無し」で確定（依頼票・intake.json）。探し直さない・聞き返さない",
                         "auto": "資料では『公式0本（確定）』として扱ってよい。build_dataset.py / build_deck.py には"
                                 "「無し」を渡す口が無いため、この章は入力不足の表示のまま残る"}
                if not g.get("why") and not g.get("run") and not g.get("ask"):
                    g["unmapped"] = True
                gaps[m] = g
            g["blocks"].append(f"{b['id']} {b['name']}")
    return gaps


def report_gaps(run_dir, intake, by_input):
    """④レポートだけの確認。build_deck のレポートの章は施策前データを要求しないので、ここで見る。

    手順どおり build_dataset.py に --baseline を渡しても gaps に何も出ず、施策開始日の抜けにも
    気づけなかった（2026-09 監査）。確定していない社内情報は、聞くか、受け取った値を渡す一手にする。
    """
    cfg = load_json(run_dir / "confirmed_config.json") or {}
    fields = (intake or {}).get("fields") or {}
    out = {}
    where = "レポート資料（generate.js --mode レポート）"
    if not cfg.get("campaign_start") or not cfg.get("measurement_period"):
        g = {"id": "campaign_period", "blocks": [where], **(by_input.get("campaign_period") or {})}
        if fields.get("campaign_start") and fields.get("period"):
            # 受け取った値を聞き返さない。渡し忘れを埋める一手だけにする
            for k in ("ask", "example", "auto"):
                g.pop(k, None)
            g["run"] = (f"依頼票で受け取り済み（施策開始 {fields['campaign_start']}／対象期間 {fields['period']}）。"
                        "YYYY-MM-DD にして build_dataset.py --campaign-start … --period … で渡す（年は推測しない）")
        out["施策開始日・対象期間"] = g
    if not cfg.get("baseline"):
        if (intake or {}).get("baseline_absent"):
            out["施策前スナップショット"] = {
                "id": "baseline", "blocks": [where], "confirmed_absent": True,
                "why": "施策前のデータは「無い」で確定（依頼票）。前後比較は作れない",
                "warn": "現状値だけの資料にするかを確認する。施策前後の比較とは書かない"}
        else:
            g = {"id": "baseline", "blocks": [where], **(by_input.get("baseline") or {})}
            if fields.get("baseline"):
                g.pop("ask", None)
                g["ask"] = (f"依頼票では「{fields['baseline']}」。施策前に取った検索結果（run-dir）の場所を教えてください")
            out["施策前スナップショット"] = g
    return out


def selftest():
    """suggestions.json と modules.json の食い違いを確かめる（入力IDに文言が無い／使われないキー）"""
    sug = load_suggestions()
    defs = load_module_defs()
    if defs is None:
        print("[STOP] tiktok-deck/tools/modules.json が見つかりません（TIKTOK_DECK_DIR で指定できます）",
              file=sys.stderr)
        return 2
    by_input = sug.get("by_missing_input") or {}
    excluded_only = {k for k in defs.get("input_labels", {})
                     if all(m.get("excluded") for m in defs["modules"] if k in (m.get("needs") or []))}
    ok = True
    for k, label in defs.get("input_labels", {}).items():
        e = by_input.get(k)
        mark = "OK " if e and (e.get("why") and (e.get("ask") or e.get("run") or e.get("auto"))) else "NG "
        if mark == "NG ":
            ok = False
        print(f"  {mark}{k}（{label}）" + ("  ※対象外の章だけが使う入力" if k in excluded_only else ""))
    own = set(defs.get("input_labels", {})) | {"campaign_period", "_not_computed"}
    for k in by_input:
        if k not in own:
            ok = False
            print(f"  NG suggestions.json の {k} は build_deck が出さない入力です（表示されない）")
    for k, e in by_input.items():
        if "unlocks" in e:
            ok = False
            print(f"  NG {k}.unlocks は持たない（modules.json の needs から数える）")
    print("\n" + ("✅ 自己検査 OK" if ok else "❌ 自己検査 NG"))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="足りない入力を次の一手に翻訳する")
    ap.add_argument("--run-dir", help="計測の作業フォルダ（初訪以外は必須）")
    ap.add_argument("--case", help="案件ディレクトリ（case.json のある場所。初訪で使う）")
    ap.add_argument("--status", help="営業ステータス（例: 初訪。別名 quick/deep/report 等も可）")
    ap.add_argument("--modules", help="モジュールID（例: 1-1,3-2）")
    ap.add_argument("--json", action="store_true", help="JSON で出す")
    ap.add_argument("--selftest", action="store_true", help="suggestions.json と modules.json の食い違いを確かめる")
    args = ap.parse_args()
    utf8_stdio()
    if args.selftest:
        raise SystemExit(selftest())
    if not args.status and not args.modules:
        fail("--status か --modules を指定してください")

    run_dir = Path(args.run_dir).expanduser().resolve() if args.run_dir else None
    if run_dir and not run_dir.exists():
        fail(f"run-dir がありません: {run_dir}")
    case_dir = Path(args.case).expanduser().resolve() if args.case else None
    if case_dir and not case_dir.exists():
        fail(f"案件ディレクトリがありません: {case_dir}")
    sug = load_suggestions()

    statuses = canon_statuses(args.status) if args.status else []
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
    status_arg = ",".join(statuses) if statuses else None
    spec = build_spec(run_dir, status_arg, args.modules)
    recs = load_recs(run_dir)
    intake = load_json(run_dir / "intake.json") if (run_dir / "intake.json").exists() else None
    by_input = sug["by_missing_input"]

    # ① 足りないもの → アクション（同じ入力名でまとめる）
    gaps = gap_entries(spec, load_module_defs(), by_input, intake)
    if "レポート" in statuses:
        gaps.update(report_gaps(run_dir, intake, by_input))

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

    findings = compute_findings(recs, axis_count(recs), sug.get("findings_rules", []),
                                status=statuses[0] if statuses else None, ref=reference_time(run_dir))

    selection = status_arg or args.modules
    result = {
        "run_dir": str(run_dir),
        "keyword": spec.get("keyword"),
        "selection": selection,
        "summary": spec.get("summary"),
        "gaps": gaps,
        "ready_chapters": ready,
        "findings": findings,
        # 章ID は build_deck.py / modules.json の番号。generate.js の資料ページ（Q1〜Q8 等）とは対応していない
        "chapter_note": CHAPTER_NOTE,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # ── 人が読む形（営業へそのまま出せる文面）──
    sm = spec.get("summary", {})
    print(f"■ 「{selection}」の分析（build_deck.py の章）：全{sm.get('total')}章のうち "
          f"{sm.get('ready')}章はいま数えられます（{sm.get('blocked')}章が入力不足）\n")

    if findings:
        print("【データを見て気づいた点】")
        for f in findings:
            print(f"  ・{f['text']}")
        print()

    if ready:
        print("【いま数えられる章】")
        for c in ready:
            hl = f"（{c['highlight']}）" if c["highlight"] else ""
            print(f"  ✅ {c['id']} {c['name']}{hl}")
        print()

    if gaps:
        print("【足りないもの／次の一手】")
        for name, g in gaps.items():
            print(f"  {'✅' if g.get('confirmed_absent') else '⛔'} {name}")
            print(f"     止まっている章: {', '.join(g['blocks'])}")
            if g.get("why"):
                print(f"     なぜ必要か  : {g['why']}")
            if g.get("ask"):
                print(f"     営業に聞く   : {g['ask']}")
            if g.get("example"):
                print(f"     {g['example']}")
            if g.get("run"):
                print(f"     こちらで実行 : {g['run']}")
            if g.get("auto"):
                print(f"     こちらで補える: {g['auto']}")
            if g.get("warn"):
                print(f"     ⚠️ {g['warn']}")
            if g.get("uses"):
                print(f"     この入力を使う章: {', '.join(g['uses'])}")
            if g.get("unmapped"):
                # 文言が無い不足を黙って空にしない（営業が止まる）
                print("     （この不足の次の一手は suggestions.json に未登録。gaps.py --selftest で確認）")
            print()
    else:
        print("【足りないもの】なし。このまま資料化できます。\n")
    print(f"※ {CHAPTER_NOTE}")


# 章ID と資料ページの関係。gaps.py が章を「資料に載る」と約束しないための注記（2026-09 監査:
# 初訪で 1-1 露出シェア・2-3 ハッシュタグが「出せる」と出ていたが、generate.js はその章を描かない）
CHAPTER_NOTE = ("章ID（1-1〜6-3）は build_deck.py / modules.json の分析の番号です。generate.js が作るPPTXの"
                "ページ（Q1〜Q8 等）とは対応していません。資料のページ構成は generate.js --mode <型> が決めます")


if __name__ == "__main__":
    main()
