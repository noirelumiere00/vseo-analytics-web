#!/usr/bin/env python3
"""案件の語彙（話題分類・タグ分類）の候補を実データから出す。

話題分類とタグ分類は**案件ごとに語彙が違う**。化粧品案件の既定語彙を
コンビニ案件に当てると「クリームたっぷりダブルシュー」が
「化粧品・スキンケア商品」に分類され、その数字が資料に載る（実際に起きた）。

このスクリプトは分類を決めない。**実データに何が出ているかを数えて候補を出す**。
ラベル付けは Claude（または人）が行い、`--apply` で確定させる。
機械が候補を出す → Claude が判断する → スクリプトが検証して取り込む、
という本スイート共通の作りに揃えている。

    python3 suggest_vocab.py --run-dir <run-dir>                  # 候補を出す
    python3 suggest_vocab.py --run-dir <run-dir> --apply <run-dir>/rules.json  # 確定させる
    # rules.json は案件データなので <run-dir> に置く（スキル本体の scripts/ に書かない）

`rules.json` の形:

    {
      "market_category_rules": [
        {"key": "sweets", "label": "スイーツ・デザート",
         "terms": ["スイーツ", "シュー", "プリン", "ケーキ"]}
      ],
      "hashtag_class_rules": [
        {"label": "競合ブランド", "terms": ["セブンイレブン", "ローソン"]}
      ]
    }
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def load_recs(run_dir: Path):
    p = run_dir / "normalized" / "videos.jsonl"
    if not p.exists():
        fail(f"videos.jsonl がありません: {p}")
    out = []
    for line in p.read_text(encoding="utf-8").split("\n"):
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def norm(t):
    return re.sub(r"[\s　_]+", "", str(t)).lower()


def main():
    ap = argparse.ArgumentParser(description="案件の語彙候補を実データから出す")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--top", type=int, default=30, help="候補として出す上位件数")
    ap.add_argument("--apply", default=None,
                    help="ラベル付けした rules.json を confirmed_config.json に取り込む")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    cfg_path = run_dir / "confirmed_config.json"
    if not cfg_path.exists():
        fail(f"confirmed_config.json がありません: {cfg_path}")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

    if args.apply:
        rules = json.loads(Path(args.apply).expanduser().read_text(encoding="utf-8"))
        wrote = []
        for key in ("market_category_rules", "hashtag_class_rules"):
            items = rules.get(key)
            if not items:
                continue
            # 検証: label と terms が実体を持つこと。空ルールを入れると
            # 「分類したのに何も当たらない」状態が静かに生まれる。
            for i, r in enumerate(items):
                if not r.get("label"):
                    fail(f"{key}[{i}]: label がありません")
                terms = [t for t in (r.get("terms") or []) if str(t).strip()]
                if not terms:
                    fail(f"{key}[{i}] ({r['label']}): terms が空です")
                r["terms"] = terms
                r.setdefault("key", f"rule_{i+1}")
            cfg[key] = items
            wrote.append(f"{key}={len(items)}件")
        if not wrote:
            fail("取り込む内容がありません（market_category_rules / hashtag_class_rules）")
        cfg["vocab_source"] = {"applied_from": str(Path(args.apply).expanduser()),
                               "note": "案件ごとの語彙。既定語彙（化粧品サンプル）は使わない"}
        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"ok": True, "applied": wrote, "config": str(cfg_path)},
                         ensure_ascii=False, indent=2))
        return

    recs = load_recs(run_dir)
    if not recs:
        fail("レコードが0件です")

    # 既に分類できている語は候補から除く（ブランド名・PR・汎用リーチ語）
    files = cfg.get("files") or []
    known = {norm(x) for x in
             [cfg.get("brand"), cfg.get("keyword"), cfg.get("product"),
              *(cfg.get("keyword_variants") or []),
              *[f.get("label") for f in files]] if x}
    REACH = {"fyp", "foryou", "foryoupage", "おすすめ", "おすすめにのりたい",
             "拡散希望", "バズりたい", "繋がりたい", "tiktok", "trend", "トレンド"}
    PR = {"pr", "ad", "sponsored", "タイアップ", "提供", "広告"}

    tags = Counter()
    for r in recs:
        for t in (r.get("hashtags") or []):
            n = norm(t)
            if n in PR or n in REACH:
                continue
            if any(k and (k in n or n in k) for k in known):
                continue
            tags[t] += 1

    # 本文によく出る語（2文字以上のカタカナ・漢字の連なり）
    words = Counter()
    for r in recs:
        for w in re.findall(r"[ァ-ヶー]{3,}|[一-龠]{2,}", r.get("caption") or ""):
            n = norm(w)
            if any(k and (k in n or n in k) for k in known):
                continue
            words[w] += 1

    print(json.dumps({
        "ok": True,
        "run_dir": str(run_dir),
        "records": len(recs),
        "note": ("これは候補であって分類ではない。ラベル付けは人／Claude が行い、"
                 f"{run_dir}/rules.json にして --apply する。"
                 "既定語彙（化粧品サンプル）を他業種に当てない"),
        "brand_and_axes": sorted(known),
        "unclassified_hashtags": [{"tag": t, "count": c} for t, c in tags.most_common(args.top)],
        "frequent_words_in_caption": [{"word": w, "count": c}
                                      for w, c in words.most_common(args.top)],
        "next": ("この候補を見て、意味のまとまりごとに label と terms を決め、"
                 f"{run_dir}/rules.json に書いて --apply する"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
