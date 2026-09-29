#!/usr/bin/env python3
"""美容・EC の口コミを集める。

    # URLを渡す（サイトは自動判定）
    python collect.py --url https://www.cosme.net/products/10278884/ --out runs/test
    # キーワードで各サイトの商品を探して、上位N商品の口コミを集める
    python collect.py --keyword "メラノCC 美容液" --out runs/melano
    # 候補を見るだけ（取得しない）
    python collect.py --keyword "メラノCC 美容液" --list

出力（--out の下）:
    reviews.csv     全口コミ（Excelでそのまま開ける UTF-8 BOM 付き）
    reviews.jsonl   同じ内容（1行1件）
    summary.md      商品ごとの件数・評価分布・期間・年代
    acquire_log.json  何を取りに行き、何件取れ、何で失敗したか

取得件数が0、またはサイトの構造が変わって読めなかった商品があれば exit 2 で止める。
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


def write_outputs(out, reviews, products, args):
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
            w.writerow(row)
    (out / "acquire_log.json").write_text(json.dumps({
        "run_at": now_iso(), "args": vars(args), "products": products,
        "total_reviews": len(reviews),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "summary.md").write_text(summary(reviews, products), encoding="utf-8")


def _dist(values):
    c = Counter(v for v in values if v not in (None, ""))
    return "、".join(f"{k} {n}件" for k, n in sorted(c.items(), key=lambda x: (-x[1], str(x[0])))) or "—"


def summary(reviews, products):
    lines = ["# 口コミ取得サマリー", "", f"取得日時: {now_iso()}", ""]
    lines += ["| サイト | 商品 | 取得 / サイト表示 | 平均（5段階換算） | 期間 | 状態 |",
              "|---|---|---|---|---|---|"]
    for p in products:
        rs = [r for r in reviews if r["site"] == p["site"] and r["product_id"] == p.get("product_id")]
        avg = [r["rating_5"] for r in rs if r["rating_5"] is not None]
        dates = sorted(r["posted_at"] for r in rs if r["posted_at"])
        span = f"{dates[0]}〜{dates[-1]}" if dates else "—"
        total = p.get("site_total")
        lines.append(
            f"| {SITES[p['site']].LABEL if p['site'] in SITES else p['site']} | {p.get('name') or p.get('ref')} "
            f"| {len(rs)} / {total if total is not None else '不明'} "
            f"| {round(sum(avg) / len(avg), 2) if avg else '—'} | {span} | {p['status']} |")
    lines += ["", "## 属性の内訳（全商品合計）", ""]
    # 3.12 未満では f-string の中に同じ引用符を入れられないので外で作る
    ratings = ["%s/%s" % (r["rating"], r["rating_scale"]) for r in reviews if r["rating"] is not None]
    lines.append(f"- 評価（各サイトの元の段階）: {_dist(ratings)}")
    lines.append(f"- 年代（@cosmeの年齢は年代に換算）: {_dist(r['age_band'] for r in reviews)}")
    lines.append(f"- 性別: {_dist(r['gender'] for r in reviews)}")
    lines.append(f"- 肌質（@cosmeのみ）: {_dist(r['skin_type'] for r in reviews)}")
    lines.append(f"- 購入区分（@cosmeのみ）: {_dist(r['purchase'] for r in reviews)}")
    trunc = sum(1 for r in reviews if r["body_truncated"])
    lines += ["", "## 読むときの注意", "",
              "- @cosme の評価は7段階。`rating_5` は5段階に換算した値（比較用）",
              "- 年代・肌質・性別は投稿者が登録している場合のみ。無い口コミは空欄（0件ではない）",
              "- Yahoo!ショッピングはページに最初から載る先頭20件まで（取得/サイト表示で差を確認）"]
    if trunc:
        lines.append(f"- 本文が途中までの口コミが {trunc} 件ある（`body_truncated=True`）")
    return "\n".join(lines) + "\n"


def main():
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

    if args.keyword:
        for s in [x.strip() for x in args.site.split(",") if x.strip()]:
            if s not in SITES:
                stop(f"未対応のサイト: {s}（{', '.join(SITES)}）")
            try:
                cands = SITES[s].search(fetcher, args.keyword, limit=args.products)
            except (Blocked, SiteChanged) as e:
                log(f"[WARN] {SITES[s].LABEL} の検索に失敗: {e}")
                cands = []
            except Exception as e:  # noqa: BLE001
                log(f"[WARN] {SITES[s].LABEL} の検索に失敗: {e}")
                cands = []
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
    for t in targets:
        mod = SITES[t["site"]]
        log(f"■ {mod.LABEL}: {t.get('name') or t['ref']}")
        entry = {"site": t["site"], "ref": t["ref"], "source": t.get("source"), "name": t.get("name")}
        try:
            meta, rs = mod.collect(fetcher, t["ref"], max_reviews=args.max,
                                   full_text=not args.no_full_text, log=log)
            entry.update({"product_id": meta.get("product_id"), "name": meta.get("name") or t.get("name"),
                          "url": meta.get("url"), "site_total": meta.get("site_total"),
                          "fetched": len(rs), "status": "OK" if rs else "0件"})
            reviews += rs
            log(f"  → {len(rs)}件（サイト表示 {meta.get('site_total') if meta.get('site_total') is not None else '不明'}件）")
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
    write_outputs(out, reviews, products, args)
    log(f"\n合計 {len(reviews)}件 → {out}（アクセス {fetcher.requests}回）")
    if not reviews:
        stop("口コミが1件も取れませんでした。acquire_log.json の error を確認してください")
    if failed:
        stop(f"{len(failed)}商品で取得に失敗しました（取れた分は出力済み）。acquire_log.json を確認してください")


if __name__ == "__main__":
    main()
