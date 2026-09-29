#!/usr/bin/env python3
"""build_input_md.py — 取得JSON群から INPUT.md の機械欄を生成する（案件非依存）

案件固有の値はコードに書かない。すべて case.json から読む。
散文欄（insight・仮説など）はここでは書かず [DATA NOT PROVIDED] を残す。
後段で Claude が references/authoring-checklist.md に沿って書く。

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
  "settings": {"max_brands_per_comparison_slide": 3, "video_list_top_n": 4},
  "brands":  [{"name": "サンプルストア", "file": "raw/brand_サンプルストア.json",
               "match": "サンプルストア|samplestore", "own": true}, ...],
  "keywords":[{"name": "100均", "file": "raw/kw_100均.json"}, ...]
}
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics as st
from collections import Counter, defaultdict

ND = "[DATA NOT PROVIDED]"      # 取得できていない（＝穴。埋めるべきもの）
NONE_HERE = "0本（該当なし）"      # そこに実体が無い（＝穴ではない。欠損と混同させない）
TIERS = [("Nano", "ナノ", 0, 10_000), ("Micro", "マイクロ", 10_000, 100_000),
         ("Middle", "ミドル", 100_000, 1_000_000), ("Mega", "メガ", 1_000_000, 10 ** 12)]
CEILING_HINT = 148    # これ以上返ったら取得上限に当たった可能性（母数未確定）

# 本数のしきい値だけで「上限到達」と書くと事実と食い違う。
# 実際には TikTok 側が has_more=false を返して枯渇した軸もあり、
# それを「取得上限＝母数未確定」と書くのは不確実性の誇張になる（p21 で発生）。
# 軸ごとの実際の終わり方は case.json の acquisition[<軸名>] で与える。
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
    lim = int(((cfg.get("settings") or {}).get("min_views_for_rate_rank")) or 1000)
    pool = [v for v in vs if ((v.get("stats") or {}).get("playCount") or 0) >= lim]
    return (pool or vs), len(vs) - len(pool), lim



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


def media_mix(vs):
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
    top = sorted(vs, key=lambda v: srate(v) or 0, reverse=True)[:10]
    tp = sum(1 for v in top if is_photo(v))
    out = (f"写真カルーセル {len(ph)}本（{len(ph) / len(vs) * 100:.1f}%）／"
           f"動画 {len(vd)}本。保存率上位10本のうち写真は {tp}本")
    if ph and vd:
        out += (f"。保存率中央値は写真 {st.median([srate(v) for v in ph]):.2f}%・"
                f"動画 {st.median([srate(v) for v in vd]):.2f}%")
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


def acq_note(case, axis_name, n):
    """軸の取得状況。case.json に記録があればそれを正とし、無ければ本数から推定する"""
    kind = (case.get("acquisition") or {}).get(axis_name)
    if kind in ACQ_LABEL:
        return ACQ_LABEL[kind]
    return "上限到達=母数未確定" if n >= CEILING_HINT else "上限未満=下限値"


def load_axis(case_dir: str, rel: str) -> list[dict]:
    p = os.path.join(case_dir, rel)
    d = json.load(open(p, encoding="utf-8"))
    if not d.get("ok"):
        raise SystemExit(f"[STOP] {rel} は ok=false（{d.get('errorCode')}: {d.get('error')}）。"
                         "0件として扱わない。取り直してから再実行する")
    return d["videos"]


def eg(v):
    s, p = v["stats"], v["stats"]["playCount"]
    if not p:
        return None
    return (s["diggCount"] + s["commentCount"] + s["shareCount"] + s["collectCount"]) / p * 100


def srate(v):
    p = v["stats"]["playCount"]
    return v["stats"]["collectCount"] / p * 100 if p else None


def pr_tag(v):
    tags = [t.lower() for t in (v.get("hashtags") or [])]
    return any(t in ("pr", "pr案件", "タイアップ", "広告") for t in tags)


def tier_of(v):
    f = (v.get("author") or {}).get("followerCount") or 0
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



# ---------------------------------------------------------------------------
# 02-analyze（動画の中でキーワードが何回言及されたか）を資料の契約へ渡す橋。
#
# なぜ要るか:
#   02-analyze は measurement/measure_output.json に「テロップ・音声・本文で
#   何回言われたか」を出すが、03-deck はこれを1箇所も読んでいなかった。
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
    # coverage_note は 02-analyze が三値で書いた開示文。要約せずそのまま運ぶ
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
        a("")
        a("### Channels\n")
        for ch, (label, gist) in CHANNEL_LABEL.items():
            c = (ov.get("channels") or {}).get(ch) or {}
            ex = c.get("excluded_not_applicable") or 0
            note = f"（対象外 {ex}本を分母から除外）" if ex else ""
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
                    help="02-analyze の run ディレクトリ。省略時は案件内を自動探索")
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

    market = {}        # 市場面でのブランド言及シェア
    for bi, b in enumerate(cfg["brands"], start=1):
        bid = f"brand_{bi:02d}"
        raw = load_axis(case_dir, b["file"])
        pat = b.get("match")
        vs = [v for v in raw
              if not pat or re.search(pat, (v.get("desc") or "") + " "
                                      + " ".join(v.get("hashtags") or []), re.I)] or raw

        def ast(rel, v=None):
            return asset_or_nd(case_dir, f"assets/client_01/{bid}/{rel}", v)

        a(f"#### BRAND {bi:02d}\n")
        a(f"- brand_id: {bid}")
        a(f"- brand_name: {b['name']}")
        a(f"- company_name: {b.get('company_name', ND)}")
        a(f"- search_keyword: {b.get('query', b['name'])}")
        # 括弧付きにすると「98（生115本）」→98115 と読まれ母数計算が壊れる。数値だけ入れる
        a(f"- total_video_count: {len(vs)}")
        a(f"- raw_video_count: {len(raw)}")
        a(f"- acquisition_note: {acq_note(cfg, b['name'], len(raw))}")
        a("")
        a("##### Q1 Influencer Tier\n")
        for en, jp, lo, hi in TIERS:
            grp = [v for v in vs
                   if lo <= ((v.get("author") or {}).get("followerCount") or 0) < hi]
            egs = [x for x in (eg(v) for v in grp) if x is not None]
            a(f"###### {en}")
            a(f"- post_count: {len(grp)}")
            a(f"- avg_views: "
              + (f"{int(st.mean([v['stats']['playCount'] for v in grp])):,}" if grp
                 else NONE_HERE))
            a(f"- avg_eg: " + (fmt(st.mean(egs), '%') if egs else NONE_HERE))
            a("")
        pool, dropped, lim = rate_pool(cfg, vs)
        top = max(pool, key=lambda v: srate(v) or 0) if pool else None
        a("##### Q1 Example\n")
        if top:
            au = top.get("author") or {}
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- followers: {fmt(au.get('followerCount'))}")
            a(f"- views: {fmt(top['stats']['playCount'])}")
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
        a(f"- pr_definition_note: PR＝TikTokの広告フラグ(isAd)または#PRタグのいずれか。"
          f"内訳は isAd {len(pr_ad)}本／#PRタグ {len(pr_tg)}本。"
          # 広告フラグが取れていない投稿を黙って「非PR」に数えると PR比率が過少になる
          + (f"うち {len(_ad_unk)}本は広告フラグが未取得のため、isAd 側の比率は下限値である。"
             if _ad_unk else "")
          + (f"この軸は定義によって比率が大きく変わる（差{gap * 100:.1f}ポイント）ため、"
             "どちらの定義で語るかを明示しないと誤読を招く。" if gap > 0.05 else ""))
        a(f"- insight: {ND}")
        a("\n---\n")
        # Q3（タグを切り口として使う。分類はデータ由来のみ）
        tags, label = tag_counts(vs)
        a("##### Q3 Content Clusters\n")
        for ci, (key, _) in enumerate(tags.most_common(4), start=1):
            tag = label[key]
            grp = [v for v in vs if key in norm_tags(v)]
            egs = [x for x in (eg(v) for v in grp) if x is not None]
            a(f"###### Cluster {ci:02d}")
            a(f"- name: #{tag}")
            a(f"- post_count: {len(grp)}")
            a(f"- avg_views: "
              f"{fmt(int(st.mean([v['stats']['playCount'] for v in grp])) if grp else None)}")
            a(f"- avg_eg: {fmt(st.mean(egs) if egs else None, '%')}")
            srg = [x for x in (srate(v) for v in grp) if x is not None]
            a(f"- avg_save_rate: {fmt(st.mean(srg) if srg else None, '%')}")
            a("")
        for k in ("high_response_cluster", "low_response_cluster", "opportunity_cluster",
                  "insight"):
            a(f"- {k}: {ND}")
        a("\n---\n")
        a("##### Q4 Product / Context\n")
        a("###### Frequent Hashtags")
        for i, (key, cnt) in enumerate(tags.most_common(5), start=1):
            a(f"{i}. #{label[key]} {cnt}")
        a("")
        a("###### Frequent Products / SKU")
        a(f"1. {ND}")
        a("")
        # どの動画のカバーかを併記する。書かないと画像とキャプションのズレを
        # verify_assets.py が照合できない（top01.jpg は順位で名前が付いているため）
        a(f"- url: {top.get('url') if top else ND}")
        a(f"- representative_image: {ast('top01.jpg', top)}")
        a(f"- insight: {ND}")
        a("\n---\n")
        a("##### Q5 Top Videos\n")
        q5pool, q5drop, q5lim = rate_pool(cfg, [v for v in vs if v["stats"]["playCount"]])
        # 文ではなく数値で出す。文にすると Q5 ページ（5社を1枚に並べる）で
        # 先頭ブランドの除外本数が全体の値として読まれる（p12で6本と出て実際は16本だった）
        a(f"- rate_rank_min_views: {q5lim}")
        a(f"- rate_rank_dropped: {q5drop}")
        a("")
        ranked = sorted(q5pool, key=lambda v: srate(v) or 0, reverse=True)[:3]
        for i, v in enumerate(ranked, start=1):
            au = v.get("author") or {}
            a(f"###### TOP VIDEO {i:02d}")
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- followers: {fmt(au.get('followerCount'))}")
            a(f"- views: {fmt(v['stats']['playCount'])}")
            a(f"- eg: {fmt(eg(v), '%')}")
            a(f"- title: {(v.get('desc') or '')[:60]}")
            a(f"- save_rate: {fmt(srate(v), '%')}")
            # レンダラの Q5 は saves / is_pr も参照する。出さないとスライドに欠損が出る
            a(f"- saves: {fmt(v['stats']['collectCount'])}")
            a(f"- is_pr: {pr_label(v)}")
            a(f"- media: {media_label(v)}")
            a(f"- content_summary: {ND}")
            a(f"- url: {v.get('url')}")
            a(f"- image_path: {ast(f'top{i:02d}.jpg', v)}")
            a("")
        a(f"- q5_insight: {ND}")
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
            a(f"- views: {fmt(v['stats']['playCount'])}")
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
            a(f"###### {vn.upper().replace('_', ' ')}\n")
            a(f"- video_id: {m['video_id']}")
            a(f"- creator: {m.get('creator') or ND}")
            a(f"- views: {m['views']:,}")
            a(f"- save_rate: {m['save_rate']}%")
            # 桁を fmt に揃える。生値のままだと 4.1% だけ1桁になり、
            # 他ページの 4.97% / 6.08% と並んだとき別種の数字に見える
            a(f"- eg: {fmt(float(m['eg']), '%')}" if m.get('eg') is not None else f"- eg: {ND}")
            a(f"- frames_seen: {m['frames_seen']}")
            a(f"- frames_range: {m['frames_range']}")
            a(f"- sb_frames: {m['sb_frames']}")
            a(f"- url: {m['url']}")
            a(f"- title: {m.get('title_src') or ND}")
            a("")
            a("###### Images")
            a(f"- main_image_path: assets/client_01/{bid}/{vn}/main.jpg")
            a("")
            a("###### Storyboard")
            for j, num in enumerate(m["sb_frames"].split("/"), start=1):
                a(f"- sb{j}_path: assets/client_01/{bid}/{vn}/sb{j}.jpg")
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
        vs = load_axis(case_dir, k["file"])

        def kast(rel, v=None):
            return asset_or_nd(case_dir, f"assets/client_01/{kid}/{rel}", v)

        srs = [x for x in (srate(v) for v in vs) if x is not None]
        pr, _org_x, pr_unknown = pr_sets(vs)
        a(f"## KEYWORD {ki:02d}\n")
        a(f"- keyword: {k['name']}")
        a(f"- total_count: {len(vs)}")
        a(f"- acquisition_note: {acq_note(cfg, k['name'], len(vs))}")
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
            a(f"- views: {fmt(v['stats']['playCount'])}")
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
        a(f"- media_mix: {media_mix(vs)}")
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
        tops = sorted([v for v in save_pool if v["stats"]["playCount"]],
                      key=lambda v: srate(v) or 0, reverse=True)[:5]
        for i, v in enumerate(tops, start=1):
            au = v.get("author") or {}
            a(f"#### SAVE {i}")
            a(f"- rank: {vs.index(v) + 1}")
            a(f"- creator: {au.get('nickname') or au.get('uniqueId')}")
            a(f"- views: {fmt(v['stats']['playCount'])}")
            a(f"- saves: {fmt(v['stats']['collectCount'])}")
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
        own = next((b["name"] for b in cfg["brands"] if b.get("own")), None)
        a("# KEYWORD CROSS SUMMARY\n")
        a(f"- whitespace: {ND}")
        a("")
        for ki, k in enumerate(cfg["keywords"], start=1):
            vs = load_axis(case_dir, k["file"])
            srs = [x for x in (srate(v) for v in vs) if x is not None]
            pr, _org_x, pr_unknown = pr_sets(vs)
            hit = market.get(k["name"], {}).get(own, 0) if own else 0
            a(f"## KW SUMMARY {ki:02d}\n")
            a(f"- keyword: {k['name']}")
            kind = (cfg.get("acquisition") or {}).get(k["name"])
            a(f"- total_count: {len(vs)}"
              + ("（母数未確定）" if (kind in ("capped", "unknown", "no_new")
                  or (kind is None and len(vs) >= CEILING_HINT)) else ""))
            a((f"- pr_share: {len(pr) / len(vs) * 100:.1f}%"
               + (f"（{len(pr_unknown)}本は判定不可のため下限）" if pr_unknown else ""))
              if vs else f"- pr_share: {ND}")
            a(f"- avg_save_rate: {fmt(st.median(srs) if srs else None, '%')}")
            a(f"- save_rate_basis: 中央値")
            a(f"- save_type: {ND}")
            a(f"- own_exposure: {hit}本")
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
