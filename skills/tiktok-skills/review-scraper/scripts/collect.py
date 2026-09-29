#!/usr/bin/env python3
"""美容・EC の口コミを集める。

    # URLを渡す（サイトは自動判定）
    python collect.py --url https://www.cosme.net/products/10278884/ --out runs/test
    # 候補を見るだけ（取得しない）。ユーザーに確認してから --url で取る
    python collect.py --keyword "メラノCC 美容液" --list
    # キーワードで各サイトの上位N商品をそのまま取る（別商品が混ざりうる。確認済みのときだけ）
    python collect.py --keyword "メラノCC 美容液" --out runs/melano

出力（--out の下）:
    reviews.csv     全口コミ（Excelでそのまま開ける UTF-8 BOM 付き）
    reviews.jsonl   同じ内容（1行1件）
    summary.md      商品ごとの件数・平均評価（元の段階と5段階換算）・期間・評価/年代などの内訳
    acquire_log.json  何を検索し、何を取りに行き、何件取れ、何で失敗したか

取得件数が0、または構造変化・アクセス拒否・途中で失敗した商品や検索があれば
（取れた分は出力したうえで）exit 2 で止める。
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import FIELDS, Blocked, Fetcher, SiteChanged, now_iso  # noqa: E402
from sites import SITES, detect  # noqa: E402


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def stop(msg, code=2):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(code)


# Excel は = + - @（とタブ・CR）で始まるセルを数式として評価する。口コミ本文・タイトルは
# 第三者が書いた文字列なので、CSV では先頭に ' を付けて文字列として開かせる（CSVインジェクション対策）。
# 元の文字列は reviews.jsonl にそのまま残す。
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(v):
    if isinstance(v, str) and v.startswith(_FORMULA_START):
        return "'" + v
    return v


def write_outputs(out, reviews, products, args, searches=None):
    out.mkdir(parents=True, exist_ok=True)
    with (out / "reviews.jsonl").open("w", encoding="utf-8") as f:
        for r in reviews:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    # Windows の Excel が文字化けしないよう BOM 付き UTF-8
    with (out / "reviews.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in reviews:
            row = dict(r)
            if isinstance(row.get("attributes"), dict):
                row["attributes"] = json.dumps(row["attributes"], ensure_ascii=False)
            w.writerow({k: _csv_safe(v) for k, v in row.items()})
    (out / "acquire_log.json").write_text(json.dumps({
        "run_at": now_iso(), "args": vars(args), "searches": searches or [], "products": products,
        "total_reviews": len(reviews),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "summary.md").write_text(summary(reviews, products), encoding="utf-8")


def _dist(values):
    c = Counter(v for v in values if v not in (None, ""))
    return "、".join(f"{k} {n}件" for k, n in sorted(c.items(), key=lambda x: (-x[1], str(x[0])))) or "—"


def _cell(v):
    """Markdown の表のセル。商品名の | や改行で列がずれないようにする。"""
    return str(v).replace("|", "\\|").replace("\n", " ")


def _label(site):
    return SITES[site].LABEL if site in SITES else site


def summary(reviews, products):
    lines = ["# 口コミ取得サマリー", "", f"取得日時: {now_iso()}", ""]
    lines += ["| サイト | 商品 | 取得 / サイト表示 | 平均（元の段階） | 平均（5段階換算） | 期間 | 状態 |",
              "|---|---|---|---|---|---|---|"]
    per_product = []
    for p in products:
        name = _cell(p.get("name") or p.get("ref"))
        if p.get("duplicate_of"):
            # 同じ商品を二度数えない（口コミは最初の行に入っている）
            lines.append(f"| {_label(p['site'])} | {name} | — | — | — | — | {_cell(p['status'])} |")
            continue
        rs = [r for r in reviews if r["site"] == p["site"] and r["product_id"] == p.get("product_id")]
        # 平均は 1〜満点 の範囲の評価だけで出す（@cosme の 0 等は rating_5 が空なので除く）
        valid = [r for r in rs if r["rating_5"] is not None]
        scale = valid[0]["rating_scale"] if valid else None
        native = f"{round(sum(float(r['rating']) for r in valid) / len(valid), 2)} / {scale}" if valid else "—"
        avg5 = round(sum(r["rating_5"] for r in valid) / len(valid), 2) if valid else "—"
        dates = sorted(r["posted_at"] for r in rs if r["posted_at"])
        span = f"{dates[0]}〜{dates[-1]}" if dates else "—"
        total = p.get("site_total")
        lines.append(
            f"| {_label(p['site'])} | {name} "
            f"| {len(rs)} / {total if total is not None else '不明'} "
            f"| {native} | {avg5} | {span} | {_cell(p['status'])} |")
        if rs:
            per_product.append((p, name, rs))
    # 内訳は商品ごとに出す（自社品と競合品を合算すると比較に使えないため）
    lines += ["", "## 属性の内訳（商品ごと）"]
    for p, name, rs in per_product:
        lines += ["", f"### {_label(p['site'])}｜{name}", ""]
        # 3.12 未満では f-string の中に同じ引用符を入れられないので外で作る
        ratings = ["%s/%s" % (r["rating"], r["rating_scale"]) for r in rs if r["rating"] is not None]
        lines.append(f"- 評価（サイトの元の段階）: {_dist(ratings)}")
        lines.append(f"- 年代（@cosmeの年齢は年代に換算）: {_dist(r['age_band'] for r in rs)}")
        lines.append(f"- 性別: {_dist(r['gender'] for r in rs)}")
        lines.append(f"- 肌質（@cosmeのみ）: {_dist(r['skin_type'] for r in rs)}")
        lines.append(f"- 購入区分（@cosmeのみ）: {_dist(r['purchase'] for r in rs)}")
    trunc = sum(1 for r in reviews if r["body_truncated"])
    lines += ["", "## 読むときの注意", "",
              "- @cosme の評価は7段階。`rating_5` は 1〜満点 を 1〜5 に線形で換算した値（比較用。"
              "式: 1 + (評価 − 1) × 4 ÷ (満点 − 1)）。資料に評価点を載せるときは「平均（元の段階）」と満点を併記する",
              "- 満点の範囲外の評価（@cosme の 0 等）は換算せず、平均にも入れない",
              "- 年代・肌質・性別は投稿者が登録している場合のみ。無い口コミは空欄（0件ではない）",
              "- 楽天・Yahoo!の最上位の年代（「◯代以上」）はサイトの区分のまま。@cosme の年齢は10歳刻みで換算するので、"
              "上の年代を比べるときはまとめて読む",
              "- Yahoo!ショッピングはページに最初から載る先頭20件まで（取得/サイト表示で差を確認）。"
              "Yahoo!の `review_url` は口コミ一覧のURL（1件ごとのURLではない）"]
    if trunc:
        lines.append(f"- 本文が途中までの口コミが {trunc} 件ある（`body_truncated=True`）")
    return "\n".join(lines) + "\n"


def main():
    # 日本語 Windows でパイプ経由（Claude Code の実行形態）だと stdout が cp932 になり、
    # 商品名の絵文字・♡ などで --list が UnicodeEncodeError で落ちる。書けない文字は ? にして続ける
    # （進捗の stderr は既定で backslashreplace なので落ちない）
    try:
        sys.stdout.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

    ap = argparse.ArgumentParser(description="美容・ECの口コミを集める（@cosme / 楽天 / Yahoo!ショッピング）")
    ap.add_argument("--url", action="append", default=[], help="商品または口コミページのURL（複数可）")
    ap.add_argument("--keyword", help="商品を検索するキーワード")
    ap.add_argument("--site", default="cosme,rakuten,yahoo",
                    help="キーワード検索するサイト（カンマ区切り。既定: 全部）")
    ap.add_argument("--products", type=int, default=3, help="キーワード検索でサイトごとに何商品取るか")
    ap.add_argument("--max", type=int, default=200, help="1商品あたりの最大件数")
    ap.add_argument("--out", help="出力ディレクトリ")
    ap.add_argument("--list", action="store_true", help="候補を表示するだけで取得しない")
    ap.add_argument("--no-full-text", action="store_true",
                    help="@cosme の全文取得（個別ページ）を省く。速いが本文が途中で切れる")
    ap.add_argument("--delay", type=float, default=1.5, help="同じサイトへのアクセス間隔（秒）")
    args = ap.parse_args()

    if not args.url and not args.keyword:
        stop("--url か --keyword を指定してください")
    if not args.list and not args.out:
        stop("--out（出力ディレクトリ）を指定してください")

    fetcher = Fetcher(delay=args.delay, log=log)
    targets = []
    for u in args.url:
        mod, ref = detect(u)
        if mod is None:
            stop(f"{u}: {ref}")
        targets.append({"site": mod.NAME, "ref": ref, "name": None, "source": u})

    # 検索の結果も acquire_log.json に残す（全サイトで検索が失敗したとき、ログに何も無いと原因を追えない）
    searches, failed_searches = [], []
    if args.keyword:
        for s in [x.strip() for x in args.site.split(",") if x.strip()]:
            if s not in SITES:
                stop(f"未対応のサイト: {s}（{', '.join(SITES)}）")
            rec = {"site": s, "keyword": args.keyword}
            try:
                cands = SITES[s].search(fetcher, args.keyword, limit=args.products)
                rec.update({"status": "OK" if cands else "候補なし", "candidates": len(cands)})
            except (Blocked, SiteChanged) as e:
                log(f"[WARN] {SITES[s].LABEL} の検索に失敗: {e}")
                cands = []
                rec.update({"status": "アクセス拒否" if isinstance(e, Blocked) else "構造変化で読めず",
                            "error": str(e), "candidates": 0})
            except Exception as e:  # noqa: BLE001
                log(f"[WARN] {SITES[s].LABEL} の検索に失敗: {e}")
                cands = []
                rec.update({"status": "検索失敗", "error": f"{type(e).__name__}: {e}", "candidates": 0})
            searches.append(rec)
            if rec.get("error"):
                failed_searches.append(rec)
            if not cands:
                log(f"[WARN] {SITES[s].LABEL} で「{args.keyword}」の商品が見つかりませんでした")
            for c in cands:
                c["source"] = f"keyword:{args.keyword}"
                targets.append(c)

    if args.list:
        for t in targets:
            rc = t.get("review_count")
            print(f"{SITES[t['site']].LABEL}\t{t.get('name') or ''}\t"
                  f"{'口コミ' + str(rc) + '件' if rc is not None else ''}\t{t.get('url') or t['ref']}")
        return

    reviews, products, failed = [], [], []
    done = {}   # (サイト, 口コミID) → 最初に取った入力。同じ商品を二重に取らない・数えないため
    for t in targets:
        mod = SITES[t["site"]]
        log(f"■ {mod.LABEL}: {t.get('name') or t['ref']}")
        entry = {"site": t["site"], "ref": t["ref"], "source": t.get("source"), "name": t.get("name")}
        try:
            # 楽天の商品ページURLは口コミIDに解決してから重複を判定する
            # （商品ページURLと口コミURLの両方を渡されると、同じ口コミが二重に出力されるため）
            ref = mod.resolve(fetcher, t["ref"]) if hasattr(mod, "resolve") else t["ref"]
            key = (t["site"], ref)
            if key in done:
                entry.update({"status": "重複（同じ商品は上の行）", "duplicate_of": done[key], "fetched": 0})
                products.append(entry)
                log(f"  → 重複のため省略（{done[key]} と同じ商品）")
                continue
            done[key] = t.get("source") or t["ref"]
            meta, rs = mod.collect(fetcher, ref, max_reviews=args.max,
                                   full_text=not args.no_full_text, log=log)
            entry.update({"product_id": meta.get("product_id"), "name": meta.get("name") or t.get("name"),
                          "url": meta.get("url"), "site_total": meta.get("site_total"),
                          "fetched": len(rs), "status": "OK" if rs else "0件"})
            reviews += rs
            log(f"  → {len(rs)}件（サイト表示 {meta.get('site_total') if meta.get('site_total') is not None else '不明'}件）")
            if meta.get("incomplete"):
                # 2ページ目以降で失敗した。取れた分は出力するが、全件ではないので失敗として数える
                entry.update({"status": "途中で失敗（取れた分のみ）", "error": meta["incomplete"]})
                failed.append(entry)
                log(f"  [ERROR] {meta['incomplete']}")
        except SiteChanged as e:
            entry.update({"status": "構造変化で読めず", "error": str(e), "fetched": 0})
            failed.append(entry)
            log(f"  [ERROR] {e}")
        except Blocked as e:
            entry.update({"status": "アクセス拒否", "error": str(e), "fetched": 0})
            failed.append(entry)
            log(f"  [ERROR] {e}")
        except Exception as e:  # noqa: BLE001
            entry.update({"status": "取得失敗", "error": f"{type(e).__name__}: {e}", "fetched": 0})
            failed.append(entry)
            log(f"  [ERROR] {type(e).__name__}: {e}")
        products.append(entry)

    out = Path(args.out).expanduser()
    write_outputs(out, reviews, products, args, searches)
    log(f"\n合計 {len(reviews)}件 → {out}（アクセス {fetcher.requests}回）")
    if not reviews:
        stop("口コミが1件も取れませんでした。acquire_log.json の products[].error"
             + ("・searches[].error" if searches else "") + " を確認してください")
    if failed or failed_searches:
        what = "、".join(x for x in (f"{len(failed)}商品で取得" if failed else "",
                                     f"{len(failed_searches)}サイトで検索" if failed_searches else "") if x)
        stop(f"{what}に失敗しました（取れた分は出力済み）。acquire_log.json の error を確認してください")


if __name__ == "__main__":
    main()
