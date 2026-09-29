#!/usr/bin/env python3
"""build_input_md.py — 取得JSON群から INPUT.md の機械欄を生成する（案件非依存）

案件固有の値はコードに書かない。すべて case.json から読む。
散文欄（insight・仮説など）はここでは書かず [DATA NOT PROVIDED] を残す。
後段で Claude が authored.md に書き、merge_authored.py で流し込む
（書けるキーは `python3 tools/merge_authored.py --list-keys`）。

規律:
  - 取得できていない欄は埋めない（推測しない）
  - 取得が失敗した軸（ok=false）は 0 件として扱わず、その場で止める
  - PR判定は isAd と #PRタグの2定義を必ず両方出す（定義で比率が変わる軸があるため）

使い方:
  python3 tools/build_input_md.py --case <案件ディレクトリ>
  python3 tools/build_input_md.py --case . --out INPUT_mechanical.md

case.json の形:
{
  "project": {"project_title": "...", "research_period": "...",
              "recipient": "... 御中", "producer": "...", "term_legend": "..."},
  "client":  {"client_name": "サンプルストア", "client_role": "自社（...）", "client_note": "..."},
  "settings": {"max_brands_per_comparison_slide": 3, "video_list_top_n": 4,
               "min_views_for_rate_rank": 1000},
  "brands":  [{"name": "サンプルストア", "file": "raw/brand_サンプルストア.json",
               "match": "サンプルストア|samplestore", "own": true}, ...],
  "keywords":[{"name": "100均", "file": "raw/kw_100均.json"}, ...],
  "acquisition": {"サンプルストア": "exhausted", "100均": "capped"}
}

動画の構成解剖（任意）は video_manifest.json（案件直下）で宣言する。形は SKILL.md の
「2. 動画とコマの抽出」を参照。数値（再生・保存率・EG）は raw から動画IDで引く。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics as st
import sys
from collections import Counter, defaultdict

# 日本語 Windows ではパイプ越しの標準出力が cp932 になり、「—」等で UnicodeEncodeError になる。
# 落ちると終了コード1になり、本物の停止と区別できない。表示できない字だけ置き換えて続ける
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

# PR の判定は初訪（tools/fvlib.py の pr_basis）と同じ規則を使う。別々に持っていたため、
# 同じ案件の初訪資料と二次提案資料で PR 本数が食い違い得た（こちらは #pr・#pr案件・#タイアップ・#広告 だけ、
# 初訪は #ad・#提供・#sponsored と本文の【PR】も数えていた）。fvlib は読むだけで変更しない
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fvlib import PR_TAGS as FV_PR_TAGS, pr_basis  # noqa: E402

ND = "[DATA NOT PROVIDED]"      # 取得できていない（＝穴。埋めるべきもの）
NONE_HERE = "0本（該当なし）"      # そこに実体が無い（＝穴ではない。欠損と混同させない）
TIERS = [("Nano", "ナノ", 0, 10_000), ("Micro", "マイクロ", 10_000, 100_000),
         ("Middle", "ミドル", 100_000, 1_000_000), ("Mega", "メガ", 1_000_000, 10 ** 12)]

# 本数のしきい値だけで「上限到達」と書くと事実と食い違う。
# 実際には TikTok 側が has_more=false を返して枯渇した軸もあり、
# それを「取得上限＝母数未確定」と書くのは不確実性の誇張になる（p21 で発生）。
# 以前は記録が無いときだけ本数（148件以上）で推測していたが、それも同じ誇張を
# 付録に「取得上限に到達」と事実として書いていた。記録が無ければ unknown とする。
# 軸ごとの実際の終わり方は case.json の acquisition[<軸名>] で与える
# （取得JSONが stop_reason を持っていればそれも使う）。
#   "exhausted" = 検索が has_more=false を返して打ち切った（＝下限値）
#   "capped"    = こちらの取得上限で止めた（＝母数未確定）
#   "unknown"   = ログが残っていない
ACQ_LABEL = {
    # ログの最終行そのものに対応させる。ここを取り違えると付録が嘘になる
    "exhausted": "検索が has_more=false を返して終了＝この検索で取れる全件（投稿総数の下限値）",
    "no_new": "同じ結果が返り続けたため打ち切り（TikTokは has_more=true を返し続けていた）"
              "＝これ以上は取得できなかったが、面の総数は不明",
    "capped": "取得上限に到達＝母数未確定",
    "unknown": "取得の終わり方が記録されていない＝母数未確定",
}



# 率での順位付けは分母が小さいと跳ねる。ある案件の「保存率1位」が
# 63再生・保存5本の 7.94% になり、110万再生の1.58%と並べて誤読を招いた。
# 下限は case.json の settings.min_views_for_rate_rank で決める（既定1000）。
def rate_pool(cfg, vs):
    """率で順位を付けてよい母集団と、除外した本数を返す"""
    # `or 1000` だと明示した 0（下限なし）まで 1000 に戻り、下限を外せなかった
    raw_lim = (cfg.get("settings") or {}).get("min_views_for_rate_rank")
    lim = 1000 if raw_lim is None else int(raw_lim)
    # 再生数が取れていない投稿は率を出せないので、下限に関係なく母集団から外す（0再生として数えない）
    has = [v for v in vs if plays(v)]
    pool = [v for v in has if plays(v) >= lim]
    return (pool or has), len(vs) - len(pool or has), lim



def is_photo(v):
    """写真カルーセルか。3値で返す: True / False / None（未取得）。

    None を False に潰すと「写真0本」という嘘の集計になる。
    Excel 入口など mediaType を取得できない経路があるため、必ず区別する。
    """
    mt = v.get("mediaType")
    if mt is None or mt == "":
        return None
    return mt == "photo"


def is_ad(v):
    """TikTokの広告フラグ。3値で返す: True / False / None（未取得）。
    None を False にすると「PR比率0%」という嘘が出る。"""
    a = v.get("isAd")
    return None if a is None else bool(a)



def pr_label(v):
    """PR表示。未取得を「なし」に潰さない。
    isAd が未取得でも #PRタグ が立っていれば「あり」と言える（タグは本文から確実に読める）"""
    if pr_tag(v):
        return "あり"
    a = is_ad(v)
    if a:
        return "あり"
    return "なし" if a is False else "未取得"


def media_label(v):
    """媒体表示。未取得を「動画」に潰さない"""
    p = is_photo(v)
    return "未取得" if p is None else ("写真" if p else "動画")


def pr_sets(vs):
    """(PR, オーガニック, 判定不可) に分ける。
    判定不可を org に混ぜると PR比率が過少に出る（「PR比率0%」の嘘の原因）"""
    pr, org, unknown = [], [], []
    for v in vs:
        if pr_tag(v) or is_ad(v):
            pr.append(v)
        elif is_ad(v) is None:
            unknown.append(v)
        else:
            org.append(v)
    return pr, org, unknown


def split3(vs, fn):
    """(該当, 非該当, 未取得) に分ける"""
    yes, no, unknown = [], [], []
    for v in vs:
        r = fn(v)
        (unknown if r is None else (yes if r else no)).append(v)
    return yes, no, unknown


def media_mix(cfg, vs):
    """写真カルーセルの比率と、保存率上位での濃度。両方出さないと
    『面全体では2割なのに上位では6割』という偏りが見えない"""
    vs = [v for v in vs if (v.get("stats") or {}).get("playCount")]
    if not vs:
        return ND
    ph, vd, unk = split3(vs, is_photo)
    if unk:
        # 未取得が混じったまま比率を出すと「写真0本」の嘘になる。比率を出さない
        return (f"媒体は{len(unk)}本が未取得のため比率を出していない"
                f"（判明分: 写真{len(ph)}本／動画{len(vd)}本／全{len(vs)}本）")
    # 「保存率上位」は他の箇所（Save Top・Q5）と同じ再生下限の母集団から取る。
    # 全件から取ると再生数十の投稿が上位に入り、同じ資料の「率の順位は再生◯以上に限定」と食い違う
    pool, _dropped, lim = rate_pool(cfg, vs)
    top = sorted(pool, key=lambda v: srate(v) or 0, reverse=True)[:10]
    tp = sum(1 for v in top if is_photo(v))
    out = (f"写真カルーセル {len(ph)}本（{len(ph) / len(vs) * 100:.1f}%）／"
           f"動画 {len(vd)}本。保存率上位{len(top)}本（再生{lim:,}以上）のうち写真は {tp}本")
    sp = [x for x in (srate(v) for v in ph) if x is not None]
    sv = [x for x in (srate(v) for v in vd) if x is not None]
    if sp and sv:
        out += (f"。保存率中央値は写真 {st.median(sp):.2f}%・"
                f"動画 {st.median(sv):.2f}%")
    return out



def norm_tags(v):
    """1動画のハッシュタグを、大小文字を畳んだ集合で返す。

    raw の `hashtags` は TikTok が正規化した challenge 名（常に小文字）と、
    投稿本文に書かれた表記の**和集合**になっている。そのため素で数えると
    #DAISO(16) が #daiso(32) の部分集合のまま別クラスタとして並び、
    集合とその部分集合を性能比較する表ができる（p9で実際に起きた）。
    TikTok 側は大小文字を同一 challenge に寄せているので、こちらも畳む。
    """
    return {str(t).lower() for t in (v.get("hashtags") or [])}


def tag_counts(vs):
    """(動画数の Counter, 表示用ラベル) を返す。ラベルは実データで最も多い表記"""
    cnt = Counter()
    surface = defaultdict(Counter)
    for v in vs:
        seen = set()
        for t in (v.get("hashtags") or []):
            k = str(t).lower()
            surface[k][str(t)] += 1
            if k in seen:
                continue
            seen.add(k)
            cnt[k] += 1
    label = {k: surface[k].most_common(1)[0][0] for k in cnt}
    return cnt, label


# 切り口（Q3）・文脈（Q4）として数えないタグ。
# ブランド判定（match）に当たるタグは定義上ほぼ全件に付くので、実データで
# 「#samplestore 40本（100%）」が内容タイプの1位に並び、横断ページの「最も反応が高い切り口」にまで出ていた。
# PR表記は切り口ではなく表示の有無、fyp・おすすめ は誰でも付ける汎用タグで、どれも「どう語られているか」を表さない
PR_TAGS = tuple(FV_PR_TAGS)   # fvlib と同じ集合（上の import を参照）
GENERIC_TAGS = {"fyp", "fypシ", "fypシ゚", "foryou", "foryoupage", "おすすめ", "おすすめにのりたい",
                "バズれ", "tiktok", "viral"}


def topic_tag_counts(vs, pat):
    """tag_counts から、ブランド名そのもののタグ・PR表記・汎用タグを除く。除いたタグも返す（黙って消さない）"""
    cnt, label = tag_counts(vs)
    drop = sorted(k for k in cnt
                  if k in GENERIC_TAGS or k in PR_TAGS
                  or (pat and re.fullmatch(pat, k, re.I)))
    for k in drop:
        del cnt[k]
    return cnt, label, drop


def acq_note(case, axis_name, meta=None):
    """軸の取得状況。case.json の acquisition を正とし、無ければ取得JSONの stop_reason、
    それも無ければ unknown。本数のしきい値では推測しない（SKILL.md「案件ディレクトリ」）"""
    return ACQ_LABEL[acq_kind(case, axis_name, meta)]


def acq_kind(case, axis_name, meta=None):
    kind = (case.get("acquisition") or {}).get(axis_name)
    if kind in ACQ_LABEL:
        return kind
    kind = (meta or {}).get("stop_reason")
    return kind if kind in ACQ_LABEL else "unknown"


_AXIS_CACHE: dict[str, tuple[list[dict], dict]] = {}


def load_axis(case_dir: str, rel: str, meta_out: dict | None = None) -> list[dict]:
    """1軸ぶんの取得JSONを読む。同じ軸を何度読んでも検査と報告は1回（キャッシュ）"""
    key = os.path.join(case_dir, rel)
    if key not in _AXIS_CACHE:
        _AXIS_CACHE[key] = _load_axis(case_dir, rel)
    videos, meta = _AXIS_CACHE[key]
    if meta_out is not None:
        meta_out.update(meta)
    return videos


def _load_axis(case_dir: str, rel: str) -> tuple[list[dict], dict]:
    p = os.path.join(case_dir, rel)
    d = json.load(open(p, encoding="utf-8"))
    if not d.get("ok"):
        raise SystemExit(f"[STOP] {rel} は ok=false（{d.get('errorCode')}: {d.get('error')}）。"
                         "0件として扱わない。取り直してから再実行する")
    # 配列の順を「検索順位」「表示順」として使う（HEAD・LIST・付録）。
    # tiktok-acquire の --sessions 2 以上は和集合を「出現回数→再生数」で並べ替えるので順位として使えない
    # （search.mjs が order_basis と「順位として使えない」を書く）。黙って順位にすると順位の章が丸ごと嘘になる
    ob = d.get("order_basis")
    if ob is not None and ob != "search_display_order":
        raise SystemExit(
            f"[STOP] {rel} の並び順は order_basis={ob}（{d.get('order_basis_note') or '検索の表示順ではない'}）。\n"
            "  この資料は配列の順を検索順位として載せるので、この軸は使えない。\n"
            "  tiktok-acquire で --sessions 1（既定）で取り直してから再実行する")
    videos = d["videos"]
    # 同じ動画が1つの軸に二度入っていると、本数・率の分母が水増しになる。軸の中だけ動画IDで重複を除く
    # （別の軸に同じ動画が出るのは正常。軸ごとに別々の検索面として数える）
    seen, uniq, dup = set(), [], 0
    for v in videos:
        vid = str(v.get("id") or v.get("url") or "")
        if vid and vid in seen:
            dup += 1
            continue
        seen.add(vid)
        uniq.append(v)
    if dup:
        print(f"[情報] {rel}: 同じ動画IDが重複していた {dup} 件を除いた（{len(videos)} → {len(uniq)}）")
    meta = {"stop_reason": d.get("stop_reason") or (d.get("diag") or {}).get("stop_reason"),
            "duplicates_removed": dup}
    return uniq, meta


def stat(v, key):
    """stats の1項目。取れていなければ None（0 にしない）"""
    x = (v.get("stats") or {}).get(key)
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def plays(v):
    """再生数。stats が無い投稿（取得経路によって起きる）は None。
    以前は v["stats"]["playCount"] を直接引いて KeyError で止まっていた"""
    return stat(v, "playCount")


def eg(v):
    p = plays(v)
    parts = [stat(v, k) for k in ("diggCount", "commentCount", "shareCount", "collectCount")]
    if not p or any(x is None for x in parts):
        return None
    return sum(parts) / p * 100


def srate(v):
    p, c = plays(v), stat(v, "collectCount")
    return c / p * 100 if p and c is not None else None


def stats_note(a, axis_name, vs):
    """指標（stats）が取れていない投稿の本数を INPUT と画面に残す。
    本数には数えるが、平均・中央値・率の母数には入れない（0 再生として数えない）"""
    n = sum(1 for v in vs if plays(v) is None)
    if n:
        a(f"- stats_missing: {n}本（再生数などの指標が取得できていない。平均・中央値・率の母数から除外）")
        print(f"[注意] {axis_name}: 指標（stats）の無い投稿 {n} 本は平均・率の母数から外した（0 として数えていない）")


def mean_plays(vs):
    """平均再生数。再生数が取れている投稿だけで出し、1本も無ければ None"""
    xs = [plays(v) for v in vs if plays(v) is not None]
    return int(st.mean(xs)) if xs else None


def pr_tag(v):
    """PR 表記（タグ・本文）があるか。isAd は別に見る（pr_basis の tag / body）"""
    b = pr_basis(v)
    return "tag" in b or "body" in b


def followers_known(v):
    """フォロワー数。取れていなければ None。
    tiktok-acquire（search.mjs）は取れなかったフォロワー数を 0 で埋める。0 をそのまま使うと
    未取得の投稿がナノ（1万未満）に数えられ、階層の構成が実際より小さい側へ偏る。
    検索に出る投稿者でフォロワー0は実質起きないので、0 も未取得として扱う"""
    f = (v.get("author") or {}).get("followerCount")
    return f if isinstance(f, (int, float)) and f > 0 else None


def tier_of(v):
    f = followers_known(v)
    if f is None:
        return "不明"
    for _, jp, lo, hi in TIERS:
        if lo <= f < hi:
            return jp
    return "不明"


def fmt(n, unit=""):
    if n is None:
        return ND
    return f"{n:.2f}{unit}" if isinstance(n, float) else f"{n:,}{unit}"


def asset_or_nd(case_dir, rel, v=None):
    """画像欄の値。動画IDで保存したカバー（tools/fetch_covers.py の assets/covers/<id>.jpg）を最優先にする。
    順位名（top01.jpg 等）は順位の決め方が変わると別人の投稿に付け替わる（verify_assets.py 冒頭の事故）。
    ID名なら画像が投稿そのものを指すので取り違えが起きない。無ければ従来の順位名を見る"""
    vid = str((v or {}).get("id") or "")
    if vid:
        cov = f"assets/covers/{vid}.jpg"
        if os.path.exists(os.path.join(case_dir, cov)):
            return cov
    return rel if os.path.exists(os.path.join(case_dir, rel)) else ND


def fmt_followers(v):
    """フォロワー数の表示。未取得は「未取得」（0 と書かない。followers_known 参照）"""
    f = followers_known(v)
    return "未取得" if f is None else fmt(f)


# video_manifest.json（解剖した動画の宣言）で人が書くのは「どの動画を・どのコマで」だけ。
# 再生数・保存率・EG は raw から動画IDで引く（数値を手書きすると機械欄と食い違う）
MANIFEST_REQUIRED = ("brand_id", "video_no", "video_id", "sb_frames")


def check_manifest(vman, path):
    """video_manifest.json の形を確かめる。キーが1つ欠けるだけで生の KeyError で落ち、
    どのファイルの何が悪いのか読み手に伝わらなかった"""
    if not vman:
        return []
    if not isinstance(vman, list):
        raise SystemExit(f"[STOP] {path} は配列（[{{...}}, ...]）で書く。形は SKILL.md「2. 動画とコマの抽出」")
    errs = []
    for i, m in enumerate(vman):
        if not isinstance(m, dict):
            errs.append(f"  {i + 1}件目: オブジェクトではない")
            continue
        lack = [k for k in MANIFEST_REQUIRED if not str(m.get(k) or "").strip()]
        if lack:
            errs.append(f"  {i + 1}件目（video_id={m.get('video_id')}）: {', '.join(lack)} が無い")
            continue
        if not re.fullmatch(r"brand_\d{2}", str(m["brand_id"])):
            errs.append(f"  {i + 1}件目: brand_id は brand_01 の形（case.json の brands の並び順）: {m['brand_id']!r}")
        if not re.fullmatch(r"video_\d{2}", str(m["video_no"])):
            errs.append(f"  {i + 1}件目: video_no は video_01 の形: {m['video_no']!r}")
        nums = [x.strip() for x in str(m["sb_frames"]).split("/") if x.strip()]
        if not nums or not all(re.fullmatch(r"\d{2,3}", x) for x in nums):
            errs.append(f"  {i + 1}件目: sb_frames は frames/<video_id>/ のコマ番号を / 区切り（例 001/004/009）: "
                        f"{m['sb_frames']!r}")
    if errs:
        raise SystemExit(f"[STOP] {path} の形が違います:\n" + "\n".join(errs)
                         + "\n  必須キー: " + ", ".join(MANIFEST_REQUIRED)
                         + "（形は SKILL.md「2. 動画とコマの抽出」）")
    return vman


def frames_of(case_dir, vid):
    """extract_frames.py の出力（frames/<id>/NNN.jpg と frames.json）から、コマ番号の一覧と尺を読む"""
    d = os.path.join(case_dir, "frames", str(vid))
    nums = sorted(os.path.splitext(f)[0] for f in (os.listdir(d) if os.path.isdir(d) else [])
                  if re.fullmatch(r"\d{2,3}\.jpg", f))
    dur = None
    try:
        with open(os.path.join(d, "frames.json"), encoding="utf-8") as f:
            dur = json.load(f).get("duration_sec")
    except (OSError, ValueError):
        pass
    return nums, dur



# ---------------------------------------------------------------------------
# tiktok-analyze（動画の中でキーワードが何回言及されたか）を資料の契約へ渡す橋。
#
# なぜ要るか:
#   tiktok-analyze は measurement/measure_output.json に「テロップ・音声・本文で
#   何回言われたか」を出すが、tiktok-deck はこれを1箇所も読んでいなかった。
#   その結果、測って出さない（せっかくの計測が資料に出ない）か、
#   測らずに語る（言及の話を根拠なしに書く）かのどちらかになる。
#   ここで status を必ず紙面まで運び、「未計測」を「0回」と読ませない。
# ---------------------------------------------------------------------------
ANALYZE_CANDIDATES = ("analyze_run", "analyze", "02-analyze-run", "run")


def find_measure_output(case_dir: str, explicit: str | None):
    """measure_output.json を探す。見つからないことは異常ではない（未実施）"""
    if explicit:
        p = os.path.abspath(os.path.expanduser(explicit))
        for cand in (p, os.path.join(p, "measurement", "measure_output.json")):
            if os.path.isfile(cand):
                return cand
        # 明示で渡されたのに無い、は取り違えなので黙って未実施にしない
        raise SystemExit(f"[致命的] --analyze-run に measure_output.json がありません: {explicit}")
    for name in ANALYZE_CANDIDATES:
        cand = os.path.join(case_dir, name, "measurement", "measure_output.json")
        if os.path.isfile(cand):
            return cand
    cand = os.path.join(case_dir, "measurement", "measure_output.json")
    return cand if os.path.isfile(cand) else None


def _metric(m: dict, key: str, suffix: str = ""):
    """未計測を 0 に潰さない。None は ND のまま出す"""
    v = (m or {}).get(key)
    return ND if v is None else f"{v}{suffix}"


CHANNEL_LABEL = {
    "caption": ("本文", "投稿本文に書かれていたか"),
    "hashtag": ("ハッシュタグ", "タグに含まれていたか"),
    "ocr": ("テロップ", "画面の文字として出ていたか"),
    "asr": ("音声", "話されていたか（計測済みの本数だけを分母にする）"),
}


def emit_measured_mentions(a, case_dir: str, explicit: str | None):
    """# MEASURED MENTIONS を出す。未実施でも必ず出す（黙って消さない）"""
    path = find_measure_output(case_dir, explicit)
    a("# MEASURED MENTIONS\n")
    if not path:
        a("- status: not_run")
        a("- note: 動画の中での言及回数は計測していません。"
          "本資料に言及回数の記述がある場合、それは計測値ではありません。"
          "0回ではなく未計測です。")
        a("\n---\n")
        return
    d = json.load(open(path, encoding="utf-8"))
    # ファイルがあることと、中身が計測結果であることは別。
    # 0本しか処理していない出力でも measured を名乗っていた
    processed = d.get("total_videos_processed")
    has_axis = any((ax.get("overall") or {}).get("valid_videos")
                   for ax in (d.get("axes") or []))
    if not processed or not has_axis:
        a("- status: ran_but_empty")
        a(f"- source: {os.path.relpath(path, case_dir)}")
        a(f"- videos_normalized: {d.get('total_videos_normalized', ND)}")
        a(f"- videos_processed: {processed if processed is not None else ND}")
        a(f"- coverage_note: {d.get('coverage_note') or ND}")
        a("- note: 計測は実行されましたが、集計できた動画が0本です。"
          "言及回数は0回ではなく未計測です。この資料で言及の多寡を語ることはできません。")
        a("\n---\n")
        return
    a("- status: measured")
    a(f"- keyword: {d.get('keyword') or ND}")
    a(f"- source: {os.path.relpath(path, case_dir)}")
    a(f"- metric_version: {d.get('metric_version') or ND}")
    a(f"- count_definition: {d.get('primary_count_definition') or ND}")
    a(f"- videos_normalized: {d.get('total_videos_normalized', ND)}")
    a(f"- videos_processed: {d.get('total_videos_processed', ND)}")
    # coverage_note は tiktok-analyze が三値で書いた開示文。要約せずそのまま運ぶ
    a(f"- coverage_note: {d.get('coverage_note') or ND}")
    a("")
    for i, ax in enumerate(d.get("axes") or [], start=1):
        ov = ax.get("overall") or {}
        a(f"## MENTION AXIS {i:02d}\n")
        a(f"- label: {ax.get('label') or ND}")
        a(f"- role: {ax.get('role') or ND}")
        a(f"- videos_in_file: {ax.get('total_videos_in_file', ND)}")
        a(f"- videos_processed: {ax.get('processed_videos_in_file', ND)}")
        a(f"- valid_videos: {_metric(ov, 'valid_videos')}")
        a(f"- videos_with_keyword: {_metric(ov, 'videos_with_keyword')}")
        a(f"- appearance_rate: {_metric(ov, 'appearance_rate_pct', '%')}")
        a(f"- avg_mentions: {_metric(ov, 'avg_mentions_per_video')}")
        # テロップ・音声が未計測の投稿は、その経路の言及を数えていない。統合の登場率・平均回数は
        # その分だけ小さく出る下限値（tiktok-analyze の overall.is_lower_bound）。確定値に見せない。
        # 古い計測結果（キーが無い）では何も足さない
        if ov.get("is_lower_bound") is True:
            um = ov.get("unmeasured_route_videos") or {}
            detail = "・".join(f"{CHANNEL_LABEL[k][0]} {n}本" for k, n in um.items()
                              if k in CHANNEL_LABEL and n)
            a("- is_lower_bound: true")
            a(f"- lower_bound_note: 未計測の経路（{detail or 'テロップ・音声'}）の言及を数えていないため、"
              "登場率・1本あたり回数は下限値")
        a("")
        a("### Channels\n")
        for ch, (label, gist) in CHANNEL_LABEL.items():
            c = (ov.get("channels") or {}).get(ch) or {}
            # 「対象外」（その経路が構造的に無い）と「未計測」（まだ測っていない）は別物。
            # 混ぜると「音声が無い」と誤読されるので、両方を別々に書く（無いキーは 0 扱い＝古い計測結果）
            ex = c.get("excluded_not_applicable") or 0
            um = c.get("excluded_unmeasured") or 0
            parts = ([f"対象外 {ex}本"] if ex else []) + ([f"未計測 {um}本"] if um else [])
            note = f"（{'・'.join(parts)}を分母から除外）" if parts else ""
            a(f"- {ch}_label: {label}")
            a(f"- {ch}_gist: {gist}")
            a(f"- {ch}_valid: {_metric(c, 'valid_videos')}")
            a(f"- {ch}_rate: {_metric(c, 'appearance_rate_pct', '%')}{note}")
            a(f"- {ch}_avg: {_metric(c, 'avg_mentions_per_video')}")
        a("")
    a("\n---\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True, help="案件ディレクトリ（case.json がある場所）")
    ap.add_argument("--out", default="INPUT_mechanical.md")
    ap.add_argument("--analyze-run", default=None,
                    help="tiktok-analyze の run ディレクトリ。省略時は案件内を自動探索")
    args = ap.parse_args()
    case_dir = os.path.abspath(os.path.expanduser(args.case))
    cfg_path = os.path.join(case_dir, "case.json")
    if not os.path.exists(cfg_path):
        # 生の traceback を出すと、何を作ればいいのか読み手に伝わらない。
        # 手順書に case.json の説明が無く、ここで詰まる人が出た
        raise SystemExit(
            f"[致命的] 案件の設定ファイルがありません: {cfg_path}\n"
            "  案件ディレクトリの直下に case.json を置いてください。最小の例:\n"
            "  {\n"
            '    "project": {"project_title": "○○様 提案", "research_period": "2026年9月",\n'
            '                "recipient": "○○株式会社 御中", "producer": "自社名"},\n'
            '    "client": {"client_name": "○○", "client_role": "自社"},\n'
            '    "brands": [{"name": "○○", "file": "raw/brand_○○.json", "match": "○○", "own": true}],\n'
            '    "keywords": []\n'
            "  }\n"
            "  詳しい書式は、このツールの SKILL.md（入れたあとは "
            "~/.claude/skills/tiktok-deck/SKILL.md）の「案件ディレクトリ」を見てください")
    cfg = json.load(open(cfg_path, encoding="utf-8"))

    L: list[str] = []
    a = L.append
    pj = cfg.get("project", {})
    cl = cfg.get("client", {})
    stg = cfg.get("settings", {})

    a("# PROJECT\n")
    for k in ("project_title", "research_period", "recipient", "producer"):
        a(f"- {k}: {pj.get(k, ND)}")
    a(f"- output_filename: {pj.get('output_filename', 'TikTok_Competitive_Research.pptx')}")
    if pj.get("term_legend"):
        a(f"- term_legend: {pj['term_legend']}")
    # 集計条件（絞り込みの実態）。書かないと付録の「集計の条件」欄が出ない
    if pj.get("aggregation_note"):
        a(f"- aggregation_note: {pj['aggregation_note']}")
    # 動画実体を何本取れたか。解剖本数と混同すると「6本しか取れなかった」と誤読される
    # （実際は10本取得成功のうち6本を解剖対象に選定していた）
    mm = os.path.join(case_dir, "media_manifest.json")
    if os.path.exists(mm):
        try:
            man = json.load(open(mm, encoding="utf-8"))
            a(f"- media_acquired: {int(man.get('succeeded') or 0)}")
            a(f"- media_requested: {int(man.get('requested') or 0)}")
        except Exception:   # noqa: BLE001  取得記録が壊れていても資料生成は止めない
            pass
    a("\n---\n")
    emit_measured_mentions(a, case_dir, args.analyze_run)
    a("# GLOBAL SETTINGS\n")
    a("- cross_client_comparison: false")
    a(f"- max_brands_per_comparison_slide: {stg.get('max_brands_per_comparison_slide', 3)}")
    a("- individual_video_page_per_video: true")
    a("- allow_generated_images: false")
    a(f"- video_list_top_n: {stg.get('video_list_top_n', 4)}")
    # Q5 の抽出基準。レンダラが「再生数TOP1」と決め打ちしないようデータ側で宣言する
    a(f"- q5_basis_label: {stg.get('q5_basis_label', '保存率TOP1（再生数順ではない）')}")
    a("\n---\n")
    a("# FOLLOWER TIER DEFINITION\n")
    a("- nano: フォロワー1万未満")
    a("- micro: 1万〜10万未満")
    a("- middle: 10万〜100万未満")
    a("- mega: 100万以上")
    a("\n---\n")
    a("# CLIENTS\n")
    a("## CLIENT 01\n")
    a("### Basic\n")
    a("- client_id: client_01")
    for k in ("client_name", "client_role", "client_note"):
        a(f"- {k}: {cl.get(k, ND)}")
    a("\n### Brands\n")

    # 解剖対象の動画（あれば）。無い案件では VIDEO ANALYSIS を出さない
    vman_path = os.path.join(case_dir, "video_manifest.json")
    vman = json.load(open(vman_path, encoding="utf-8")) if os.path.exists(vman_path) else []
    vman = check_manifest(vman, vman_path)
    known_bids = {f"brand_{i:02d}" for i in range(1, len(cfg["brands"]) + 1)}
    stray = [m for m in vman if m["brand_id"] not in known_bids]
    if stray:
        # 該当ブランドが無い宣言は黙って捨てられ、解剖したはずの動画が資料から消えていた
        raise SystemExit(f"[STOP] {vman_path} の brand_id が case.json の brands に無い: "
                         + ", ".join(sorted({m['brand_id'] for m in stray}))
                         + f"（brands は {len(cfg['brands'])} 件。brand_01 から順）")

    # 自社の判定は case.json の brands[].own だけを正にする。レンダラが client_name の部分一致で
    # 別に判定していたため、社名（株式会社◯◯）とブランド名が違う案件で「◯◯ 0本」という
    # 実在しない行が足され、同じ資料の「自社露出 5本」と食い違った
    owns = [b["name"] for b in cfg["brands"] if b.get("own")]
    if len(owns) != 1:
        print(f"[注意] case.json の brands で own: true のブランドが {len(owns)} 件です（1件にしてください）。"
              "自社の判定ができないので、自社露出は [DATA NOT PROVIDED] で出します")

    # 動画IDで raw を引けるようにする（解剖動画の数値を手書きさせないため）
    by_id: dict[str, dict] = {}
    for ax in list(cfg["brands"]) + list(cfg.get("keywords") or []):
        for v in load_axis(case_dir, ax["file"]):
            by_id.setdefault(str(v.get("id") or ""), v)

    market = {}        # 市場面でのブランド言及シェア
    for bi, b in enumerate(cfg["brands"], start=1):
        bid = f"brand_{bi:02d}"
        meta: dict = {}
        raw = load_axis(case_dir, b["file"], meta)
        pat = b.get("match")
        vs = [v for v in raw
              if not pat or re.search(pat, (v.get("desc") or "") + " "
                                      + " ".join(v.get("hashtags") or []), re.I)]
        if pat and not vs and raw:
            # 以前は `or raw` で取得した全件を黙ってそのブランドの投稿として数えていた。
            # 同じ資料のキーワード面ではそのブランドが0本と出て、数字が食い違う
            raise SystemExit(
                f"[STOP] {b['name']} の match（{pat}）が取得 {len(raw)} 件のどれにも当たらない。\n"
                "  正規表現（表記ゆれ・英字表記）を確認する。取得した全件をそのブランドとして数えるなら\n"
                "  match を空（\"\"）にして、その旨を資料に書くこと")

        def ast(rel, v=None):
            return asset_or_nd(case_dir, f"assets/client_01/{bid}/{rel}", v)

        a(f"#### BRAND {bi:02d}\n")
        a(f"- brand_id: {bid}")
        a(f"- brand_name: {b['name']}")
        a(f"- is_own: {'true' if b.get('own') else 'false'}")
        a(f"- company_name: {b.get('company_name', ND)}")
        a(f"- search_keyword: {b.get('query', b['name'])}")
        # 括弧付きにすると「98（生115本）」→98115 と読まれ母数計算が壊れる。数値だけ入れる
        a(f"- total_video_count: {len(vs)}")
        a(f"- raw_video_count: {len(raw)}")
        stats_note(a, b["name"], vs)
        a(f"- acquisition_note: {acq_note(cfg, b['name'], meta)}")
        a("")
        a("##### Q1 Influencer Tier\n")
        # フォロワー数が取れていない投稿は Unknown に分ける（ナノに混ぜない。followers_known 参照）
        for en, jp, lo, hi in TIERS + [("Unknown", "不明", None, None)]:
            if lo is None:
                grp = [v for v in vs if followers_known(v) is None]
            else:
                grp = [v for v in vs
                       if followers_known(v) is not None and lo <= followers_known(v) < hi]
            egs = [x for x in (eg(v) for v in grp) if x is not None]
            a(f"###### {en}")
            a(f"- post_count: {len(grp)}")
            a(f"- avg_views: "
              + ((fmt(mean_plays(grp)) if mean_plays(grp) is not None else ND) if grp
                 else NONE_HERE))
            a(f"- avg_eg: " + (fmt(st.mean(egs), '%') if egs else NONE_HERE))
            a("")
        pool, dropped, lim = rate_pool(cfg, vs)
        top = max(pool, key=lambda v: srate(v) or 0) if pool else None
        a("##### Q1 Example\n")
        if top:
            au = top.get("author") or {}
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- followers: {fmt_followers(top)}")
            a(f"- views: {fmt(plays(top))}")
            a(f"- eg: {fmt(eg(top), '%')}")
            a(f"- url: {top.get('url')}")
            a(f"- image_path: {ast('q1_example.jpg', top)}")
        else:
            for k in ("creator", "followers", "views", "eg", "image_path"):
                a(f"- {k}: {ND}")
        a("")
        a("##### Q1 Insight\n")
        a(f"- insight: {ND}")
        a("\n---\n")
        # Q2（PRは2定義）
        _ad_yes, _ad_no, _ad_unk = split3(vs, is_ad)
        pr_ad = _ad_yes
        pr_tg = [v for v in vs if pr_tag(v)]
        pr, org, pr_unknown = pr_sets(vs)
        pr_eg = [x for x in (eg(v) for v in pr) if x is not None]
        org_eg = [x for x in (eg(v) for v in org) if x is not None]
        srs = [x for x in (srate(v) for v in vs) if x is not None]
        gap = abs(len(pr_ad) - len(pr_tg)) / len(vs) if vs else 0
        a("##### Q2 PR vs Organic\n")
        a(f"- pr_count: {len(pr)}")
        a(f"- total_count: {len(vs)}")
        # 判定不可を分母に含めたまま「0.00%」と出すと嘘になる。件数を併記する
        a(f"- pr_share: {fmt(len(pr) / len(vs) * 100 if vs else None, '%')}"
          + (f"（ただし{len(pr_unknown)}本は広告フラグ未取得。この値は下限）"
             if pr_unknown else ""))
        a("- pr_avg_eg: " + (fmt(st.mean(pr_eg), '%') if pr_eg
                             else "0本（PR投稿なし）"))
        a(f"- organic_avg_eg: {fmt(st.mean(org_eg) if org_eg else None, '%')}")
        a(f"- avg_save_rate: {fmt(st.median(srs) if srs else None, '%')}")
        # 内訳を数値で渡す。付録が「各ブランドのページに内訳を併記」と書くのに、
        # 文章の pr_definition_note しか無くどのページにも描かれていなかった
        a(f"- pr_isad_count: {len(pr_ad)}")
        a(f"- pr_tag_count: {len(pr_tg)}")
        a(f"- pr_isad_unknown: {len(_ad_unk)}")
        a(f"- pr_definition_note: PR＝TikTokの広告フラグ(isAd)またはPR表記（#PR・#PR案件・#タイアップ・#広告・"
          f"#プロモーション・#提供・#ad・#sponsored のタグ、本文の【PR】等）のいずれか。"
          f"内訳は isAd {len(pr_ad)}本／PR表記 {len(pr_tg)}本。"
          # 広告フラグが取れていない投稿を黙って「非PR」に数えると PR比率が過少になる
          + (f"うち {len(_ad_unk)}本は広告フラグが未取得のため、isAd 側の比率は下限値である。"
             if _ad_unk else "")
          + (f"この軸は定義によって比率が大きく変わる（差{gap * 100:.1f}ポイント）ため、"
             "どちらの定義で語るかを明示しないと誤読を招く。" if gap > 0.05 else ""))
        a(f"- insight: {ND}")
        a("\n---\n")
        # Q3（タグを切り口として使う。分類はデータ由来のみ）。ブランド名そのもの・PR表記・汎用タグは除く
        tags, label, excluded = topic_tag_counts(vs, pat)
        a("##### Q3 Content Clusters\n")
        a("- excluded_tags: " + ("／".join(f"#{label[k]}" for k in excluded) if excluded else "なし")
          + "（ブランド名・PR表記・汎用タグは切り口に数えない）")
        # 所見の欄はクラスタの小見出しより前に置く。後ろに置いていたため最後の Cluster の一部として読まれ、
        # 書いた q3_insight が Q3 のページに出ていなかった（Q4・Q5 も同じ）
        for k in ("high_response_cluster", "low_response_cluster", "opportunity_cluster",
                  "insight"):
            a(f"- {k}: {ND}")
        a("")
        for ci, (key, _) in enumerate(tags.most_common(4), start=1):
            tag = label[key]
            grp = [v for v in vs if key in norm_tags(v)]
            egs = [x for x in (eg(v) for v in grp) if x is not None]
            a(f"###### Cluster {ci:02d}")
            a(f"- name: #{tag}")
            a(f"- post_count: {len(grp)}")
            a(f"- avg_views: {fmt(mean_plays(grp))}")
            a(f"- avg_eg: {fmt(st.mean(egs) if egs else None, '%')}")
            srg = [x for x in (srate(v) for v in grp) if x is not None]
            a(f"- avg_save_rate: {fmt(st.mean(srg) if srg else None, '%')}")
            a("")
        a("\n---\n")
        a("##### Q4 Product / Context\n")
        # url・画像・所見は小見出しより前に置く。「###### Frequent Products」の後ろに置いていたため
        # パーサがそれを商品リストの一部として読み、書いた q4_insight が Q4 のページに1文字も出なかった
        # どの動画のカバーかを併記する。書かないと画像とキャプションのズレを
        # verify_assets.py が照合できない（top01.jpg は順位で名前が付いているため）
        a(f"- url: {top.get('url') if top else ND}")
        a(f"- representative_image: {ast('top01.jpg', top)}")
        a(f"- insight: {ND}")
        a("")
        a("###### Frequent Hashtags")
        for i, (key, cnt) in enumerate(tags.most_common(5), start=1):
            a(f"{i}. #{label[key]} {cnt}")
        a("")
        a("###### Frequent Products / SKU")
        a(f"1. {ND}")
        a("\n---\n")
        a("##### Q5 Top Videos\n")
        q5pool, q5drop, q5lim = rate_pool(cfg, [v for v in vs if plays(v)])
        # 文ではなく数値で出す。文にすると Q5 ページ（5社を1枚に並べる）で
        # 先頭ブランドの除外本数が全体の値として読まれる（p12で6本と出て実際は16本だった）
        a(f"- rate_rank_min_views: {q5lim}")
        a(f"- rate_rank_dropped: {q5drop}")
        # TOP VIDEO の小見出しより前に置く（後ろだと TOP VIDEO 03 の欄として読まれ、Q5 の結論に出ない）
        a(f"- q5_insight: {ND}")
        a("")
        ranked = sorted(q5pool, key=lambda v: srate(v) or 0, reverse=True)[:3]
        for i, v in enumerate(ranked, start=1):
            au = v.get("author") or {}
            a(f"###### TOP VIDEO {i:02d}")
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- followers: {fmt_followers(v)}")
            a(f"- views: {fmt(plays(v))}")
            a(f"- eg: {fmt(eg(v), '%')}")
            a(f"- title: {(v.get('desc') or '')[:60]}")
            a(f"- save_rate: {fmt(srate(v), '%')}")
            # レンダラの Q5 は saves / is_pr も参照する。出さないとスライドに欠損が出る
            a(f"- saves: {fmt(stat(v, 'collectCount'))}")
            a(f"- is_pr: {pr_label(v)}")
            a(f"- media: {media_label(v)}")
            a(f"- content_summary: {ND}")
            a(f"- url: {v.get('url')}")
            a(f"- image_path: {ast(f'top{i:02d}.jpg', v)}")
            a("")
        # VIDEO LIST。これが無いと「構成解剖の候補にした検索上位」の表が空になる
        topn = int(stg.get("video_list_top_n", 4) or 4)
        a("##### VIDEO LIST\n")
        a(f"- note: この軸の表示順の上位{topn}本を掲載。実質{len(vs)}本のうち残りは非掲載（集計には含む）。")
        a("")
        for li, v in enumerate(vs[:topn], start=1):
            au = v.get("author") or {}
            a(f"###### LIST {li:02d}")
            a(f"- search_rank: {li}")
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- tier: {tier_of(v)}")
            a(f"- views: {fmt(plays(v))}")
            a(f"- eg: {fmt(eg(v), '%')}")
            a(f"- save_rate: {fmt(srate(v), '%')}")
            a(f"- is_pr: {pr_label(v)}")
            # 媒体は解剖対象になれるかを決める。書かないと「候補」の表に
            # 構造上候補になれない写真投稿が黙って並ぶ
            a(f"- media: {media_label(v)}")
            a(f"- topic: {(v.get('desc') or '')[:24]}")
            a(f"- cluster: {ND}")
            a(f"- thumb_path: {ast(f'list{li:02d}.jpg', v)}")
            a(f"- url: {v.get('url')}")
            a("")
        a("\n---\n")
        # VIDEO ANALYSIS（解剖した動画だけ。8軸は散文なので ND のまま残す）
        mine = [m for m in vman if m["brand_id"] == bid]
        # VIDEO ANALYSIS は1ブランドに1つ。動画ごとに出すと parser が最初の1本しか読まない
        if mine:
            a("##### VIDEO ANALYSIS\n")
        for m in mine:
            vn = m["video_no"]
            vid = str(m["video_id"])
            rv = by_id.get(vid)          # raw 側の同じ動画（数値の出どころ）
            rau = (rv or {}).get("author") or {}
            nums = [x.strip() for x in str(m["sb_frames"]).split("/") if x.strip()]
            fnums, fdur = frames_of(case_dir, vid)
            a(f"###### {vn.upper().replace('_', ' ')}\n")
            a(f"- video_id: {vid}")
            a(f"- creator: {m.get('creator') or rau.get('nickname') or rau.get('uniqueId') or ND}")
            # 数値は raw を正にする。raw に無い動画（別経路で選んだ等）だけ manifest の値を使う
            if rv:
                a(f"- views: {fmt(plays(rv))}")
                a(f"- save_rate: {fmt(srate(rv), '%')}")
                a(f"- eg: {fmt(eg(rv), '%')}")
            else:
                a(f"- views: {fmt(m['views']) if m.get('views') is not None else ND}")
                # 桁を fmt に揃える。生値のままだと 4.1% だけ1桁になり、
                # 他ページの 4.97% / 6.08% と並んだとき別種の数字に見える
                a(f"- save_rate: {fmt(float(m['save_rate']), '%')}" if m.get('save_rate') is not None
                  else f"- save_rate: {ND}")
                a(f"- eg: {fmt(float(m['eg']), '%')}" if m.get('eg') is not None else f"- eg: {ND}")
            # 抽出したコマ数と範囲は frames/<id>/ の実ファイルから数える（手書きの値より実物を正にする）
            a(f"- frames_seen: {len(fnums) if fnums else (m.get('frames_seen') or ND)}")
            a(f"- frames_range: {f'{fnums[0]}〜{fnums[-1]}' if fnums else (m.get('frames_range') or ND)}")
            a(f"- sb_frames: {'/'.join(nums)}")
            # 尺（秒）。frames.json（実ファイルの ffprobe 値）→ raw の duration の順。
            # 0 は写真投稿か未取得なので書かない（「全0秒」と出さない）
            dur = fdur if fdur else ((rv or {}).get("duration") or None)
            if dur:
                a(f"- duration_sec: {float(dur):.1f}")
            a(f"- media: {media_label(rv) if rv else '未取得'}")
            a(f"- url: {m.get('url') or (rv or {}).get('url') or ND}")
            a(f"- title: {m.get('title_src') or ((rv or {}).get('desc') or '')[:60] or ND}")
            a("")

            # コマ画像。assets/.../video_NN/ に手で写したものがあればそれを使い、無ければ
            # extract_frames.py の出力（frames/<id>/NNN.jpg）を直接指す。写しを作る道具が無く、
            # 手順どおりに進めると全コマが [IMAGE NOT PROVIDED] になっていた
            def frame_img(copy_rel, num):
                if os.path.exists(os.path.join(case_dir, copy_rel)):
                    return copy_rel
                return f"frames/{vid}/{num}.jpg"

            a("###### Images")
            a(f"- main_image_path: {frame_img(f'assets/client_01/{bid}/{vn}/main.jpg', nums[0])}")
            a("")
            a("###### Storyboard")
            for j, num in enumerate(nums, start=1):
                a(f"- sb{j}_path: {frame_img(f'assets/client_01/{bid}/{vn}/sb{j}.jpg', num)}")
                a(f"- sb{j}_label: {ND}")
            a("")
            for head, keys in (("Hook", ["hook_0_3_sec", "hook_summary"]),
                               ("Visual", ["visual_killer", "visual_note"]),
                               ("Text", ["text_note"]),
                               ("Price / Spec", ["price"]),
                               ("Product Exposure", ["brand_exposure"]),
                               ("CTA", ["cta"]),
                               ("Comparison", ["comparison_structure"]),
                               ("Final Frame", ["final_frame"]),
                               ("Observed Limits", ["observed_limits"]),
                               ("Hypothesis", ["success_or_failure_hypothesis"]),
                               ("One Line Essence", ["one_line_essence"])):
                a(f"###### {head}")
                for k in keys:
                    a(f"- {k}: {ND}")
                a("")
            a("\n---\n")

    # KEYWORD（市場面）。見出しの階層を誤ると parser が丸ごと無視し「市場0ワード」になる
    if cfg.get("keywords"):
        a("# KEYWORD AXES\n")
    for ki, k in enumerate(cfg.get("keywords", []), start=1):
        kid = f"kw_{ki:02d}"
        kmeta: dict = {}
        vs = load_axis(case_dir, k["file"], kmeta)

        def kast(rel, v=None):
            return asset_or_nd(case_dir, f"assets/client_01/{kid}/{rel}", v)

        srs = [x for x in (srate(v) for v in vs) if x is not None]
        pr, _org_x, pr_unknown = pr_sets(vs)
        a(f"## KEYWORD {ki:02d}\n")
        a(f"- keyword: {k['name']}")
        a(f"- total_count: {len(vs)}")
        stats_note(a, k["name"], vs)
        a(f"- acquisition_note: {acq_note(cfg, k['name'], kmeta)}")
        a("")
        a("### Head 10\n")
        # 取得JSONに rank フィールドは無い。配列の順序そのものが表示順
        # （search.mjs の order_basis: search_display_order）。順位は 1 始まりで付ける
        ranked = vs[:10]
        for idx, v in enumerate(ranked):
            au = v.get("author") or {}
            a(f"#### HEAD {idx + 1:02d}")
            a(f"- rank: {idx + 1}")
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- tier: {tier_of(v)}")
            a(f"- views: {fmt(plays(v))}")
            a(f"- eg: {fmt(eg(v), '%')}")
            a(f"- save_rate: {fmt(srate(v), '%')}")
            a(f"- is_pr: {pr_label(v)}")
            a(f"- caption: {(v.get('desc') or '')[:70]}")
            a(f"- url: {v.get('url')}")
            a(f"- image_path: {kast(f'head{idx + 1:02d}.jpg', v)}")
            a("")
        a("### Head Composition\n")
        tc = Counter(tier_of(v) for v in vs)
        a("- tier_mix: " + "／".join(f"{t}{n}" for t, n in tc.most_common()))
        a((f"- pr_count: {len(pr)}本（{len(pr) / len(vs) * 100:.2f}%）"
           + (f"／{len(pr_unknown)}本は判定不可" if pr_unknown else ""))
          if vs else f"- pr_count: {ND}")
        # 静止画カルーセルと動画を区別して出す。書かないと「どんな動画か」という
        # 見出しの下に写真投稿が並ぶ（100均・便利グッズは保存率上位5本中4本が写真だった）
        a(f"- media_mix: {media_mix(cfg, vs)}")
        a(f"- cluster_mix: {ND}")
        a(f"- insight: {ND}")
        a("")
        a("### Save Top\n")
        # Q5（ブランド軸）と同じ下限を適用する。適用しないと分母の小さい投稿
        # （再生403・保存13=3.23%等）が「保存率1位」として出て、Q5の
        # 「再生1,000以上に限定」という注記と矛盾する（実際に事故った）
        save_pool, save_dropped, save_lim = rate_pool(cfg, vs)
        a(f"- rate_rank_min_views: {save_lim}")
        a(f"- rate_rank_dropped: {save_dropped}")
        tops = sorted([v for v in save_pool if plays(v)],
                      key=lambda v: srate(v) or 0, reverse=True)[:5]
        for i, v in enumerate(tops, start=1):
            au = v.get("author") or {}
            a(f"#### SAVE {i}")
            a(f"- rank: {vs.index(v) + 1}")
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- views: {fmt(plays(v))}")
            a(f"- saves: {fmt(stat(v, 'collectCount'))}")
            a(f"- save_rate: {fmt(srate(v), '%')}")
            a(f"- eg: {fmt(eg(v), '%')}")
            a(f"- is_pr: {pr_label(v)}")
            a(f"- media: {media_label(v)}")
            a(f"- caption: {(v.get('desc') or '')[:60]}")
            a(f"- url: {v.get('url')}")
            a(f"- image_path: {kast(f'save{i:02d}.jpg', v)}")
            a("")
        a("### Brand Exposure\n")
        share = {}
        for b in cfg["brands"]:
            pat = b.get("match")
            hit = [v for v in vs
                   if pat and re.search(pat, (v.get("desc") or "") + " "
                                        + " ".join(v.get("hashtags") or []), re.I)]
            share[b["name"]] = len(hit)
            # parser は「#### EXPOSURE」配下の brand/count を読む。
            # 「- ブランド名: 件数」の形だと全ブランド0本として描かれる
            a(f"#### EXPOSURE {b['name']}")
            a(f"- brand: {b['name']}")
            a(f"- count: {len(hit)}")
            a("")
        market[k["name"]] = share
        a("")
        a("### Findings\n")
        a(f"- head_insight: {ND}")
        a(f"- save_pattern: {ND}")
        a("- rank_note: 「保存数順」の表の順位列は、この検索軸の表示順（取得時の並び）である。"
          "保存率で抽出しているため、表示順の上位10本の外から入る行がある。")
        a("\n---\n")

    # KEYWORD CROSS SUMMARY。無いとQ6総括ページが空になる
    if cfg.get("keywords"):
        own = owns[0] if len(owns) == 1 else None
        a("# KEYWORD CROSS SUMMARY\n")
        a(f"- whitespace: {ND}")
        a("")
        for ki, k in enumerate(cfg["keywords"], start=1):
            kmeta = {}
            vs = load_axis(case_dir, k["file"], kmeta)
            srs = [x for x in (srate(v) for v in vs) if x is not None]
            pr, _org_x, pr_unknown = pr_sets(vs)
            # 自社が決まらないときに 0本 と書くと「自社は一度も出ていない」という嘘になる
            hit = market.get(k["name"], {}).get(own) if own else None
            a(f"## KW SUMMARY {ki:02d}\n")
            a(f"- keyword: {k['name']}")
            kind = acq_kind(cfg, k["name"], kmeta)
            a(f"- total_count: {len(vs)}"
              + ("（母数未確定）" if kind in ("capped", "unknown", "no_new") else ""))
            a((f"- pr_share: {len(pr) / len(vs) * 100:.1f}%"
               + (f"（{len(pr_unknown)}本は判定不可のため下限）" if pr_unknown else ""))
              if vs else f"- pr_share: {ND}")
            a(f"- avg_save_rate: {fmt(st.median(srs) if srs else None, '%')}")
            a(f"- save_rate_basis: 中央値")
            a(f"- save_type: {ND}")
            a(f"- own_exposure: {ND if hit is None else f'{hit}本'}")
            a("")
        a("\n---\n")

    out = os.path.join(case_dir, args.out)
    open(out, "w", encoding="utf-8").write("\n".join(L))
    body = "\n".join(L)
    print(f"→ {out}")
    print(f"行数 {len(L)} / 未記入(散文欄) {body.count(ND)} 箇所")
    print("\n=== 市場面でのブランド言及（提案の骨格になる数字）===")
    for kname, sh in market.items():
        tot = sum(1 for _ in [0])  # noqa
        line = " / ".join(f"{b} {n}" for b, n in sh.items())
        print(f"  {kname}: {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
