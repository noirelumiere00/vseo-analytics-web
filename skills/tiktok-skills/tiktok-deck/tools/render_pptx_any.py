#!/usr/bin/env python3
"""render_pptx_any.py — PPTX の全スライドを PNG にする（Windows / macOS / Linux）

目視QA（BUILD_SPEC.md §10）用。従来の render_pptx.sh は Keynote 依存で macOS 専用だったため、
どのPCでも同じQAループが回るように経路を3本持つ。

経路の優先順位:
  1. LibreOffice（soffice --headless）  … 全OS共通。既定
  2. PowerPoint COM（Windows のみ）      … LibreOffice が無い Windows
  3. Keynote（macOS のみ）               … 上2つが無い Mac

PDF → PNG は pdftoppm（poppler）→ pypdfium2 → PyMuPDF の順に使えるものを使う。

使い方:
  python3 tools/render_pptx_any.py output/deck.pptx output/render 110
  python3 tools/render_pptx_any.py --list-engines
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


# ─────────────────────────────── PPTX → PDF

def find_soffice() -> str | None:
    for c in ("soffice", "libreoffice",
              "/Applications/LibreOffice.app/Contents/MacOS/soffice",
              "C:/Program Files/LibreOffice/program/soffice.exe",
              "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
              "/usr/bin/soffice", "/usr/bin/libreoffice", "/snap/bin/libreoffice"):
        p = shutil.which(c) or (c if Path(c).exists() else None)
        if p:
            return p
    return None


def pdf_via_soffice(pptx: Path, out_dir: Path) -> tuple[bool, str]:
    exe = find_soffice()
    if not exe:
        return False, "LibreOffice が見つかりません"
    try:
        r = subprocess.run([exe, "--headless", "--convert-to", "pdf",
                            "--outdir", str(out_dir), str(pptx)],
                           capture_output=True, text=True, timeout=900)
    except Exception as e:  # noqa: BLE001
        return False, f"LibreOffice の実行に失敗: {e}"
    pdf = out_dir / (pptx.stem + ".pdf")
    if pdf.exists():
        return True, str(pdf)
    return False, (r.stderr or r.stdout or "変換に失敗").strip()[:400]


def pdf_via_powerpoint(pptx: Path, out_dir: Path) -> tuple[bool, str]:
    """Windows の PowerPoint 本体で PDF 化する。実機の解釈に最も近い。"""
    if os.name != "nt":
        return False, "Windows ではありません"
    pdf = out_dir / (pptx.stem + ".pdf")
    ps = (
        "$ErrorActionPreference='Stop';"
        "$app=New-Object -ComObject PowerPoint.Application;"
        f"$p=$app.Presentations.Open('{pptx}',$true,$false,$false);"
        f"$p.SaveAs('{pdf}',32);"
        "$p.Close();$app.Quit();"
    )
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                           capture_output=True, text=True, timeout=900)
    except Exception as e:  # noqa: BLE001
        return False, f"PowerPoint の実行に失敗: {e}"
    if pdf.exists():
        return True, str(pdf)
    return False, (r.stderr or r.stdout or "変換に失敗").strip()[:400]


def pdf_via_keynote(pptx: Path, out_dir: Path) -> tuple[bool, str]:
    if sys.platform != "darwin" or not Path("/Applications/Keynote.app").exists():
        return False, "Keynote がありません"
    pdf = out_dir / (pptx.stem + ".pdf")
    script = f'''
    with timeout of 1800 seconds
    tell application "Keynote"
        activate
        set theDoc to open POSIX file "{pptx}"
        delay 2
        export theDoc to POSIX file "{pdf}" as PDF
        close theDoc saving no
    end tell
    end timeout
    '''
    try:
        subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=1900)
    except Exception as e:  # noqa: BLE001
        return False, f"Keynote の実行に失敗: {e}"
    if pdf.exists():
        return True, str(pdf)
    return False, "Keynote の書き出しに失敗"


# ─────────────────────────────── PDF → PNG

def png_via_pdftoppm(pdf: Path, out_dir: Path, dpi: int) -> tuple[bool, str]:
    exe = shutil.which("pdftoppm")
    if not exe:
        return False, "pdftoppm がありません"
    r = subprocess.run([exe, "-png", "-r", str(dpi), str(pdf), str(out_dir / "slide")],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        return False, (r.stderr or "pdftoppm が失敗").strip()[:300]
    return True, "pdftoppm"


def png_via_pdfium(pdf: Path, out_dir: Path, dpi: int) -> tuple[bool, str]:
    try:
        import pypdfium2 as pdfium  # type: ignore
    except Exception:  # noqa: BLE001
        return False, "pypdfium2 がありません（pip install pypdfium2）"
    doc = pdfium.PdfDocument(str(pdf))
    scale = dpi / 72.0
    for i in range(len(doc)):
        doc[i].render(scale=scale).to_pil().save(out_dir / f"slide-{i + 1:02d}.png")
    return True, "pypdfium2"


def png_via_pymupdf(pdf: Path, out_dir: Path, dpi: int) -> tuple[bool, str]:
    try:
        import fitz  # type: ignore  # PyMuPDF
    except Exception:  # noqa: BLE001
        return False, "PyMuPDF がありません（pip install pymupdf）"
    doc = fitz.open(str(pdf))
    for i, page in enumerate(doc):
        page.get_pixmap(dpi=dpi).save(out_dir / f"slide-{i + 1:02d}.png")
    return True, "PyMuPDF"


def normalize_names(out_dir: Path) -> int:
    """pdftoppm は slide-1.png / slide-01.png と桁が可変。2桁へ揃える。"""
    n = 0
    for f in sorted(out_dir.iterdir()):
        m = re.fullmatch(r"slide-(\d+)\.png", f.name)
        if m:
            dst = out_dir / f"slide-{int(m.group(1)):02d}.png"
            if f != dst:
                f.rename(dst)
            n += 1
    return n


# ─────────────────────────────── main

def list_engines() -> None:
    print("PPTX → PDF:")
    print(f"  LibreOffice : {find_soffice() or '無し'}")
    print(f"  PowerPoint  : {'使える（Windows）' if os.name == 'nt' else '無し（Windows専用）'}")
    keynote = sys.platform == "darwin" and Path("/Applications/Keynote.app").exists()
    print(f"  Keynote     : {'使える（macOS）' if keynote else '無し（macOS専用）'}")
    print("PDF → PNG:")
    print(f"  pdftoppm    : {shutil.which('pdftoppm') or '無し'}")
    for mod, label in (("pypdfium2", "pypdfium2"), ("fitz", "PyMuPDF")):
        try:
            __import__(mod)
            print(f"  {label:<12}: 使える")
        except Exception:  # noqa: BLE001
            print(f"  {label:<12}: 無し")


def main() -> int:
    if "--list-engines" in sys.argv:
        list_engines()
        return 0
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    pptx = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 110

    if not pptx.exists():
        print(f"[ERROR] 入力がありません: {pptx}", file=sys.stderr)
        return 1
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("slide-*.png"):
        old.unlink()

    # PPTX → PDF。LibreOffice を既定にする（全OSで同じ絵が出る）
    for fn, label in ((pdf_via_soffice, "LibreOffice"),
                      (pdf_via_powerpoint, "PowerPoint"),
                      (pdf_via_keynote, "Keynote")):
        ok, msg = fn(pptx, out_dir)
        if ok:
            pdf = Path(msg)
            print(f"[1/2] PDF化: {label}")
            break
        print(f"      {label}: {msg}")
    else:
        print("[ERROR] PDF化の手段がありません。LibreOffice を入れてください "
              "（https://www.libreoffice.org/）", file=sys.stderr)
        return 1

    # PDF → PNG
    for fn, label in ((png_via_pdftoppm, "pdftoppm"),
                      (png_via_pdfium, "pypdfium2"),
                      (png_via_pymupdf, "PyMuPDF")):
        ok, msg = fn(pdf, out_dir, dpi)
        if ok:
            print(f"[2/2] PNG化: {msg}")
            break
        print(f"      {label}: {msg}")
    else:
        print("[ERROR] PNG化の手段がありません。poppler か pypdfium2 を入れてください",
              file=sys.stderr)
        return 1

    n = normalize_names(out_dir) or len(list(out_dir.glob("slide-*.png")))
    pdf.unlink(missing_ok=True)
    print(f"{n} 枚を書き出しました → {out_dir}")

    # レンダラごとの解釈差は残る。何で出したかを必ず残す
    (out_dir / "_render_info.txt").write_text(
        f"pptx={pptx}\ndpi={dpi}\nplatform={sys.platform}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
