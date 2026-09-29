#!/usr/bin/env python3
"""TikTok 検索面レポート生成。

search.mjs (Puppeteer + 内部API傍受) を呼び、検索表示順のデータを取得して
定型フォーマット(Markdown) + CSV + 生JSON を出力する。

使い方:
    python3 tiktok_report.py "メガ割"
    python3 tiktok_report.py "メガ割" "日焼け止め" --max 30
    python3 tiktok_report.py "メガ割" --out ~/Documents/Claude/Artifacts/tiktok-search
"""
import argparse, csv, json, os, statistics, subprocess, sys, time
from pathlib import Path
from collections import Counter
from datetime import datetime, timezone, timedelta

JST = timezone(timedelta(hours=9))
# 既定は同梱の search.mjs。別の場所に置くなら TIKTOK_SCRAPER で上書きする。
SCRAPER = os.environ.get(
    "TIKTOK_SCRAPER",
    str(Path(__file__).resolve().parent / "search.mjs"),
)
SEARCH_RETRIES = 4      # 検索の空振り再試行回数
SEARCH_RETRY_WAIT = 8   # 再試行の待機秒。実測で長く待つほど良くはならない
DEFAULT_OUT = os.path.expanduser("~/Documents/Claude/Artifacts/tiktok-search")


def fetch(keyword: str, max_videos: int, search_type: str) -> list[dict]:
    if not os.path.exists(SCRAPER):
        sys.exit(f"スクレイパが見つかりません: {SCRAPER}")
    # NOTE: stdout パイプ経由は取りこぼしうるので --out のファイルを正とする
    import tempfile
    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="tiktok_")
    os.close(fd)
    try:
        # 検索は「窓」で失敗することがあり、同じ条件でも 0 件で返る回がある
        # （実測: --max 500 で 0件 → 直後の再実行で 151件）。
        # 0 件を「該当なし」と誤読しないよう、空振りは既定 4 回まで再試行する。
        data = None
        last_err = ""
        for attempt in range(1, SEARCH_RETRIES + 1):
            proc = subprocess.run(
                ["node", SCRAPER, "--query", keyword, "--type", search_type,
                 "--max", str(max_videos), "--out", tmp],
                capture_output=True, text=True,
            )
            raw = open(tmp, encoding="utf-8").read() if os.path.getsize(tmp) else proc.stdout
            try:
                candidate = json.loads(raw)
            except json.JSONDecodeError as e:
                last_err = f"JSON parse 失敗 ({e}): {raw[:200]}"
                candidate = None
            if candidate and candidate.get("ok") and candidate.get("count"):
                data = candidate
                if attempt > 1:
                    print(f"  （{attempt} 回目で取得成功）", file=sys.stderr)
                break
            if candidate is not None:
                diag = candidate.get("diag") or {}
                if diag.get("captchaDetected"):
                    # CAPTCHA は回避しない。止めて人に委ねる。
                    sys.exit("CAPTCHA を検知しました。時間をおくか、--headful で目視確認してください。")
                last_err = f"0件で返却 (diag={diag})"
            if attempt < SEARCH_RETRIES:
                print(f"  空振り {attempt}/{SEARCH_RETRIES} → 再試行 ({last_err[:80]})", file=sys.stderr)
                time.sleep(SEARCH_RETRY_WAIT)
        if data is None:
            sys.exit(
                f"'{keyword}' の検索が {SEARCH_RETRIES} 回とも空振りしました: {last_err}\n"
                "  これは『該当なし』ではなく『取得失敗』です。0件として集計しないでください。"
            )
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    if not data.get("ok"):
        sys.exit(f"取得エラー: {data.get('error')}")
    return data.get("videos", [])


def enrich(v: dict, now: datetime) -> dict:
    st = v.get("stats") or {}
    au = v.get("author") or {}
    play = st.get("playCount") or 0
    ct = v.get("createTime") or 0
    posted = datetime.fromtimestamp(int(ct), JST) if ct else None
    eng = sum(st.get(k) or 0 for k in ("diggCount", "commentCount", "shareCount", "collectCount"))
    return {
        "uniqueId": au.get("uniqueId", ""),
        "nickname": au.get("nickname", ""),
        "follower": au.get("followerCount") or 0,
        "verified": au.get("verified", False),
        "play": play,
        "digg": st.get("diggCount") or 0,
        "comment": st.get("commentCount") or 0,
        "share": st.get("shareCount") or 0,
        "collect": st.get("collectCount") or 0,
        "save_rate": (st.get("collectCount") or 0) / play * 100 if play else 0.0,
        "eng_rate": eng / play * 100 if play else 0.0,
        "posted": posted,
        "days_ago": (now - posted).days if posted else None,
        "is_ad": v.get("isAd", False),
        "duration": v.get("duration") or 0,
        "media": v.get("mediaType", "video"),
        "lang": v.get("textLanguage", ""),
        "poi": (v.get("poi") or {}).get("name", ""),
        "hashtags": v.get("hashtags") or [],
        "music": (v.get("music") or {}).get("title", ""),
        "desc": (v.get("desc") or "").replace("\n", " ").strip(),
        "url": v.get("url", ""),
    }


def fmt_int(n) -> str:
    return f"{n:,}" if isinstance(n, (int, float)) else str(n)


def build_report(keyword: str, rows: list[dict], now: datetime, max_videos: int) -> str:
    n = len(rows)
    if n == 0:
        return f"# TikTok検索面レポート — 「{keyword}」\n\n取得0件。\n"
    plays = [r["play"] for r in rows]
    saves = [r["save_rate"] for r in rows]
    engs = [r["eng_rate"] for r in rows]
    ads = sum(1 for r in rows if r["is_ad"])
    fresh7 = sum(1 for r in rows if r["days_ago"] is not None and r["days_ago"] <= 7)
    small = [r for r in rows if r["follower"] and r["follower"] < 10000]
    authors = Counter(r["uniqueId"] for r in rows)
    multi = {k: v for k, v in authors.items() if v > 1}
    tags = Counter(t for r in rows for t in r["hashtags"])
    days = Counter(r["posted"].strftime("%m/%d") for r in rows if r["posted"])

    L = []
    L.append(f"# TikTok検索面レポート — 「{keyword}」")
    L.append("")
    L.append(f"- 取得日時: {now.strftime('%Y-%m-%d %H:%M')} JST")
    L.append(f"- 取得件数: {n} 件（指定 {max_videos}）")
    L.append("- 取得元: TikTok 検索ページ内部API `/api/search/general/full/`（実ブラウザ傍受・検索表示順そのまま）")
    L.append("")
    L.append("## サマリー")
    L.append("")
    L.append("| 指標 | 値 |")
    L.append("|---|---|")
    L.append(f"| 再生 中央値 | {fmt_int(int(statistics.median(plays)))} |")
    L.append(f"| 再生 最大 / 最小 | {fmt_int(max(plays))} / {fmt_int(min(plays))} |")
    L.append(f"| 保存率 中央値 | {statistics.median(saves):.2f}% |")
    L.append(f"| ENG率 中央値 | {statistics.median(engs):.2f}% |")
    L.append(f"| PR投稿(isAd) | {ads} / {n} 件 |")
    L.append(f"| 直近7日以内の投稿 | {fresh7} / {n} 件 |")
    L.append(f"| フォロワー1万未満の入賞 | {len(small)} / {n} 件 |")
    L.append(f"| 複数枠を取ったアカウント | {len(multi)} 者 |")
    L.append("")
    L.append("## 検索表示順")
    L.append("")
    L.append("| 順位 | アカウント | フォロワー | 再生 | いいね | 保存 | 保存率 | ENG率 | 投稿日 | 経過 | PR | 尺 | 形式 | 本文 |")
    L.append("|---:|---|---:|---:|---:|---:|---:|---:|---|---:|:-:|---:|:-:|---|")
    for i, r in enumerate(rows, 1):
        L.append(
            f"| {i} | @{r['uniqueId']}{' ✓' if r['verified'] else ''} | {fmt_int(r['follower'])} "
            f"| {fmt_int(r['play'])} | {fmt_int(r['digg'])} | {fmt_int(r['collect'])} "
            f"| {r['save_rate']:.2f}% | {r['eng_rate']:.2f}% "
            f"| {r['posted'].strftime('%y/%m/%d') if r['posted'] else '-'} "
            f"| {r['days_ago'] if r['days_ago'] is not None else '-'}日 "
            f"| {'●' if r['is_ad'] else ''} | {r['duration']}s | {'画' if r['media']=='photo' else '動'} "
            f"| {r['desc'][:34]} |"
        )
    L.append("")
    L.append("## 検索面の構造")
    L.append("")
    L.append("**投稿日の分布**")
    L.append("")
    L.append("```")
    for d, c in sorted(days.items()):
        L.append(f"{d}: {'■'*c} {c}")
    L.append("```")
    L.append("")
    L.append("**ハッシュタグ TOP10**")
    L.append("")
    L.append("| タグ | 本数 |")
    L.append("|---|---:|")
    for t, c in tags.most_common(10):
        L.append(f"| #{t} | {c} |")
    L.append("")
    if multi:
        L.append("**複数枠を取ったアカウント**")
        L.append("")
        for k, c in sorted(multi.items(), key=lambda x: -x[1]):
            pos = [str(i) for i, r in enumerate(rows, 1) if r["uniqueId"] == k]
            L.append(f"- @{k} — **{c}枠**（{'位, '.join(pos)}位）")
        L.append("")
    if small:
        L.append("**フォロワー1万未満で入賞（＝新規参入余地の指標）**")
        L.append("")
        for r in small[:10]:
            i = rows.index(r) + 1
            L.append(f"- {i}位 @{r['uniqueId']}（フォロワー {fmt_int(r['follower'])} / 再生 {fmt_int(r['play'])} / 保存率 {r['save_rate']:.2f}%）")
        L.append("")
    tops = sorted(rows, key=lambda r: -r["save_rate"])[:3]
    L.append("**保存率TOP3（＝購買検討に効いた投稿）**")
    L.append("")
    for r in tops:
        i = rows.index(r) + 1
        L.append(f"- {r['save_rate']:.2f}% — {i}位 @{r['uniqueId']}「{r['desc'][:30]}」")
    L.append("")
    return "\n".join(L)


def write_csv(path: str, rows: list[dict]) -> None:
    cols = ["rank", "uniqueId", "nickname", "follower", "verified", "play", "digg", "comment",
            "share", "collect", "save_rate", "eng_rate", "posted", "days_ago", "is_ad",
            "duration", "media", "lang", "poi", "music", "hashtags", "desc", "url"]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for i, r in enumerate(rows, 1):
            d = dict(r)
            d["rank"] = i
            d["posted"] = r["posted"].strftime("%Y-%m-%d %H:%M") if r["posted"] else ""
            d["hashtags"] = " ".join("#" + t for t in r["hashtags"])
            d["save_rate"] = f"{r['save_rate']:.3f}"
            d["eng_rate"] = f"{r['eng_rate']:.3f}"
            w.writerow({k: d.get(k, "") for k in cols})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("keywords", nargs="+")
    ap.add_argument("--max", type=int, default=30)
    ap.add_argument("--type", default="keyword", choices=["keyword", "hashtag"])
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args()

    now = datetime.now(JST)
    outdir = os.path.join(os.path.expanduser(a.out), now.strftime("%Y-%m-%d"))
    os.makedirs(outdir, exist_ok=True)

    for kw in a.keywords:
        print(f"[取得中] {kw} ...", file=sys.stderr)
        raw = fetch(kw, a.max, a.type)
        rows = [enrich(v, now) for v in raw]
        safe = kw.replace("/", "_").replace(" ", "_")
        base = os.path.join(outdir, safe)
        with open(base + ".json", "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, indent=1)
        write_csv(base + ".csv", rows)
        md = build_report(kw, rows, now, a.max)
        with open(base + ".md", "w", encoding="utf-8") as f:
            f.write(md + f"\n## 生データ\n\n- Markdown: `{base}.md`\n- CSV: `{base}.csv`\n- 生JSON: `{base}.json`\n")
        print(md)
        print(f"\n保存先: {base}.{{md,csv,json}}\n", file=sys.stderr)


if __name__ == "__main__":
    main()
