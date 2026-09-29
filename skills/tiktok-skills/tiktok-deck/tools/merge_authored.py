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

対応するキー:
  brand_NN q1_insight / q2_insight / q3_insight / q4_insight / q5_insight
  kw_NN head_insight / save_pattern / cluster_mix / composition_insight

使い方:
  python3 tools/merge_authored.py --case <案件ディレクトリ>
"""
from __future__ import annotations

import argparse
import os
import re

ND = "[DATA NOT PROVIDED]"

# 散文キー → (どのセクション内か, 行の接頭辞)
BRAND_KEYS = {
    "q1_insight": ("Q1 Insight", "- insight: "),
    "q2_insight": ("Q2 PR vs Organic", "- insight: "),
    "q3_insight": ("Q3 Content Clusters", "- insight: "),
    "q4_insight": ("Q4 Product / Context", "- insight: "),
    "q5_insight": ("Q5 Top Videos", "- q5_insight: "),
}
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True)
    ap.add_argument("--mechanical", default="INPUT_mechanical.md")
    ap.add_argument("--authored", default="authored.md")
    ap.add_argument("--out", default="INPUT.md")
    ap.add_argument("--list-keys", action="store_true",
                    help="authored.md に書けるキー名を一覧する")
    args = ap.parse_args()

    if args.list_keys:
        # 書式が分からず「流し込み0件」で詰まる人が出たので、
        # ソースを読まなくてもキー名が分かるようにする
        print("authored.md に書ける見出しの形:\n")
        print("    ## FIELD <対象> <キー名>")
        print("    本文をここに書く（複数行可）\n")
        print("ブランド軸（<対象> は brand_01 のような番号）:")
        for k, (sec, _) in BRAND_KEYS.items():
            print(f"  {k:<22} → {sec}")
        print("\n検索ワード軸（<対象> は kw_01 のような番号）:")
        for k, (sec, _) in KW_KEYS.items():
            print(f"  {k:<22} → {sec}")
        print("\nそのまま末尾に足すブロック:")
        print("    ## APPEND CROSS   … # CROSS ANALYSIS 以下を丸ごと足す")
        print("\n流し込んだあと「流し込んだ散文: N 欄」の N を必ず見ること。")
        print("0 なら書式が合っていない。")
        return 0
    case_dir = os.path.abspath(os.path.expanduser(args.case))

    mech = open(os.path.join(case_dir, args.mechanical), encoding="utf-8").read()
    fields, appends, defaults = parse_authored(os.path.join(case_dir, args.authored))

    lines = mech.split("\n")
    out: list[str] = []
    scope = None       # brand_01 / kw_01
    sec = None
    used: set[tuple[str, str]] = set()

    for ln in lines:
        m = re.match(r"^#### BRAND (\d+)", ln)
        if m:
            scope = f"brand_{int(m.group(1)):02d}"
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
            base = scope.split("/")[0]
            scope = f"{base}/video_{int(m.group(1)):02d}"
        for tag in SECTION_TAGS:
            # 「## KW SUMMARY 01」のように見出しの末尾が番号になる形もあるため、
            # 末尾一致ではなく見出し行に含まれるかで判定する
            if ln.startswith("#") and tag in ln:
                sec = tag
        replaced = False
        if scope and ND in ln:
            table = BRAND_KEYS if scope.startswith("brand_") else KW_KEYS
            for key, (want_sec, prefix) in table.items():
                if sec == want_sec and ln.startswith(prefix) and (scope, key) in fields:
                    out.append(prefix + fields[(scope, key)].replace("\n", " "))
                    used.add((scope, key))
                    replaced = True
                    break
        if not replaced and scope in ("kw_cross",) and ND in ln:
            m = re.match(r"^-\s+([A-Za-z0-9_]+):\s*", ln)
            if m and (scope, m.group(1)) in fields:
                out.append(f"- {m.group(1)}: "
                           + fields[(scope, m.group(1))].replace("\n", " "))
                used.add((scope, m.group(1)))
                replaced = True
        if not replaced and scope and "/video_" in scope and ND in ln:
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

    open(os.path.join(case_dir, args.out), "w", encoding="utf-8").write(body)

    missing = sorted(set(fields) - used)
    print(f"→ {os.path.join(case_dir, args.out)}")
    print(f"流し込んだ散文: {len(used)} 欄 / 既定値: {len(defaults)} 種 / 追記ブロック: {len(appends)}")
    print(f"残る未記入: {body.count(ND)} 箇所")
    if missing:
        print("\n[注意] authored.md にあるが差し込めなかったキー（綴りかセクション名を確認）:")
        for scope, key in missing:
            print(f"  - {scope} {key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
