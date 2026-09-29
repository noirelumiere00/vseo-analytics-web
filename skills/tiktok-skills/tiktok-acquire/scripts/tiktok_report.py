#!/usr/bin/env python3
"""TikTok 検索面レポート生成。

search.mjs (Puppeteer + 内部API傍受) を呼び、検索表示順のデータを取得して
定型フォーマット(Markdown) + CSV + 生JSON を出力する。

使い方:
    python3 tiktok_report.py "メガ割"
    python3 tiktok_report.py "メガ割" "日焼け止め" --max 30
    python3 tiktok_report.py "メガ割" --max all          # 上限なし（数分かかる）
    python3 tiktok_report.py "メガ割" --out ~/Documents/Claude/Artifacts/tiktok-search
    （Windows は `py -3 tiktok_report.py ...` または `python tiktok_report.py ...`）

終了コード: すべてのキーワードで取得できたら 0 / 1つでも取得失敗があれば 1。
取得失敗したキーワードは出力ファイルを作らず、最後に一覧を出す（0件として集計しないため）。
"""
from __future__ import annotations  # `dict | None` 等の注釈を 3.9 でも評価しない

import argparse, csv, json, os, re, statistics, subprocess, sys, tempfile, time, unicodedata
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

# 待っても・やり直しても結果が変わらない失敗。4回 × 8秒やり直してから
# 『0件で返却 (diag={})』とだけ出していたため、原因（Chrome が無い、CDN に拒否された等）が
# 見えないまま時間だけ使っていた。これらは即座に止め、以降のキーワードも実行しない。
FATAL_CODES = {"TIKTOK_CDN_DENIED"}
ENV_ERROR_PATTERNS = ("Chrome/Chromium が見つかりません", "Cannot find package",
                      "ERR_MODULE_NOT_FOUND")

# 取得元の API。以前はハッシュタグ検索でも、keyword にフォールバックした場合でも
# 常に `/api/search/general/full/` と書いていた。
SOURCE_API = {
    "keyword": "TikTok 検索ページ内部API `/api/search/general/`",
    "hashtag": "TikTok タグページ内部API `/api/challenge/item_list/`（`/tag/<名前>`）",
}


class SearchFailed(Exception):
    """検索の取得失敗。fatal=True は同じ原因で後続のキーワードも失敗するもの。"""

    def __init__(self, msg, fatal=False):
        super().__init__(msg)
        self.fatal = fatal


def parse_max(s):
    """--max は正の整数か all（search.mjs と同じく all / max / 0 は上限なし）。"""
    raw = str(s).strip().lower()
    if raw in ("all", "max", "0"):
        return "all"
    try:
        n = int(raw)
    except ValueError:
        raise argparse.ArgumentTypeError("--max は正の整数か all を指定してください")
    if n < 0:
        raise argparse.ArgumentTypeError("--max は正の整数か all を指定してください")
    return n


def fetch(keyword: str, max_videos, search_type: str) -> dict:
    """search.mjs の結果オブジェクトを丸ごと返す（ok / type / diag / order_basis を捨てない）。"""
    if not os.path.exists(SCRAPER):
        raise SearchFailed(f"スクレイパが見つかりません: {SCRAPER}", fatal=True)
    # NOTE: stdout パイプ経由は取りこぼしうるので --out のファイルを正とする
    fd, tmp = tempfile.mkstemp(suffix=".json", prefix="tiktok_")
    os.close(fd)
    try:
        # 検索は「窓」で失敗することがあり、同じ条件でも 0 件で返る回がある
        # （実測: --max 500 で 0件 → 直後の再実行で 151件）。
        # 0 件を「該当なし」と誤読しないよう、空振りは既定 4 回まで再試行する。
        data = None
        last_err = ""
        for attempt in range(1, SEARCH_RETRIES + 1):
            open(tmp, "w").close()  # 前回の結果を今回のものと誤読しない
            try:
                # encoding を明示する。省略すると Windows（日本語ロケール）では cp932 で
                # 解読され、search.mjs の UTF-8 出力（日本語の本文・ログ）で UnicodeDecodeError になる。
                proc = subprocess.run(
                    ["node", SCRAPER, "--query", keyword, "--type", search_type,
                     "--max", str(max_videos), "--out", tmp],
                    capture_output=True, text=True, encoding="utf-8", errors="replace",
                )
            except FileNotFoundError:
                raise SearchFailed("node が見つかりません（Node.js 20 以上を入れて PATH を通す）", fatal=True)
            with open(tmp, encoding="utf-8", errors="replace") as f:
                raw = f.read()
            raw = raw or proc.stdout or ""
            try:
                candidate = json.loads(raw)
            except json.JSONDecodeError as e:
                stderr_tail = (proc.stderr or "").strip()[-300:]
                last_err = f"JSON parse 失敗 ({e}): {raw[:200]} / stderr: {stderr_tail}"
                candidate = None
                if any(p in (proc.stderr or "") for p in ENV_ERROR_PATTERNS):
                    raise SearchFailed(f"実行環境の問題で検索できません: {stderr_tail}\n"
                                       "  scripts/ で `npm install` を実行したか確認してください", fatal=True)
            if candidate and candidate.get("ok") and candidate.get("count"):
                data = candidate
                if attempt > 1:
                    print(f"  （{attempt} 回目で取得成功）", file=sys.stderr)
                break
            if candidate is not None:
                diag = candidate.get("diag") or {}
                code = candidate.get("errorCode")
                err = candidate.get("error") or "0件で返却"
                # SKILL.md は「0件なら errorCode を見る」と指示している。捨てずに必ず出す。
                head = err if code and err.startswith(code) else f"{code or 'errorCode なし'}: {err}"
                last_err = f"{head} (diag={diag})"
                if diag.get("captchaDetected"):
                    # CAPTCHA は回避しない。止めて人に委ねる。
                    raise SearchFailed(
                        f"CAPTCHA を検知しました（{code}）。時間をおくか、--headful で目視確認してください。",
                        fatal=True)
                if code in FATAL_CODES:
                    raise SearchFailed(f"{last_err}\n  待っても解けない失敗のため再試行しません。", fatal=True)
                if any(p in err for p in ENV_ERROR_PATTERNS):
                    raise SearchFailed(f"実行環境の問題で検索できません: {err}", fatal=True)
            if attempt < SEARCH_RETRIES:
                print(f"  空振り {attempt}/{SEARCH_RETRIES} → 再試行 ({last_err[:160]})", file=sys.stderr)
                time.sleep(SEARCH_RETRY_WAIT)
        if data is None:
            raise SearchFailed(
                f"'{keyword}' の検索が {SEARCH_RETRIES} 回とも空振りしました: {last_err}\n"
                "  これは『該当なし』ではなく『取得失敗』です。0件として集計しないでください。"
            )
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return data


# ---- #PR タグ判定 ----
# tiktok-analyze の common.has_pr_tag と同じ規則（NFKC・小文字化した後に 'pr' と完全一致）。
# '#brand_pr' や '#PRチーム' は開示タグではないので数えない。
_TAG_IN_TEXT = re.compile(r"[#＃]([\w一-龠ぁ-んァ-ヶー]+)")


def _norm_tag(t) -> str:
    return unicodedata.normalize("NFKC", str(t)).strip().lstrip("#＃").strip().lower()


def has_pr_tag(hashtags, caption: str) -> bool:
    cands = list(hashtags or []) + _TAG_IN_TEXT.findall(caption or "")
    return any(_norm_tag(c) == "pr" for c in cands)


def enrich(v: dict, now: datetime) -> dict:
    st = v.get("stats") or {}
    au = v.get("author") or {}
    # search.mjs は後方互換で欠けた数値も 0 で出し、欠けた項目を missingFields に列挙する。
    # missingFields を持たない古い出力は従来どおりの扱いにする。
    has_missing_info = "missingFields" in v
    missing = set(v.get("missingFields") or [])
    play = st.get("playCount") or 0
    ct = v.get("createTime") or 0
    posted = datetime.fromtimestamp(int(ct), JST) if ct else None
    eng = sum(st.get(k) or 0 for k in ("diggCount", "commentCount", "shareCount", "collectCount"))
    media = v.get("mediaType") or "video"
    desc_raw = v.get("desc") or ""
    tags = v.get("hashtags") or []
    # followerCount は取れなかったとき null（未取得）。0 は TikTok が 0 と返したときだけ。
    # missingFields を持たない古い出力では 0 が「未取得の穴埋め」だったので、0 も未取得として扱う。
    fc = au.get("followerCount")
    fc_num = isinstance(fc, (int, float)) and not isinstance(fc, bool)
    follower_known = fc_num and (fc > 0 or has_missing_info)
    follower = fc if fc_num else 0
    is_ad = v.get("isAd")  # True / False / None(未取得)
    pr_tag = has_pr_tag(tags, desc_raw)
    return {
        "uniqueId": au.get("uniqueId", ""),
        "nickname": au.get("nickname", ""),
        "follower": follower,
        "follower_known": follower_known,
        "verified": au.get("verified", False),
        "play": play,
        "play_known": "stats.playCount" not in missing,
        "digg": st.get("diggCount") or 0,
        "comment": st.get("commentCount") or 0,
        "share": st.get("shareCount") or 0,
        "collect": st.get("collectCount") or 0,
        # 再生 0（または未取得）の投稿の率は定義できない。0% として中央値に入れると
        # 保存率の中央値が大きく下がる（実測 0.218 → 0.077）ので None にして除外する。
        "save_rate": (st.get("collectCount") or 0) / play * 100 if play else None,
        "eng_rate": eng / play * 100 if play else None,
        "posted": posted,
        "days_ago": (now - posted).days if posted else None,
        "is_ad": is_ad,
        # PR は2つの別物: #PR タグ＝投稿者によるステマ規制上の開示、isAd＝配信側の有料広告フラグ。
        # 以前は isAd だけで『PR投稿』を数えており、#PR 付き3本がすべて isAd=false の実サンプルで
        # 『PR投稿 0/10件』と出ていた。
        "pr_tag": pr_tag,
        "pr_any": bool(pr_tag or is_ad is True),
        "duration": v.get("duration") or 0,
        # 写真投稿の duration は音源の長さで、投稿の尺ではない（build_dataset と同じ区別）
        "duration_source": "music_fallback" if media == "photo" else "video",
        "media": media,
        "lang": v.get("textLanguage", ""),
        "poi": (v.get("poi") or {}).get("name", ""),
        "hashtags": tags,
        "music": (v.get("music") or {}).get("title", ""),
        "desc": desc_raw.replace("\n", " ").strip(),
        "url": v.get("url", ""),
    }


def fmt_int(n) -> str:
    return f"{n:,}" if isinstance(n, (int, float)) else str(n)


def fmt_rate(x) -> str:
    return "-" if x is None else f"{x:.2f}%"


def pr_mark(r) -> str:
    if r["pr_tag"] and r["is_ad"] is True:
        return "#/AD"
    if r["pr_tag"]:
        return "#"
    if r["is_ad"] is True:
        return "AD"
    return ""


def build_report(keyword: str, rows: list[dict], now: datetime, max_videos,
                 meta: dict | None = None, search_type: str = "keyword") -> str:
    meta = meta or {}
    diag = meta.get("diag") or {}
    n = len(rows)
    actual_type = meta.get("type") or search_type
    fallback = "fallback" in str(actual_type)

    L = []
    L.append(f"# TikTok検索面レポート — 「{keyword}」")
    L.append("")
    L.append(f"- 取得日時: {now.strftime('%Y-%m-%d %H:%M')} JST")
    L.append(f"- 取得件数: {n} 件（指定 {max_videos}）")
    if fallback:
        L.append(f"- **注意: ハッシュタグ検索（`/tag/`）が0件だったため、キーワード検索に自動で切り替えた結果です**"
                 f"（リクエスト: {search_type} / 実際: {actual_type}）。ハッシュタグ面のデータではありません")
        src = SOURCE_API["keyword"]
    else:
        src = SOURCE_API.get(str(actual_type), SOURCE_API["keyword"])
    L.append(f"- 取得元: {src}（実ブラウザ傍受）")
    ob = meta.get("order_basis")
    if ob and ob != "search_display_order":
        L.append(f"- **並び順: {ob}**（{meta.get('order_basis_note') or ''}）。検索表示順ではない")
    else:
        L.append("- 並び順: TikTok の検索結果に出てきた順そのもの（再生数順ではない）")
    # SKILL.md が「必ず添える」とする注記
    L.append("- 注記: 並びは TikTok の検索アルゴリズム順。表示順はログイン状態・地域・時刻で変わるため、"
             "取得時点のスナップショットとして扱う")
    if diag.get("partial"):
        L.append(f"- **注意: 取得が途中で中断された部分結果です**（{diag.get('partialError')}）。"
                 "表示順の先頭としては正しいが、網羅ではない")
    L.append("")
    if n == 0:
        L.append("取得0件。")
        return "\n".join(L) + "\n"

    play_rows = [r for r in rows if r["play_known"]]
    plays = [r["play"] for r in play_rows]
    saves = [r["save_rate"] for r in rows if r["save_rate"] is not None]
    engs = [r["eng_rate"] for r in rows if r["eng_rate"] is not None]
    no_rate = n - len(saves)
    pr_any = sum(1 for r in rows if r["pr_any"])
    pr_tag = sum(1 for r in rows if r["pr_tag"])
    ads = sum(1 for r in rows if r["is_ad"] is True)
    ad_unknown = sum(1 for r in rows if r["is_ad"] is None)
    fresh7 = sum(1 for r in rows if r["days_ago"] is not None and r["days_ago"] <= 7)
    small = [r for r in rows if r["follower_known"] and r["follower"] < 10000]
    follower_unknown = sum(1 for r in rows if not r["follower_known"])
    authors = Counter(r["uniqueId"] for r in rows)
    multi = {k: v for k, v in authors.items() if v > 1}
    tags = Counter(t for r in rows for t in r["hashtags"])
    # 年を捨てて '%m/%d' で数えると、年をまたぐ検索面で時系列が逆転し、
    # 別の年の同じ日付が1本に合算されていた。ISO 日付で数える（文字列順＝時系列順）。
    days = Counter(r["posted"].strftime("%Y-%m-%d") for r in rows if r["posted"])

    L.append("## サマリー")
    L.append("")
    L.append("| 指標 | 値 |")
    L.append("|---|---|")
    if plays:
        L.append(f"| 再生 中央値 | {fmt_int(int(statistics.median(plays)))} |")
        L.append(f"| 再生 最大 / 最小 | {fmt_int(max(plays))} / {fmt_int(min(plays))} |")
    else:
        L.append("| 再生 中央値 | -（再生数を取得できた投稿なし） |")
    L.append(f"| 保存率 中央値 | {fmt_rate(statistics.median(saves)) if saves else '-'} |")
    L.append(f"| ENG率 中央値 | {fmt_rate(statistics.median(engs)) if engs else '-'} |")
    L.append(f"| PR投稿（#PRタグ または 広告フラグ） | {pr_any} / {n} 件 |")
    L.append(f"| 　うち #PRタグ（投稿者の開示） | {pr_tag} 件 |")
    L.append(f"| 　うち 広告フラグ isAd（配信側の有料広告） | {ads} 件"
             + (f"（未取得 {ad_unknown} 件）" if ad_unknown else "") + " |")
    L.append(f"| 直近7日以内の投稿 | {fresh7} / {n} 件 |")
    # フォロワー数が取れなかった投稿は 1万未満にも以上にも数えない（別に出す）
    L.append(f"| フォロワー1万未満の入賞 | {len(small)} / {n} 件"
             + (f"（フォロワー未取得 {follower_unknown} 件は除外）" if follower_unknown else "") + " |")
    L.append(f"| 複数枠を取ったアカウント | {len(multi)} 者 |")
    L.append("")
    L.append("- PR は `#PR` タグ（正規化後の完全一致）と TikTok の広告フラグ `isAd` のどちらか。"
             "`isAd` は配信側のフラグで、#PR 付きのタイアップ投稿でも false になる。"
             "PR表記なし＝オーガニックとは限らない")
    if no_rate:
        L.append(f"- 再生数が 0 または未取得の {no_rate} 件は、保存率・ENG率の中央値から除外した（率が定義できないため）")
    L.append("")
    L.append("## 検索表示順")
    L.append("")
    L.append("| 順位 | アカウント | フォロワー | 再生 | いいね | 保存 | 保存率 | ENG率 | 投稿日 | 経過 | PR | 尺 | 形式 | 本文 |")
    L.append("|---:|---|---:|---:|---:|---:|---:|---:|---|---:|:-:|---:|:-:|---|")
    for i, r in enumerate(rows, 1):
        dur = f"♪{r['duration']}s" if r["media"] == "photo" else f"{r['duration']}s"
        L.append(
            f"| {i} | @{r['uniqueId']}{' ✓' if r['verified'] else ''} "
            f"| {fmt_int(r['follower']) if r['follower_known'] else '-'} "
            f"| {fmt_int(r['play']) if r['play_known'] else '-'} | {fmt_int(r['digg'])} | {fmt_int(r['collect'])} "
            f"| {fmt_rate(r['save_rate'])} | {fmt_rate(r['eng_rate'])} "
            f"| {r['posted'].strftime('%y/%m/%d') if r['posted'] else '-'} "
            f"| {r['days_ago'] if r['days_ago'] is not None else '-'}日 "
            f"| {pr_mark(r)} | {dur} | {'画' if r['media']=='photo' else '動'} "
            f"| {r['desc'][:34]} |"
        )
    L.append("")
    L.append("- PR列: `#`＝#PRタグ / `AD`＝広告フラグ isAd / `#/AD`＝両方。"
             "尺列の `♪` は写真投稿の音源の長さ（投稿の尺ではない）")
    L.append("")
    L.append("## 検索面の構造")
    L.append("")
    L.append("**投稿日の分布**")
    L.append("")
    L.append("```")
    for d, c in sorted(days.items()):
        L.append(f"{d[2:].replace('-', '/')}: {'■'*c} {c}")
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
            L.append(f"- {i}位 @{r['uniqueId']}（フォロワー {fmt_int(r['follower'])} / 再生 {fmt_int(r['play'])} / 保存率 {fmt_rate(r['save_rate'])}）")
        L.append("")
    tops = sorted([r for r in rows if r["save_rate"] is not None], key=lambda r: -r["save_rate"])[:3]
    L.append("**保存率TOP3（＝購買検討に効いた投稿）**")
    L.append("")
    for r in tops:
        i = rows.index(r) + 1
        L.append(f"- {fmt_rate(r['save_rate'])} — {i}位 @{r['uniqueId']}「{r['desc'][:30]}」")
    L.append("")
    return "\n".join(L)


def write_csv(path: str, rows: list[dict]) -> None:
    # 列は後方互換のため既存の順を変えず、追加分（pr_tag 以降）を末尾に足す
    cols = ["rank", "uniqueId", "nickname", "follower", "verified", "play", "digg", "comment",
            "share", "collect", "save_rate", "eng_rate", "posted", "days_ago", "is_ad",
            "duration", "media", "lang", "poi", "music", "hashtags", "desc", "url",
            "pr_tag", "pr_any", "duration_source"]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for i, r in enumerate(rows, 1):
            d = dict(r)
            d["rank"] = i
            d["posted"] = r["posted"].strftime("%Y-%m-%d %H:%M") if r["posted"] else ""
            d["hashtags"] = " ".join("#" + t for t in r["hashtags"])
            # 率が定義できない（再生 0 / 未取得）ときは空欄。0.000 と書くと「保存率0%」に読める
            d["save_rate"] = "" if r["save_rate"] is None else f"{r['save_rate']:.3f}"
            d["eng_rate"] = "" if r["eng_rate"] is None else f"{r['eng_rate']:.3f}"
            d["is_ad"] = "" if r["is_ad"] is None else r["is_ad"]  # 空欄＝未取得
            d["follower"] = r["follower"] if r["follower_known"] else ""  # 空欄＝未取得
            w.writerow({k: d.get(k, "") for k in cols})


_WIN_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                 *(f"LPT{i}" for i in range(1, 10))}


def safe_name(kw: str) -> str:
    """キーワード → ファイル名。Windows で使えない文字（\\ / : * ? " < > |）と空白（全角含む）を _ にする。
    以前は / と半角スペースだけを置き換えており、『何買う?』等で Windows の open() が落ちた。"""
    s = re.sub(r'[\\/:*?"<>|\s\x00-\x1f]+', "_", kw).strip("._ ")
    if not s:
        s = "keyword"
    if s.split(".")[0].upper() in _WIN_RESERVED:
        s = "_" + s
    return s


def main() -> None:
    # Windows（日本語ロケール）ではパイプ先の stdout が cp932 になり、見出しの『—』や
    # 認証バッジの『✓』、本文の絵文字で UnicodeEncodeError になって落ちていた。
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    ap = argparse.ArgumentParser()
    ap.add_argument("keywords", nargs="+")
    ap.add_argument("--max", type=parse_max, default=30,
                    help="取得件数。正の整数か all（上限なし。数分かかる）")
    ap.add_argument("--type", default="keyword", choices=["keyword", "hashtag"])
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args()

    now = datetime.now(JST)
    outdir = os.path.join(os.path.expanduser(a.out), now.strftime("%Y-%m-%d"))
    os.makedirs(outdir, exist_ok=True)

    failures = []
    for idx, kw in enumerate(a.keywords):
        print(f"[取得中] {kw} ...", file=sys.stderr)
        try:
            data = fetch(kw, a.max, a.type)
        except SearchFailed as e:
            # 1つ失敗しても残りのキーワードは続ける（以前は sys.exit で全体が止まっていた）。
            # ただし CAPTCHA / CDN 拒否 / 実行環境の問題は後続も同じ原因で失敗するので止める。
            failures.append((kw, str(e)))
            print(f"[取得失敗] {kw}: {e}", file=sys.stderr)
            if e.fatal:
                for rest in a.keywords[idx + 1:]:
                    failures.append((rest, "未実行（前のキーワードの失敗が回線・環境側の原因のため中止）"))
                break
            continue
        raw = data.get("videos") or []
        rows = [enrich(v, now) for v in raw]
        base = os.path.join(outdir, safe_name(kw))
        # 生JSONは search.mjs の結果オブジェクトを丸ごと保存する。以前は videos 配列だけを
        # 保存しており、ok / type（フォールバック）/ diag / order_basis が失われ、
        # build_dataset.py に渡すと AttributeError で落ちていた。
        with open(base + ".json", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        write_csv(base + ".csv", rows)
        md = build_report(kw, rows, now, a.max, data, a.type)
        with open(base + ".md", "w", encoding="utf-8") as f:
            f.write(md + f"\n## 生データ\n\n- Markdown: `{base}.md`\n- CSV: `{base}.csv`\n- 生JSON: `{base}.json`\n")
        print(md)
        print(f"\n保存先: {base}.{{md,csv,json}}\n", file=sys.stderr)

    if failures:
        print("\n[取得失敗のキーワード] 以下は『該当なし』ではなく『取得失敗』。0件として集計しないこと:",
              file=sys.stderr)
        for kw, msg in failures:
            print(f"  - {kw}: {msg.splitlines()[0]}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
