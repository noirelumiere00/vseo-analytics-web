#!/usr/bin/env python3
"""スクレイパの検索結果 JSON から、分析用データセットを直接組み立てる。

従来フロー（営業の手作業が3段あった）:
    tiktok-KOL で検索 → スクロール3倍してエクスポート → Excel を渡す
      → validate_input.py → normalize_dataset.py → normalized/videos.jsonl

本スクリプトのフロー:
    search.mjs --max all --sessions 2 → JSON
      → build_dataset.py → normalized/videos.jsonl（Excel を経由しない）

Excel を作らないので、列の表記ゆれ・並び替え事故・カバー画像の埋め込み解釈が
まるごと消える。スクレイパ出力は Excel の上位互換（isAd / followerCount /
動画実ファイルURL などが増える）。

使い方:
    python3 build_dataset.py --run-dir <run-dir> \\
        --source self:セブン-イレブン:/path/セブンイレブン.json \\
        --source competitor:ファミリーマート:/path/ファミマ.json \\
        --source market_keyword:コンビニ:/path/コンビニ.json \\
        --keyword コンビニ --brand セブン-イレブン \\
        --official-site https://www.sej.co.jp/ \\
        --official-tiktok https://www.tiktok.com/@seven.eleven.japan

`--source` は `<role>:<label>:<path>` の形。role は self / competitor / market_keyword。
1ファイル＝1検索軸（従来の Excel と同じ単位）。
"""
import argparse
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import has_pr_tag  # noqa: E402

JST = timezone(timedelta(hours=9))
VALID_ROLES = ("self", "competitor", "market_keyword")


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def parse_source(spec):
    """`role:label:path` を分解する。label にコロンが入る場合を考慮して3分割。"""
    parts = spec.split(":", 2)
    if len(parts) != 3:
        fail(f"--source は role:label:path の形で指定してください: {spec!r}")
    role, label, path = (p.strip() for p in parts)
    if role not in VALID_ROLES:
        fail(f"role は {'/'.join(VALID_ROLES)} のいずれかです: {role!r}")
    p = Path(path).expanduser()
    if not p.exists():
        fail(f"ファイルが見つかりません: {p}")
    return {"role": role, "label": label or p.stem, "path": p}


def load_scraper_json(path: Path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"JSON が壊れています ({path}): {exc}")
    # search.mjs 単体出力 / tiktok_report.py の .json（配列）の両方を受ける
    if isinstance(data, list):
        videos, diag, ok = data, None, True
    elif isinstance(data, dict):
        videos, diag, ok = data.get("videos") or [], data.get("diag"), data.get("ok", True)
    else:
        fail(f"想定外の JSON 構造です: {path}")
    if not videos:
        # 0件は「該当なし」ではなく「取得失敗」の可能性が高い。黙って通さない。
        fail(f"動画0件です ({path})。取得失敗の可能性があるため中断します。"
             f" diag={diag}")
    if diag and diag.get("captchaDetected"):
        fail(f"CAPTCHA を検知した取得結果です ({path})。使用しないでください。")
    return videos, diag, ok


def to_record(v, rank, source_label, source_file, role):
    """スクレイパの1件を videos.jsonl のレコードへ変換する。"""
    author = v.get("author") or {}
    stats = v.get("stats") or {}
    music = v.get("music") or {}
    hashtags = v.get("hashtags") or []
    hashtags_raw = " ".join(f"#{h}" for h in hashtags)
    caption = (v.get("desc") or "").strip()
    views = stats.get("playCount") or 0
    likes = stats.get("diggCount") or 0
    saves = stats.get("collectCount") or 0
    shares = stats.get("shareCount") or 0
    comments = stats.get("commentCount") or 0
    engagement = ((likes + comments + shares + saves) / views * 100) if views else 0.0
    posted_at = ""
    if v.get("createTime"):
        posted_at = datetime.fromtimestamp(int(v["createTime"]), JST).isoformat()

    # #PR は完全一致タグの有無のみ。TikTok 自身の isAd は別項目として残す
    # （両者を混ぜない。#PR は開示の有無、isAd は配信側のフラグで別物）。
    pr = has_pr_tag(hashtags_raw, caption)

    return {
        "video_id": str(v.get("id") or ""),
        "video_url": v.get("url") or "",
        "video_url_kind": "video" if v.get("mediaType") != "photo" else "photo",
        "video_url_valid": bool(v.get("url")),
        "is_short_link": False,
        "caption": caption,
        "hashtags": hashtags,
        "hashtags_raw": hashtags_raw,
        "creator_id": author.get("uniqueId") or "",
        "creator_name": author.get("nickname") or "",
        "follower_count": author.get("followerCount") or 0,
        "creator_verified": bool(author.get("verified")),
        # プロフィール文。企業公式か個人かの判定で最も効く材料なので落とさない。
        "creator_signature": author.get("signature") or "",
        # 投稿者アイコンのURL。資料で「誰が出ているか」を実物で見せる。
        "creator_avatar_url": author.get("avatarUrl") or "",
        "views": views,
        "likes": likes,
        "saves": saves,
        "shares": shares,
        "comments": comments,
        "engagement_rate_pct": round(engagement, 3),
        "save_rate_pct": round(saves / views * 100, 3) if views else 0.0,
        "duration_seconds": v.get("duration") or 0,
        # 写真投稿の duration は音源クリップ長（実測: 93件中60秒が32件）。
        # 「尺」として扱うと資料の尺分布が62%まちがう。由来を残して下流で分ける。
        "video_duration_seconds": (None if (v.get("mediaType") or "video") == "photo"
                                   else (v.get("duration") or 0)),
        "music_duration_seconds": (v.get("music") or {}).get("duration") or 0,
        "duration_source": ("music_fallback"
                            if (v.get("mediaType") or "video") == "photo" else "video"),
        "posted_at": posted_at,
        "rank": rank,
        "source_file": source_file,
        "source_appearances": [{"source_file": source_file, "rank": rank, "label": source_label, "role": role}],
        "role": role,
        "brand": source_label,
        "label": source_label,
        "pr_status_prelim": "pr" if pr else "no_pr",
        # TikTok 自身の広告フラグ。#PR 表記とは別の事実として保持する。
        "is_ad_platform_flag": bool(v.get("isAd")),
        "media_type": v.get("mediaType") or "video",
        "image_count": v.get("imageCount") or 0,
        "cover_image_url": v.get("coverUrl") or "",
        "cover_image_path": None,
        "music_title": music.get("title") or "",
        "music_author": music.get("authorName") or "",
        "music_original": bool(music.get("original")),
        "poi_name": (v.get("poi") or {}).get("name") or "",
        "text_language": v.get("textLanguage") or "",
        # 関連性は後段の signals で確定する。ここでは未判定を明示する。
        "relevance_prefilter": "uncertain",
        "relevance_final": "uncertain",
    }


def main():
    ap = argparse.ArgumentParser(description="スクレイパJSON → 分析用データセット（Excel を経由しない）")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--source", action="append", required=True,
                    help="role:label:path（複数指定可）。role は self/competitor/market_keyword")
    ap.add_argument("--keyword", required=True, help="計測する主キーワード")
    ap.add_argument("--keyword-variants", default="", help="カンマ区切りの表記ゆれ")
    ap.add_argument("--brand", default="", help="対象ブランド名")
    ap.add_argument("--product", default="", help="現行商品／サービス名")
    ap.add_argument("--official-site", default="", help="公式サイトURL")
    ap.add_argument("--official-tiktok", default="", help="公式TikTokアカウントURL")
    ap.add_argument("--original-request", default="", help="営業の依頼文（原文をそのまま保存する）")
    # ④レポート用。これらは TikTok 側に存在せず営業しか知らないため、必ず外から渡す。
    ap.add_argument("--campaign-start", default="", help="施策開始日（例 2026-08-01）。④レポートで必須")
    ap.add_argument("--period", default="", help="対象期間（例 2026-08-01..2026-08-31）。④レポートで必須")
    ap.add_argument("--baseline", default="",
                    help="施策前スナップショットの run-dir か search.json。無ければ前後比較を出さない")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    (run_dir / "normalized").mkdir(parents=True, exist_ok=True)

    baseline_ref = ""
    if args.baseline:
        bp = Path(args.baseline).expanduser().resolve()
        if not bp.exists():
            fail(f"--baseline に指定されたパスがありません: {bp}\n"
                 "  施策前スナップショットは後から遡って作れません。"
                 "パスを確認するか、指定を外して現状値のみの資料に切り替えてください")
        baseline_ref = str(bp)


    sources = [parse_source(s) for s in args.source]

    # 取得側の並び順を確認する。--sessions >1 の出力は「出現回数→再生数」順で、
    # 検索表示順ではない。これを順位として扱うと 1-6 / 3-2 などが嘘になる。
    order_bases = []
    for src in sources:
        try:
            raw = json.loads(Path(src["path"]).expanduser().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            order_bases.append("unknown")
            continue
        order_bases.append(raw.get("order_basis") or "unknown")
    bad = [b for b in order_bases if b not in ("search_display_order", "unknown")]
    if bad:
        print("WARNING: 検索表示順ではない並びが混ざっています "
              f"({', '.join(sorted(set(bad)))})。"
              "順位を根拠にする章（1-1 露出シェア／1-6 再生順×表示順／3-2 上位下位差分）は"
              "この並びでは使えません。--sessions 1 で取り直してください。", file=sys.stderr)
    if not any(s["role"] == "self" for s in sources):
        print("WARNING: role=self の検索軸がありません。自社の露出分析はできません。", file=sys.stderr)

    merged = {}       # video_id -> record
    per_file = []
    for src in sources:
        videos, diag, _ok = load_scraper_json(src["path"])
        source_file = src["path"].name
        kept = 0
        for idx, v in enumerate(videos, start=1):
            vid = str(v.get("id") or "")
            if not vid:
                continue
            rec = to_record(v, idx, src["label"], source_file, src["role"])
            if not rec["caption"] or not rec["video_url"]:
                # 必須2項目（キャプション・動画URL）が欠けるものは落とす
                continue
            if vid in merged:
                # 複数の検索軸に同じ動画が出る場合は出現を統合し、軸別の順位を保持する
                merged[vid]["source_appearances"].extend(rec["source_appearances"])
            else:
                merged[vid] = rec
            kept += 1
        per_file.append({
            "path": str(src["path"]), "source_file": source_file,
            "role": src["role"], "label": src["label"],
            "raw": len(videos), "kept": kept,
            "diag": diag,
        })
        print(f"  {src['role']:15s} {src['label']:20s} {kept:>4}/{len(videos):<4} 件  ({source_file})",
              file=sys.stderr)

    records = list(merged.values())
    if not records:
        fail("有効なレコードが0件でした。")

    out_jsonl = run_dir / "normalized" / "videos.jsonl"
    with out_jsonl.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    variants = [x.strip() for x in args.keyword_variants.split(",") if x.strip()]
    cfg = {
        "keyword": args.keyword,
        "keyword_variants": variants,
        "brand": args.brand,
        # 分析スクリプトはすべて cfg["product"] を読む。ここを product_name だけに
        # していたため --product が誰にも読まれていなかった。
        "product": args.product,
        # 旧 run-dir 互換のミラー（読み手なし）。product_name は本来
        # 「レコード単位の推定商品名」を指す別概念なので将来削除する。
        "product_name": args.product,
        "official_site_url": args.official_site,
        # 既存スクリプト互換キー。同じ値を入れる。
        "official_url": args.official_site,
        "official_tiktok_account": args.official_tiktok,
        "request": {"original_request": args.original_request},
        "campaign_start": args.campaign_start,
        "measurement_period": args.period,
        # build_deck.py が module 5-4（施策前後比較）の可否をここで判定する。
        # 実体が無いのに真を書くと「比較したフリ」になるので、存在するパスだけを通す。
        "baseline": baseline_ref,
        "files": [
            {"path": p["path"], "role": p["role"], "label": p["label"], "source_file": p["source_file"]}
            for p in per_file
        ],
        # Excel を経由していないことを記録に残す（順位の定義が営業Excelと異なる）。
        "dataset_provenance": {
            "method": "scraper-direct",
            # 並び順の出所。search_display_order 以外が混ざると順位の章は使えない。
            "order_basis": sorted(set(order_bases)) or ["unknown"],
            "note": "search.mjs の検索表示順をそのまま順位として使用。非ログイン状態のスナップショット。"
                    "営業がログイン状態でエクスポートした Excel とは条件が異なるため、施策前後の比較では方式を混ぜないこと。",
            "built_at": datetime.now(JST).isoformat(),
        },
    }
    (run_dir / "confirmed_config.json").write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = {
        "ok": True,
        "run_dir": str(run_dir),
        "videos": len(records),
        "sources": per_file,
        "photo_posts": sum(1 for r in records if r["media_type"] == "photo"),
        "multi_axis_videos": sum(1 for r in records if len(r["source_appearances"]) > 1),
        "pr_tagged": sum(1 for r in records if r["pr_status_prelim"] == "pr"),
        "platform_ad_flagged": sum(1 for r in records if r["is_ad_platform_flag"]),
        "outputs": {
            "videos_jsonl": str(out_jsonl),
            "confirmed_config": str(run_dir / "confirmed_config.json"),
        },
        "next": "extract_signals.py → import_agent_telop.py → measure_keywords.py",
    }
    (run_dir / "normalized" / "dataset_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
