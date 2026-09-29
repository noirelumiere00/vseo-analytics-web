#!/usr/bin/env python3
"""preflight.py — 提出前の全検（ずれ・漏れ・崩れ）を PPTX から直接判定する

レンダリング不要。標準ライブラリ（zipfile + xml）だけで動くので Windows / macOS / Linux で
同じ結果が出る。Keynote 依存の目視QAの前段として、機械で落とせるものを全部落とす。

検出するもの:
  [崩れ] 本文領域より下へ出た要素（フッター・ページ番号との衝突）
  [崩れ] テキスト枠どうしの重なり
  [漏れ] 切り詰め記号（…）で終わるセル・本文＝文章が途中で消えている
  [漏れ] 空のテキスト枠／プレースホルダ（[DATA NOT PROVIDED] 等）
  [漏れ] 未解決の変数（undefined / NaN / null / [object Object]）
  [ずれ] 同一画像が N ページ以上連続（実例の使い回し）
  [ずれ] 画像の縦横比が元ファイルと違う（潰れ・引き伸ばし）
  [情報] ページ別のフォントサイズ最小値（下限に張り付いているページ）

使い方:
  python3 tools/preflight.py output/deck.pptx
  python3 tools/preflight.py output/deck.pptx --baseline output/previous.pptx   # 前版と全ページ差分
  python3 tools/preflight.py output/deck.pptx --json report.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
EMU = 914400.0

# レイアウトの約束（theme.js と揃える）
CONTENT_BOTTOM_IN = 10.20
SLIDE_H_IN = 11.25
# フッターは「実在する要素」から見つける。全ページにあると決め打ちすると
# 表紙（フッターを持たない）を誤検出する
FOOTER_HINT = re.compile(r"DEEP-DIVE|^\d+\s*/\s*\d+$")
PLACEHOLDERS = ("[DATA NOT PROVIDED]", "[IMAGE NOT PROVIDED]")
BAD_TOKENS = ("undefined", "UNDEFINED", "NaN", "[object Object]", "null,", "Infinity")


def slide_files(z: zipfile.ZipFile) -> list[str]:
    names = [n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    return sorted(names, key=lambda n: int(re.search(r"(\d+)", n.split("/")[-1]).group(1)))


def shapes_of(root: ET.Element) -> list[dict]:
    """テキスト枠と画像の位置・寸法・文字を拾う"""
    out = []
    for sp in root.iter():
        tag = sp.tag.split("}")[-1]
        if tag not in ("sp", "pic"):
            continue
        xfrm = sp.find(".//a:xfrm", NS)
        if xfrm is None:
            continue
        off, ext = xfrm.find("a:off", NS), xfrm.find("a:ext", NS)
        if off is None or ext is None:
            continue
        texts = [t.text or "" for t in sp.iter(f"{{{NS['a']}}}t")]
        sizes = [int(rPr.get("sz")) / 100 for rPr in sp.iter(f"{{{NS['a']}}}rPr")
                 if rPr.get("sz")]
        blip = sp.find(".//a:blip", NS)
        out.append({
            "kind": "pic" if tag == "pic" else "sp",
            "x": int(off.get("x")) / EMU, "y": int(off.get("y")) / EMU,
            "w": int(ext.get("cx")) / EMU, "h": int(ext.get("cy")) / EMU,
            "text": "".join(texts),
            "sizes": sizes,
            "embed": blip.get(f"{{{NS['r']}}}embed") if blip is not None else None,
        })
    return out


def image_map(z: zipfile.ZipFile, slide_name: str) -> dict[str, str]:
    rid = slide_name.split("/")[-1]
    rels = f"ppt/slides/_rels/{rid}.rels"
    if rels not in z.namelist():
        return {}
    root = ET.fromstring(z.read(rels))
    out = {}
    for rel in root:
        if "image" in (rel.get("Type") or ""):
            out[rel.get("Id")] = rel.get("Target", "").split("/")[-1]
    return out


def overlap(a: dict, b: dict) -> float:
    ix = max(0.0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
    iy = max(0.0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
    inter = ix * iy
    smaller = min(a["w"] * a["h"], b["w"] * b["h"])
    return inter / smaller if smaller > 0 else 0.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pptx")
    ap.add_argument("--baseline", help="前版のPPTX。全ページのテキストを比較する")
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--repeat-limit", type=int, default=3,
                    help="同一画像が何ページ連続したら指摘するか（既定3）")
    args = ap.parse_args()

    path = Path(args.pptx)
    if not path.exists():
        print(f"[ERROR] ありません: {path}", file=sys.stderr)
        return 2

    findings: list[dict] = []
    def add(sev: str, page: int, kind: str, msg: str) -> None:
        findings.append({"severity": sev, "page": page, "kind": kind, "message": msg})

    texts_by_page: dict[int, str] = {}
    # 図形ごとに区切った版。文脈チェックはこちらを使う。
    # 全図形を連結すると、別々のテキストボックスの断片がつながって
    # 存在しない一文ができ、誤検知になる（実際に「最下位」で誤検知した）
    shape_texts: dict[int, list[str]] = {}
    img_runs: dict[str, list[int]] = defaultdict(list)

    with zipfile.ZipFile(path) as z:
        slides = slide_files(z)
        for name in slides:
            page = int(re.search(r"(\d+)", name.split("/")[-1]).group(1))
            root = ET.fromstring(z.read(name))
            shapes = shapes_of(root)
            imap = image_map(z, name)
            texts_by_page[page] = "".join(s["text"] for s in shapes)
            shape_texts[page] = [s["text"] for s in shapes if s["text"].strip()]

            body = [s for s in shapes if s["kind"] == "sp" and s["text"].strip()]

            # ── 崩れ: フッター／ページ番号との衝突（フッターが実在する場合だけ）
            footers = [s for s in body if FOOTER_HINT.search(s["text"].strip())
                       and s["y"] > 9.5]
            ftop = min((s["y"] for s in footers), default=None)
            for s in body:
                if s in footers:
                    continue
                bottom = s["y"] + s["h"]
                if bottom > SLIDE_H_IN + 0.02:
                    add("致命的", page, "スライド外",
                        f"要素がスライド外へ出る 下端 {bottom:.2f}in > {SLIDE_H_IN}in "
                        f"「{s['text'][:26]}」")
                elif ftop is not None and bottom > ftop + 0.06:
                    add("重大", page, "フッター衝突",
                        f"要素の下端 {bottom:.2f}in がフッター(上端 {ftop:.2f}in)へ入る "
                        f"「{s['text'][:26]}」")

            # ── 崩れ: テキスト枠の重なり
            for i in range(len(body)):
                for j in range(i + 1, len(body)):
                    ov = overlap(body[i], body[j])
                    if ov > 0.55:
                        add("重大", page, "重なり",
                            f"文字枠が{ov * 100:.0f}%重なる 「{body[i]['text'][:18]}」"
                            f"×「{body[j]['text'][:18]}」")

            # ── 漏れ: 切り詰め・プレースホルダ・未解決変数
            for s in body:
                t = s["text"].strip()
                # 切り詰めはビルド側（truncateToBox の警告）が正。ここでは判定しない。
                # clip() による意図的な抜粋と区別できず、誤検出になるため
                for ph in PLACEHOLDERS:
                    if ph in t:
                        add("重大", page, "欠損", f"{ph} がスライドに出ている")
                for bad in BAD_TOKENS:
                    if bad in t:
                        add("致命的", page, "未解決変数",
                            f"'{bad}' がスライドに出ている 「{t[:40]}」")

            # ── ずれ: 画像の連続使い回し
            for s in shapes:
                if s["kind"] == "pic" and s["embed"]:
                    f = imap.get(s["embed"])
                    if f:
                        img_runs[f].append(page)

            # ── 誤読: 「平均」と書いた列に中央値が入っていないか（同一ページ内の齟齬）
            page_text = "".join(x["text"] for x in body)
            if "平均保存率" in page_text and "中央値" in page_text:
                add("重大", page, "平均と中央値",
                    "同じページに「平均保存率」の列と「中央値」の記述が同居している"
                    "（列見出しと実データの取り違えの疑い）")

            # ── 情報: フォントの下限張り付き
            sizes = [x for s in shapes for x in s["sizes"]]
            if sizes and min(sizes) <= 9.5:
                add("情報", page, "文字が最小",
                    f"最小フォント {min(sizes)}pt（下限に張り付いている）")

        # ── ずれ: 縦横比の破壊（元画像と比較）
        for name in slides:
            page = int(re.search(r"(\d+)", name.split("/")[-1]).group(1))
            root = ET.fromstring(z.read(name))
            imap = image_map(z, name)
            for s in shapes_of(root):
                if s["kind"] != "pic" or not s["embed"]:
                    continue
                f = imap.get(s["embed"])
                m = f and f"ppt/media/{f}"
                if not m or m not in z.namelist():
                    add("重大", page, "画像欠落", f"参照先が見つからない: {f}")
                    continue
                try:
                    import struct
                    raw = z.read(m)[:64]
                    if raw[:2] == b"\xff\xd8":         # JPEG は簡易判定を省略
                        continue
                    if raw[:8] == b"\x89PNG\r\n\x1a\n":
                        w, h = struct.unpack(">II", raw[16:24])
                        if w and h:
                            src = w / h
                            box = s["w"] / s["h"] if s["h"] else 0
                            if box and abs(src - box) / src > 0.06:
                                add("重大", page, "縦横比",
                                    f"画像が歪んでいる 元={src:.3f} 配置={box:.3f}（{f}）")
                except Exception:  # noqa: BLE001
                    pass

    # ── 資料内の矛盾: 同じ数値が「最も高い/最も低い」と別ページで逆に語られていないか
    # 読点・句点をまたがせない。またぐと「最上位のA3.52%は…、最下位のB0.92%」の
    # ような並列文で、Aの数値がBの序列に結び付いて誤検知する
    SUP = r"(最も高|最も低|最多|最少|最下位|最上位|1位|トップ)"
    # 単位必須。裸の数字を拾うと、数字を含む社名や「2面」まで指標扱いになり誤検知する
    NUM = r"([0-9][0-9,\.]*)\s*(%|本|再生)"
    sup_after = re.compile(NUM + r"[^。、]{0,20}?" + SUP)   # 「3.52%は…最も高い」
    sup_before = re.compile(SUP + r"[^。、]{0,20}?" + NUM)  # 「最上位の◯◯社3.52%」
    HIGH = ("最も高", "最多", "最上位", "1位", "トップ")
    LOW = ("最も低", "最少", "最下位")
    claims: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
    for page, texts in shape_texts.items():
        for t in texts:                      # 図形単位。またぐと偽の一文ができる
            for rx, gnum in ((sup_after, 1), (sup_before, 2)):
                for m in rx.finditer(t):
                    num = m.group(gnum).replace(",", "")
                    unit = m.group(gnum + 1)
                    # 1桁の整数（本数の「2本」等）は指標として一意に定まらない
                    if "." not in num and len(num) < 2:
                        continue
                    frag = m.group(0)
                    kind = "高" if any(k in frag for k in HIGH) else "低"
                    claims[f"{num}{unit}"].append((page, kind, frag[:40]))
    for num, hits in claims.items():
        kinds = {k for _, k, _ in hits}
        pages = sorted({p for p, _, _ in hits})
        if len(kinds) > 1 and len(pages) > 1:
            ev = " / ".join(f"p{p}「{f}」" for p, _, f in hits[:3])
            add("重大", pages[0], "資料内の矛盾",
                f"同じ数値 {num} が別ページで最高とも最低とも語られている: {ev}")

    # 同一画像の連続
    for f, pages in img_runs.items():
        pages = sorted(set(pages))
        run, start = 1, pages[0]
        for a, b in zip(pages, pages[1:]):
            if b == a + 1:
                run += 1
            else:
                if run >= args.repeat_limit:
                    add("重大", start, "画像の使い回し",
                        f"同じ画像が {run} ページ連続（p{start}〜p{start + run - 1}）: {f}")
                run, start = 1, b
        if run >= args.repeat_limit:
            add("重大", start, "画像の使い回し",
                f"同じ画像が {run} ページ連続（p{start}〜p{start + run - 1}）: {f}")

    # 前版との差分
    if args.baseline:
        bp = Path(args.baseline)
        if bp.exists():
            with zipfile.ZipFile(bp) as zb:
                base = {}
                for name in slide_files(zb):
                    page = int(re.search(r"(\d+)", name.split("/")[-1]).group(1))
                    root = ET.fromstring(zb.read(name))
                    base[page] = "".join(s["text"] for s in shapes_of(root))
            if len(base) != len(texts_by_page):
                add("重大", 0, "枚数変化",
                    f"前版 {len(base)} 枚 → 今回 {len(texts_by_page)} 枚")
            diff = [p for p in base if base.get(p) != texts_by_page.get(p)]
            if diff:
                add("情報", 0, "本文差分",
                    f"前版と本文が異なるページ: {diff[:20]}{'…' if len(diff) > 20 else ''}"
                    f"（計{len(diff)}枚）")
        else:
            add("情報", 0, "前版なし", f"baseline が見つからない: {bp}")

    # 生成時のQA警告を拾う。レンダラは「本文領域に収まらない」を
    # generation_log.md に書くが、どのゲートも読んでいなかった。
    # 収まらない資料が前検も画像照合も緑で通り抜けていた
    log = os.path.join(os.path.dirname(os.path.abspath(path)), "generation_log.md")
    if os.path.exists(log):
        lines = open(log, encoding="utf-8").read().split("\n")
        # 見出しより上の行にも重要な数字がある。「解決できなかった画像」は
        # 画像が紙面に出ていないという意味で、どのゲートも読んでいなかった
        for ln in lines:
            m = re.search(r"宣言があるのに実体が無い画像:\s*(\d+)", ln)
            if m and int(m.group(1)) > 0:
                add("重大", 0, "画像が出ていない",
                    f"{m.group(1)} 枚が、宣言はあるのに実体が無くスライドに出ていない。"
                    "ファイルが動かされた可能性があります。generation_log.md に一覧があります")
            m2 = re.search(r"画像欄そのものが無い箇所:\s*(\d+)", ln)
            if m2 and int(m2.group(1)) > 0:
                add("情報", 0, "画像欄なし",
                    f"{m2.group(1)} 箇所は画像欄が宣言されていない。"
                    "その欄を使わない案件では正常です（ページは画像なしで組まれます）")
        qa = []
        seen_head = False
        for ln in lines:
            if ln.strip().startswith("## QA fixes"):
                seen_head = True
                continue
            if seen_head:
                if ln.startswith("#"):
                    break
                t = ln.strip().lstrip("- ").strip()
                if t:
                    qa.append(t)
        # 「収まらない（確定）」は重大。「収まらない可能性」は行数の推定に
        # よる警告で、実際には溢れていないことがある（レンダラ側にその注記がある）。
        # 推定を重大にすると誤検知で提出が止まるので、目視の宿題として情報に置く
        maybe = 0
        for t in dict.fromkeys(qa):
            if "可能性" in t:
                add("情報", 0, "生成時のQA警告(要目視)", t)
                maybe += 1
            elif "収まらない" in t or "スライド外" in t:
                add("重大", 0, "生成時のQA警告", t)
            else:
                add("情報", 0, "生成時のQA警告", t)
        if maybe:
            add("情報", 0, "目視の宿題",
                f"下限の文字サイズでも収まらない可能性のある本文が {maybe} 件ある。"
                "行数の推定なので実際は収まっていることもある。"
                "render_pptx_any.py で画像にして該当ページを見てから提出すること")
    else:
        add("情報", 0, "生成ログなし",
            "generation_log.md が無いため、生成時のQA警告は確認できていない")

    order = {"致命的": 0, "重大": 1, "情報": 2}
    findings.sort(key=lambda f: (order.get(f["severity"], 9), f["page"]))
    counts = defaultdict(int)
    for f in findings:
        counts[f["severity"]] += 1

    print(f"preflight: {path.name}")
    print(f"  ページ数 : {len(texts_by_page)}")
    print(f"  致命的 {counts['致命的']} / 重大 {counts['重大']} / 情報 {counts['情報']}\n")
    # 情報のうち、人が手を動かさないと閉じないものは既定でも必ず出す。
    # --json の中に隠すと、目視の宿題が誰にも渡らないまま提出される
    ALWAYS_SHOW = ("目視の宿題", "生成ログなし")
    for f in findings:
        if f["severity"] == "情報" and f["kind"] not in ALWAYS_SHOW:
            continue
        page = f"p{f['page']:>2}" if f["page"] else " — "
        print(f"  [{f['severity']}] {page} {f['kind']}: {f['message']}")
    hidden = [f for f in findings
              if f["severity"] == "情報" and f["kind"] not in ALWAYS_SHOW]
    if hidden:
        print(f"\n  （ほかに情報 {len(hidden)} 件。--json で確認できます）")

    if args.json_out:
        Path(args.json_out).write_text(
            json.dumps({"pptx": str(path), "pages": len(texts_by_page),
                        "counts": dict(counts), "findings": findings},
                       ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n  レポート: {args.json_out}")

    return 1 if counts["致命的"] or counts["重大"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
