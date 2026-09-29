#!/usr/bin/env python3
"""merge_authored.py — 機械欄（自動生成）と散文欄（人／Claudeが書いた分）を合成して INPUT.md を作る

なぜ分けるか:
  機械欄は取得し直すたびに再生成される。散文を INPUT.md に直接書くと、
  再生成のたびに消える（実際に KEEP/IMPROVE/TRY を失った）。
  そこで散文は authored.md に置き、合成時に流し込む。

authored.md の形（案件ディレクトリに置く）:

    # AUTHORED

    ## FIELD brand_01 q1_insight
    実質98本の投稿者は…（本文）

    ## FIELD kw_01 head_insight
    244本で最大の面。…

    ## APPEND CROSS
    # CROSS ANALYSIS
    …（そのまま INPUT.md の末尾に足すブロック）

対応するキー（一覧は --list-keys。APPEND ブロックの雛形も出る）:
  brand_NN        q1_insight〜q5_insight / q4_products（1行1商品）
  brand_NN/top_NN content_summary（Q5 の TOP VIDEO NN）
  brand_NN/video_NN  8軸（hook_0_3_sec 等）と sbN_label（VIDEO ANALYSIS の VIDEO NN）
  kw_NN           head_insight / save_pattern / cluster_mix / composition_insight / save_type
  kw_cross        whitespace（検索ワード横断の空白地帯）

INPUT.md は毎回まるごと作り直す。前回の合成のあとに INPUT.md が手で直されていたら止める
（手で書いた8軸が次の合成で黙って消えた）。直した内容を authored.md に移してから再実行する。
承知のうえで捨てるときだけ --force。

使い方:
  python3 tools/merge_authored.py --case <案件ディレクトリ>
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    # 日本語 Windows（cp932）のパイプ越しで表示できない字があっても落とさない
    try:
        _s.reconfigure(errors="replace")
    except (AttributeError, ValueError):
        pass

ND = "[DATA NOT PROVIDED]"
# INPUT.md の先頭に置く合成の印。inputParser.js は HTML コメントを読み飛ばす
STAMP = re.compile(r"^<!-- merge_authored sha256=([0-9a-f]{64}) -->\n")

# 散文キー → (どのセクション内か, 行の接頭辞)
BRAND_KEYS = {
    "q1_insight": ("Q1 Insight", "- insight: "),
    "q2_insight": ("Q2 PR vs Organic", "- insight: "),
    "q3_insight": ("Q3 Content Clusters", "- insight: "),
    "q4_insight": ("Q4 Product / Context", "- insight: "),
    # 商品名は本文から機械で拾えない。書く場所が無く、全欄を埋めても Q4 に欠損が残っていた
    "q4_products": ("Q4 Product / Context", "1. "),
    "q5_insight": ("Q5 Top Videos", "- q5_insight: "),
}
# 1行を複数行の番号付きリストに展開するキー（本文の1行＝1項目）
LIST_KEYS = {"q4_products"}
# VIDEO ANALYSIS の VIDEO NN に書くキー（build_input_md.py の出力と同じ名前）
VIDEO_KEYS = ["hook_0_3_sec", "hook_summary", "visual_killer", "visual_note", "text_note", "price",
              "brand_exposure", "cta", "comparison_structure", "final_frame", "observed_limits",
              "success_or_failure_hypothesis", "one_line_essence", "sb1_label〜sb5_label"]
KW_KEYS = {
    "save_type": ("KW SUMMARY", "- save_type: "),
    "head_insight": ("Findings", "- head_insight: "),
    "save_pattern": ("Findings", "- save_pattern: "),
    "cluster_mix": ("Head Composition", "- cluster_mix: "),
    "composition_insight": ("Head Composition", "- insight: "),
}
SECTION_TAGS = ["Q1 Insight", "Q2 PR vs Organic", "Q3 Content Clusters",
                "Q4 Product / Context", "Q5 Top Videos", "Findings", "Head Composition",
                "KW SUMMARY"]


def parse_authored(path: str):
    """authored.md → {(scope, key): text}, [追記ブロック], {field: 既定文}"""
    fields: dict[tuple[str, str], str] = {}
    appends: list[str] = []
    defaults: dict[str, str] = {}
    if not os.path.exists(path):
        return fields, appends, defaults
    cur_key = None
    cur_append = None
    in_defaults = False
    buf: list[str] = []

    def flush():
        nonlocal cur_key, cur_append, buf
        body = "\n".join(buf).strip()
        if cur_key and body:
            fields[cur_key] = body
        if cur_append is not None and body:
            appends.append(body)
        cur_key = cur_append = None
        buf = []

    for line in open(path, encoding="utf-8"):
        m = re.match(r"^##\s+FIELD\s+(\S+)\s+(\S+)\s*$", line)
        if m:
            flush()
            cur_key = (m.group(1), m.group(2))
            in_defaults = False
            continue
        m = re.match(r"^##\s+APPEND\s+\S+\s*$", line)
        if m:
            flush()
            cur_append = True
            in_defaults = False      # DEFAULTS を抜ける。抜けないと本文が捨てられる
            continue
        if re.match(r"^##\s+DEFAULTS\s*$", line):
            flush()
            in_defaults = True
            continue
        if in_defaults:
            m = re.match(r"^-\s+([A-Za-z0-9_]+)\s*:\s*(.+)$", line)
            if m:
                defaults[m.group(1)] = m.group(2).strip()
                continue
            if line.startswith("##"):
                in_defaults = False
            else:
                continue
        # 完全一致で判定する。startswith だと追記ブロック側の
        # 「# CROSS ANALYSIS」等の見出しまで落としてしまう（実際に落ちた）
        if line.strip() == "# AUTHORED":
            continue
        buf.append(line.rstrip("\n"))
    flush()
    return fields, appends, defaults


# APPEND で足すブロックの雛形。inputParser.js が読む見出しの形そのもの。
# この形がどの文書にも無く（INPUT_TEMPLATE.md は存在しない）、示唆（KEEP/IMPROVE/TRY）・
# Q8・勝ちパターンを書く手段が分からないまま [DATA NOT PROVIDED] が残っていた
APPEND_SKELETON = """\
## APPEND CROSS
# CROSS ANALYSIS
## CLIENT 01
### PR vs Organic
- pr_organic_insight: （横断サマリーの結論）
- video_cross_conclusion: （Q8 の横断結論）
### Hook Cross
- hook_cross_analysis: （Q8 冒頭の型）
### Visual Cross
- visual_cross_analysis: （Q8 視覚演出の型）
### High EG
- （Q8 最終コマと保存率。1行1項目）
### Low EG
- （Q8 保存率を説明しなかった要因。1行1項目）
### Winning Patterns
#### Pattern 01
- name: （型の名前）
- example_videos: （該当動画）
- hook:
- development:
- killer_visual:
- product_proof:
- cta:
- success_conditions:
- failure_conditions:
### Final Message
- final_message: （示唆ページ下の結論）
### Final Recommendations
#### KEEP
- （1行1項目。行頭に [deep] [構成提案] 等の印を付けるとそのモードの資料にだけ出る）
#### IMPROVE
- ...
#### TRY
- ...

## APPEND REVIEWS      … # REVIEWS（形は SKILL_GUIDE.md「口コミ章の入力」）
## APPEND PLATFORMS    … # OTHER PLATFORMS > ## PLATFORM <名> > - name/purpose/summary/insight/limits/
                          coverage_note と ### Post Types・### Official Accounts の表
## APPEND KWVIDEO      … # KEYWORD VIDEO ANALYSIS > ## KWAXIS <ワード> > ###### KWVIDEO 01
                          （中身は VIDEO ANALYSIS の VIDEO NN と同じ）
"""


def body_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=False)
    ap.add_argument("--mechanical", default="INPUT_mechanical.md")
    ap.add_argument("--authored", default="authored.md")
    ap.add_argument("--out", default="INPUT.md")
    ap.add_argument("--list-keys", action="store_true",
                    help="authored.md に書けるキー名を一覧する")
    ap.add_argument("--force", action="store_true",
                    help="INPUT.md が手で直されていても上書きする（直した内容は消える）")
    args = ap.parse_args()

    if args.list_keys:
        # 書式が分からず「流し込み0件」で詰まる人が出たので、
        # ソースを読まなくてもキー名が分かるようにする
        print("authored.md に書ける見出しの形:\n")
        print("    ## FIELD <対象> <キー名>")
        print("    本文をここに書く（複数行可）\n")
        print("ブランド軸（<対象> は brand_01 のような番号）:")
        for k, (sec, _) in BRAND_KEYS.items():
            print(f"  {k:<22} → {sec}" + ("（1行1商品）" if k in LIST_KEYS else ""))
        print("\nQ5 の上位投稿（<対象> は brand_01/top_01。TOP VIDEO 01 が紙面に出る）:")
        print(f"  {'content_summary':<22} → 投稿の中身を一言")
        print("\n解剖した動画（<対象> は brand_01/video_01。video_manifest.json の video_no）:")
        for k in VIDEO_KEYS:
            print(f"  {k}")
        print("  ※ 8軸は INPUT.md に直接書かない。次の合成で消える")
        print("\n検索ワード軸（<対象> は kw_01 のような番号）:")
        for k, (sec, _) in KW_KEYS.items():
            print(f"  {k:<22} → {sec}")
        print("\n検索ワード横断（<対象> は kw_cross）:")
        print(f"  {'whitespace':<22} → Q6総括の結論（空白地帯）")
        print("\nそのまま末尾に足すブロック（見出しの形を変えると読まれない）:\n")
        print(APPEND_SKELETON)
        print("流し込んだあと「流し込んだ散文: N 欄」の N を必ず見ること。")
        print("0 なら書式が合っていない。")
        return 0
    if not args.case:
        ap.error("--case が必要です（--list-keys のときだけ省略可）")
    case_dir = os.path.abspath(os.path.expanduser(args.case))

    mech = open(os.path.join(case_dir, args.mechanical), encoding="utf-8").read()
    fields, appends, defaults = parse_authored(os.path.join(case_dir, args.authored))

    lines = mech.split("\n")
    out: list[str] = []
    scope = None       # brand_01 / brand_01/top_01 / brand_01/video_01 / kw_01 / kw_cross
    sec = None
    used: set[tuple[str, str]] = set()

    def put(key, prefix, text):
        """本文を1行にして差し込む。LIST_KEYS は1行1項目の番号付きリストに展開する"""
        if key in LIST_KEYS:
            items = [re.sub(r"^\s*(?:\d+\.|[-・])\s*", "", x).strip() for x in text.split("\n")]
            out.extend(f"{n}. {x}" for n, x in enumerate([x for x in items if x], start=1))
        else:
            out.append(prefix + text.replace("\n", " "))

    for ln in lines:
        m = re.match(r"^#### BRAND (\d+)", ln)
        if m:
            scope = f"brand_{int(m.group(1)):02d}"
        # ブランド内の節（##### Q1…／##### VIDEO LIST 等）が変わったら、動画・上位投稿の小さな対象から抜ける。
        # 抜けないと TOP VIDEO 03 の後ろの q5_insight が brand_01/top_03 の欄として探され、差し込めない
        if re.match(r"^#####\s", ln) and scope and scope.startswith("brand_"):
            scope = scope.split("/")[0]
        # KEYWORD は「# KEYWORD AXES」配下の「## KEYWORD NN」。見出しレベルを固定しない
        m = re.match(r"^#{1,3}\s*KEYWORD\s+(\d+)", ln)
        if m:
            scope = f"kw_{int(m.group(1)):02d}"
        if re.match(r"^#\s*KEYWORD CROSS SUMMARY", ln):
            scope = "kw_cross"
        m = re.match(r"^##\s*KW SUMMARY\s+(\d+)", ln)
        if m:
            scope = f"kw_{int(m.group(1)):02d}"
        m = re.match(r"^###### VIDEO (\d+)", ln)
        if m and scope and scope.startswith("brand_"):
            scope = f"{scope.split('/')[0]}/video_{int(m.group(1)):02d}"
        m = re.match(r"^###### TOP VIDEO (\d+)", ln)
        if m and scope and scope.startswith("brand_"):
            scope = f"{scope.split('/')[0]}/top_{int(m.group(1)):02d}"
        for tag in SECTION_TAGS:
            # 「## KW SUMMARY 01」のように見出しの末尾が番号になる形もあるため、
            # 末尾一致ではなく見出し行に含まれるかで判定する
            if ln.startswith("#") and tag in ln:
                sec = tag
        replaced = False
        if scope and ND in ln and scope != "kw_cross":
            # 節ごとのキーは、上位投稿・動画の中にいても親のブランドで探す
            # （Q5 の q5_insight は TOP VIDEO 03 の直後の行にある）
            base = scope.split("/")[0]
            table = BRAND_KEYS if base.startswith("brand_") else KW_KEYS
            for key, (want_sec, prefix) in table.items():
                if sec == want_sec and ln.startswith(prefix) and (base, key) in fields:
                    put(key, prefix, fields[(base, key)])
                    used.add((base, key))
                    replaced = True
                    break
        # kw_cross・brand_NN/top_NN・brand_NN/video_NN は「- キー: [DATA NOT PROVIDED]」をキー名で埋める
        if not replaced and scope and ("/" in scope or scope == "kw_cross") and ND in ln:
            m = re.match(r"^-\s+([A-Za-z0-9_]+):\s*", ln)
            if m and (scope, m.group(1)) in fields:
                out.append(f"- {m.group(1)}: "
                           + fields[(scope, m.group(1))].replace("\n", " "))
                used.add((scope, m.group(1)))
                replaced = True
        if not replaced and ND in ln:
            m = re.match(r"^-\s+([A-Za-z0-9_]+):\s*", ln)
            if m and m.group(1) in defaults:
                out.append(f"- {m.group(1)}: {defaults[m.group(1)]}")
                replaced = True
            elif re.match(r"^\d+\.\s*\[DATA NOT PROVIDED\]", ln) and "list_item" in defaults:
                out.append(re.sub(r"\[DATA NOT PROVIDED\]", defaults["list_item"], ln))
                replaced = True
        if not replaced:
            out.append(ln)

    body = "\n".join(out)
    for blk in appends:
        body += "\n\n" + blk + "\n"

    out_path = os.path.join(case_dir, args.out)
    # 前回の合成のあとで INPUT.md が手で直されていたら上書きしない。
    # 8軸を INPUT.md に直接書くよう案内していた時期があり、次の合成で全部消えた（実際に失った）
    if os.path.exists(out_path) and not args.force:
        prev = open(out_path, encoding="utf-8").read()
        pm = STAMP.match(prev)
        if pm and body_hash(prev[pm.end():]) != pm.group(1):
            print(f"[停止] {out_path} は前回の合成のあとで手で直されています。上書きすると直した内容が消えます。\n"
                  "  直した散文は authored.md の ## FIELD（--list-keys）へ移してから再実行してください。\n"
                  "  捨ててよい場合だけ --force を付けます。", file=sys.stderr)
            return 1
        if not pm and prev.strip() and prev != body:
            # 印の無い INPUT.md（この版より前に作ったもの・手で作ったもの）は判定できない。止めずに知らせる
            print(f"[注意] {out_path} に合成の印が無いため、手で直した箇所があるか確かめられません。"
                  "上書きします（以後は印を付けるので、手で直すと次回は止まります）")

    open(out_path, "w", encoding="utf-8").write(
        f"<!-- merge_authored sha256={body_hash(body)} -->\n" + body)

    missing = sorted(set(fields) - used)
    print(f"→ {out_path}")
    print(f"流し込んだ散文: {len(used)} 欄 / 既定値: {len(defaults)} 種 / 追記ブロック: {len(appends)}")
    print(f"残る未記入: {body.count(ND)} 箇所")
    if missing:
        print("\n[注意] authored.md にあるが差し込めなかったキー（綴りかセクション名を確認）:")
        for scope, key in missing:
            hint = ""
            if scope == "global":
                hint = "（global という対象は無い。検索ワード横断の空白地帯は kw_cross whitespace）"
            print(f"  - {scope} {key}{hint}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
