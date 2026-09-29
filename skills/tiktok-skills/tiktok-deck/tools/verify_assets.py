#!/usr/bin/env python3
"""verify_assets.py — 画像とキャプションの取り違えを検知する

なぜ要るか:
  画像は top01.jpg / list01.jpg のように「順位」で名前が付いている。
  順位の決め方を変えると（例：率の順位に再生数の下限を入れる）本文の順位だけが
  変わり、画像は旧順位のまま残る。実際にある案件で、63再生の投稿のカバーに
  142,300再生の別人の名前と数値が付いた状態が4ページ生まれた。
  ファイル名が順位である限りこの事故は再発するので、機械で不変条件を確かめる。

不変条件（INPUT.md だけで判定できる）:
  1. 同じ url（＝同じ動画）を宣言している画像は、バイト一致していなければならない
  2. 違う url を宣言している画像が、バイト一致していてはならない
  3. 宣言された画像ファイルは実在しなければならない

使い方:
  python3 tools/verify_assets.py --case <案件ディレクトリ>
  問題があれば終了コード 1
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import os
import re
import sys
import zipfile
from collections import defaultdict

ND = "[DATA NOT PROVIDED]"
# レンダラ（src/generate.js）が付ける出力名の接頭辞。
# ここを変えるときは generate.js の出力名も合わせること
RENDERER_PREFIX = "TikTok_Competitive_Research"
# 画像には2系統ある。混ぜて比べると、同じ動画の「検索結果のカバー」と
# 「動画から抜いたコマ」が食い違っていると誤検知する（実際に6件出た）
COVER_KEYS = ("image_path", "thumb_path", "representative_image")   # 検索結果のカバー
FRAME_KEYS = ("main_image_path",)                                    # 動画から抜いたコマ
FAMILIES = {"カバー": COVER_KEYS, "コマ": FRAME_KEYS}
RELEVANT = set(COVER_KEYS) | set(FRAME_KEYS) | {"url"}


# 1件（＝1動画や1ブランド）の始まりになる見出し。これ以外の小見出しでは
# ブロックを切らない。切ると url と image_path が別ブロックに分かれ、
# 照合対象から静かに外れる（実際に11件が照合不能になっていた）
RECORD_START = re.compile(
    r"^#+\s*(BRAND|KEYWORD|VIDEO|TOP VIDEO|KWVIDEO|LIST|SAVE|HEAD|Cluster|PLATFORM)\b",
    re.I)


def blocks(text: str):
    """`- key: value` の並びを、1件ぶんのブロックにまとめて返す。
    小見出しをまたいでも同じ1件として扱う"""
    cur: dict[str, str] = {}
    out = []
    for line in text.split("\n"):
        if line.startswith("#"):
            if RECORD_START.match(line):
                if cur:
                    out.append(cur)
                cur = {}
            continue
        m = re.match(r"^-\s+([A-Za-z0-9_]+)\s*:\s*(.*)$", line)
        if m:
            k, v = m.group(1), m.group(2).strip()
            # 先勝ち/後勝ちを選ぶと、どちらでも片方が黙って検査対象から外れる。
            # 1件の中に同じキーが二度出るのは構造の異常なので、そこで止める
            # 照合に使うキー（url と画像パス）が1件の中で二度出るのは構造の異常。
            # 先勝ち/後勝ちを選ぶとどちらでも片方が黙って検査対象から外れるので、止める。
            # それ以外のキー（post_count 等）は見出しの粒度で自然に重なるため無視する
            if k in RELEVANT and k in cur and cur[k] != v:
                raise SystemExit(
                    f"[致命的] 同じブロック内にキー {k} が重複しています"
                    f"（{cur[k]!r} と {v!r}）。見出しの区切りか builder の出力を確認してください")
            cur[k] = v
    if cur:
        out.append(cur)
    return out


def digest(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()




def check_pptx(case_dir, rel_pptx=None):
    """出荷物（PPTX）に埋め込まれた画像が、案件内の実ファイルと一致すること。

    INPUT.md が正しくても、レンダラが古い画像を掴んでいれば紙面は間違う。
    出荷物そのものを見ないと、その経路は検知できない。

    ファイル名を1つに決め打ちしてはいけない。レンダラは資料モードごとに
    接尾辞を付けるので（_初訪 / _構成 / _競合差 / _レポート）、
    決め打ちすると具体提案以外の全モードで「PPTX が無い」と判断し、
    このゲートが常に「問題なし」を返す。実際にそうなっていた。
    output/ にあるものは全部見る。
    """
    out_dir = os.path.join(case_dir, "output")
    others = []
    if rel_pptx:
        targets = [os.path.join(case_dir, rel_pptx)]
    elif os.path.isdir(out_dir):
        every = sorted(glob.glob(os.path.join(out_dir, "*.pptx")))
        every = [t for t in every if not os.path.basename(t).startswith("~$")]
        # レンダラが作ったものだけを判定対象にする。output/ には
        # 人が PowerPoint で開いて画像を差し替えた版や、名前を変えた納品版が並ぶ。
        # それらを同じ基準で見ると、人が入れた画像を「案件外の画像」と誤検知する
        targets = [t for t in every if os.path.basename(t).startswith(RENDERER_PREFIX)]
        others = [t for t in every if t not in targets]
    else:
        targets = []
    targets = [t for t in targets if os.path.exists(t)]
    if not targets:
        msg = ["[情報] レンダラ出力の PPTX が output/ に無いため出荷物の照合は省略"]
        if others:
            msg.append("[情報] 照合対象外（レンダラ出力ではない）: "
                       + "、".join(os.path.basename(t) for t in others))
        return msg
    known = {}
    for root, _dirs, files in os.walk(case_dir):
        if os.path.basename(root).startswith(("output", "render", "node_modules", "media_run")):
            continue
        for f in files:
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                full = os.path.join(root, f)
                known.setdefault(digest(full), os.path.relpath(full, case_dir))
    out = []
    for path in targets:
        name = os.path.relpath(path, case_dir)
        try:
            z = zipfile.ZipFile(path)
        except zipfile.BadZipFile as e:
            # 壊れたファイルで検査全体を落とすと、判定が1行も出ない。
            # 何が悪いのか読み手に伝わらないので、そのファイルだけ外して続ける
            out.append(f"[重大] {name} が PPTX として開けない（{e}）。"
                       "PowerPoint で開いたまま保存が終わっていない可能性があります")
            continue
        with z:
            # ディレクトリエントリ（末尾 /）を除く。除かないと空バイト列が1件混ざる
            media = [n for n in z.namelist()
                     if n.startswith("ppt/media/") and not n.endswith("/")]
            for n in media:
                h = hashlib.sha256(z.read(n)).hexdigest()
                if h not in known:
                    out.append(f"[致命的] {name} の画像が案件内のどのファイルとも一致しない: {n}")
    out.insert(0, f"[情報] 照合した出荷物 {len(targets)} 件: "
                  + "、".join(os.path.basename(t) for t in targets))
    if others:
        out.insert(1, "[情報] 照合対象外（レンダラ出力ではない。人手で編集・改名した版）: "
                      + "、".join(os.path.basename(t) for t in others))
    return out


def check_storyboard(case_dir, text):
    """コマ画像は、そのページが宣言する動画の『そのコマ番号』と一致していること。

    「frames/<id>/ のどれかと一致」では弱い。02 のコマが 05 のバッジの下に
    置かれている、という一番起きやすい取り違えが通ってしまう。
    バッジ番号（sbN_label の先頭「NN:」）まで含めて突き合わせる。
    """
    out = []
    for b in blocks(text):
        url = b.get("url", "")
        frames = b.get("sb_frames", "")
        if not url or ND in url or not frames or ND in frames:
            continue
        m = re.search(r"/video/(\d+)", url)
        if not m:
            continue
        vid = m.group(1)
        # frames/<id>/ が無い案件は、コマ画像を別経路で作っている（初期に作った案件がそう）。
        # 照合できないことと、照合して不一致だったことは別物なので分ける
        if not os.path.isdir(os.path.join(case_dir, "frames", vid)):
            out.append(f"[情報] 元コマのディレクトリが無く照合できない: frames/{vid}/"
                       f"（この案件は extract_frames.py を通していない）")
            continue
        nums = [x.strip() for x in frames.split("/") if x.strip()]
        for i, num in enumerate(nums, start=1):
            rel = b.get(f"sb{i}_path", "")
            if not rel or ND in rel:
                continue
            src = os.path.join(case_dir, "frames", vid, f"{num}.jpg")
            dst = os.path.join(case_dir, rel)
            if not os.path.exists(src):
                out.append(f"[致命的] 元コマが無い: frames/{vid}/{num}.jpg（{rel} の出どころ）")
                continue
            if not os.path.exists(dst):
                out.append(f"[致命的] 掲載コマが無い: {rel}")
                continue
            if digest(src) != digest(dst):
                out.append(f"[致命的] コマ {num} の画像が元フレームと違う: {rel} ≠ frames/{vid}/{num}.jpg")
            # バッジ番号（ラベル先頭の「NN:」）と sb_frames の並びがずれていないか
            lab = b.get(f"sb{i}_label", "")
            lm = re.match(r"\s*(\d{2})\s*[:：]", lab)
            if lm and lm.group(1) != num:
                out.append(f"[致命的] コマ番号の食い違い: {rel} は {num} のはずが"
                           f"ラベルは「{lm.group(1)}:」（{url}）")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True)
    ap.add_argument("--input", default="INPUT.md")
    ap.add_argument("--allow-unverified", action="store_true",
                    help="照合できない参照が残っていても通す（承知のうえで進めるとき）")
    args = ap.parse_args()
    allow_unverified = args.allow_unverified
    case_dir = os.path.abspath(os.path.expanduser(args.case))
    text = open(os.path.join(case_dir, args.input), encoding="utf-8").read()

    # url を宣言している画像だけを対象にする（url が無いブロックは照合しようがない）
    missing: list[str] = []
    unlinked: list[str] = []
    findings: list[str] = []
    seen = 0
    urls_total: set[str] = set()

    for fam, keys in FAMILIES.items():
        by_url: dict[str, set[str]] = defaultdict(set)
        by_hash: dict[str, set[str]] = defaultdict(set)
        for b in blocks(text):
            url = b.get("url", "")
            for k in keys:
                rel = b.get(k, "")
                if not rel or ND in rel:
                    continue
                full = os.path.join(case_dir, rel)
                if not os.path.exists(full):
                    missing.append(rel)
                    continue
                seen += 1
                if not url or ND in url:
                    unlinked.append(f"{rel}（{k}）")
                    continue
                by_url[url].add(rel)
                by_hash[digest(full)].add(url)
        urls_total |= set(by_url)
        for url, rels in by_url.items():
            if len({digest(os.path.join(case_dir, r)) for r in rels}) > 1:
                findings.append(
                    f"[致命的] 同じ動画を指す{fam}画像が食い違っている\n"
                    f"          {url}\n"
                    + "".join(f"          - {r}（{digest(os.path.join(case_dir, r))[:12]}）\n"
                              for r in sorted(rels)))
        for h, urls in by_hash.items():
            if len(urls) > 1:
                findings.append(
                    f"[致命的] 同じ{fam}画像が別々の動画として使われている（{h[:12]}）\n"
                    + "".join(f"          - {u}\n" for u in sorted(urls)))
    for rel in sorted(set(missing)):
        findings.append(f"[致命的] 宣言された画像が存在しない: {rel}")
    findings += check_storyboard(case_dir, text)
    findings += check_pptx(case_dir)

    print(f"verify_assets: {os.path.basename(case_dir)}")
    print(f"  照合できた画像 : {len(urls_total)} 動画 / 参照 {seen} 件")
    if unlinked:
        # url が無い画像は照合できない。落とし穴が残っている状態なので黙らせない
        print(f"  url 未宣言のため照合できなかった参照 : {len(unlinked)} 件")
        for u in unlinked[:8]:
            print(f"    - {u}")
        if len(unlinked) > 8:
            print(f"    …ほか {len(unlinked) - 8} 件")
    fatal = [f for f in findings if f.startswith("[致命的")]
    major = [f for f in findings if f.startswith("[重大")]
    info = [f for f in findings if not f.startswith(("[致命的", "[重大"))]
    if info:
        print(f"\n  情報 {len(info)} 件")
        for f in info:
            print(f"  {f}")
    if major:
        print(f"\n  重大 {len(major)} 件\n")
        for f in major:
            print(f"  {f}")
    if fatal:
        print(f"\n  問題 {len(fatal)} 件\n")
        for f in fatal:
            print(f"  {f}")
        return 1

    # 「照合できなかった」を「問題なし」と言わない。
    # ある案件では sbN_path が102件あるのに frames/ が無く、
    # コマ照合の実施率が0%のまま「問題なし・exit=0」を返していた
    unverified = len(unlinked) + len([f for f in info if "照合できない" in f])
    if unverified or major:
        print(f"\n  食い違いは見つかりませんでした。ただし {unverified} 件は照合できていません。")
        print("  照合できていない参照は「問題なし」ではありません。")
        print("  コマ画像は extract_frames.py を通すと照合できるようになります。")
        print("  承知のうえで進める場合は --allow-unverified を付けてください。")
        if not allow_unverified:
            return 1
        print("  （--allow-unverified が指定されたので通します）")
        return 0
    print("  問題なし（照合できなかった参照はありません）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
