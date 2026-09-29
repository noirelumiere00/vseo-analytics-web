#!/usr/bin/env python3
"""Fail-fast environment and network preflight for the distributable skill."""
import argparse
import importlib
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
MIN_FREE_GB = 8

# モジュールごとに本当に要るものだけを検査する。
# 資料生成しか使わない人に ffmpeg や faster-whisper を要求しない。
# 値は (直し方, 必要なモジュール集合)。
REQUIRED_BINARIES = {
    # yt-dlp は取得（search.mjs の予備経路・旧 acquire_media.py）でだけ使う。
    # 分析だけの端末（別回線で取った raw/*.json と media/ を持ち込む運用）に要求しない。
    "yt-dlp": ("tiktok-analyze/scripts/requirements.txt を venv に入れる", {"acquire"}),
    "ffmpeg": ("OS のパッケージマネージャで ffmpeg を入れる", {"analyze"}),
    "ffprobe": ("ffmpeg を入れる（ffprobe が同梱される）", {"analyze"}),
    # ③資料生成は pptxgenjs（Node）で描画する。python-pptx 時代の記述は誤りだった
    "node": ("Node.js 20 以降を入れる", {"acquire", "deck"}),
}
REQUIRED_MODULES = {
    # stamp_acquire_log.py が acquire_media（冒頭で requests を import）を読むため、分析でも要る。
    "requests": ("requests", {"analyze"}),
    # 写真投稿（<id>_photos/NN.jpg）の読み込みとコンタクトシート作成に使う。
    # 無いと extract_signals が写真投稿を全件 error にするので任意ではない。
    "PIL": ("Pillow", {"analyze"}),
    # 資料生成(deck)は標準ライブラリのみで動く。Python の外部パッケージは要らない。
    # かつて PIL / python-pptx を必須にしていたが、現行 tiktok-deck は使わない
}
# 既定の工程では使わないが、入っていれば機能が増えるもの。
# 無くても [STOP] にしない（無いこと自体は正常）
OPTIONAL_MODULES = {
    "faster_whisper": ("faster-whisper", {"analyze"},
                       "音声の文字起こし。無ければ extract_signals は止まらず、動画の音声経路を"
                       "「未計測（0件ではない）」として記録する（資料にもそう明記する）"),
    "scenedetect": ("scenedetect[opencv]", {"analyze"}, "シーン検出。無ければ等間隔になる（警告が出る）"),
    "curl_cffi": ("curl-cffi", {"acquire"}, "旧 acquire_media.py の取得で使う。無ければ requests で取得する"),
}
# 機械OCRは廃止したため tesseract / pytesseract は不要。
# テロップは抽出フレームを Claude が読み、import_agent_telop.py で取り込む。


def sibling_module(*names):
    """兄弟モジュールのディレクトリを探す。

    リポジトリも配布後も tiktok-acquire / tiktok-deck。番号付きの旧フォルダ名
    （01-acquire / 03-deck）は古い配置のために後ろで見る。parents[2] から1つの名前だけで
    引くと配置によって外れる（実際に install 後の check が全部落ちた）ので、名前を順に探す。
    """
    base = Path(__file__).resolve().parents[2]
    for n in names:
        d = base / n
        if d.is_dir():
            return d
    return None


def binary_path(name):
    """Prefer console scripts installed beside the active venv Python."""
    local = Path(sys.executable).with_name(name)
    if local.exists():
        return str(local)
    return shutil.which(name)


def command_version(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        return (result.stdout or result.stderr).splitlines()[0] if result.returncode == 0 else None
    except Exception:
        return None


def check_node():
    if not shutil.which("node"):
        return None, False
    raw = command_version(["node", "--version"])
    try:
        major = int((raw or "").lstrip("v").split(".")[0])
    except ValueError:
        major = 0
    return raw, major >= 18


def check_node_module():
    if not shutil.which("node"):
        return False
    result = subprocess.run(
        ["node", "-e", "require.resolve('puppeteer-core')"],
        cwd=str((sibling_module("tiktok-acquire", "01-acquire") or Path.cwd()) / "scripts"),
        capture_output=True, text=True, timeout=15,
    )
    return result.returncode == 0


def has_japanese_font():
    fc_list = shutil.which("fc-list")
    if not fc_list:
        return None
    try:
        result = subprocess.run(
            [fc_list, ":lang=ja", "family"], capture_output=True, text=True, timeout=20,
        )
    except Exception:
        return None
    return result.returncode == 0 and bool(result.stdout.strip())


def https_probe(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return True, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        # A 404 proves routing works; authorization, policy and rate-limit
        # responses mean the pipeline should not be assumed usable.
        if exc.code == 404:
            return True, "HTTP 404 (reachable)"
        return False, f"HTTP {exc.code}"
    except Exception as exc:
        return False, str(exc)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--skip-network", action="store_true")
    parser.add_argument("--module", default="all", choices=["acquire", "analyze", "deck", "all"],
                        help="このモジュールが要る依存だけを検査する（分割後の既定運用）")
    args = parser.parse_args()

    problems = []
    warnings = []
    versions = {"python": sys.version.split()[0]}
    if not (sys.version_info.major == 3 and 10 <= sys.version_info.minor <= 12):
        problems.append({
            "component": "python",
            "issue": f"Python {versions['python']} is outside the tested range 3.10-3.12",
            "fix": "create a Python 3.10-3.12 virtual environment",
        })

    # モジュール分割後は、自分のモジュールが要る依存だけを見る。
    # 分析モジュールに pptxgenjs（生成モジュールの依存）を要求すると
    # 分割した意味が無くなり、動くのに [STOP] が出る。
    def needed(mods):
        return args.module == "all" or args.module in mods

    need_node = needed({"acquire", "deck"})
    for binary, (fix, mods) in REQUIRED_BINARIES.items():
        if not needed(mods):
            continue
        resolved = binary_path(binary)
        if not resolved:
            problems.append({"component": binary, "issue": "not installed", "fix": fix})
        else:
            version_flag = "-version" if binary in {"ffmpeg", "ffprobe"} else "--version"
            versions[binary] = command_version([resolved, version_flag])

    for module, (package, mods) in REQUIRED_MODULES.items():
        if not needed(mods):
            continue
        try:
            importlib.import_module(module)
        except Exception:
            problems.append({
                "component": f"python:{module}", "issue": "not importable",
                "fix": f"activate a venv and run: python -m pip install -r {SCRIPTS_DIR / 'requirements.txt'}",
            })
    for module, (_pkg, mods, purpose) in OPTIONAL_MODULES.items():
        # "all" は全モジュールを見る。ここを素の in 判定にすると all で全部飛ぶ
        if args.module != "all" and args.module not in mods:
            continue
        try:
            importlib.import_module(module)
        except Exception:
            # 無いこと自体は正常。[STOP] にせず、何ができなくなるかだけ伝える
            warnings.append({"component": f"python:{module}",
                             "issue": "optional dependency absent", "impact": purpose})

    # 資料生成は pptxgenjs で描く。node があっても pptxgenjs が無ければ1枚も作れない。
    # doctor.sh 側だけで見ていたため、ここは ok=true を返して直後に落ちていた
    if needed({"deck"}):
        deck_root = sibling_module("tiktok-deck", "03-deck")
        if deck_root is None:
            problems.append({
                "component": "node:pptxgenjs", "issue": "tiktok-deck が見つからない",
                "fix": "スキル一式が壊れています。install.sh（Windows は install.ps1）で入れ直してください",
            })
        elif not (deck_root / "node_modules" / "pptxgenjs").is_dir():
            problems.append({
                "component": "node:pptxgenjs", "issue": "not installed",
                "fix": f"cd {deck_root} && npm install",
            })

    node_version, node_ok = (None, True)
    if need_node:
        node_version, node_ok = check_node()
    versions["node"] = node_version
    if shutil.which("node") and not node_ok:
        problems.append({"component": "node", "issue": f"Node {node_version} is below 18", "fix": "install Node.js 18 or later"})
    if need_node and node_ok and not check_node_module():
        problems.append({
            "component": "node:puppeteer-core", "issue": "tiktok-acquire/scripts に入っていない",
            "fix": f"run: cd {SCRIPTS_DIR} && npm ci",
        })

    keynote = sys.platform == "darwin" and Path("/Applications/Keynote.app").exists()
    powerpoint = sys.platform == "darwin" and Path("/Applications/Microsoft PowerPoint.app").exists()
    osascript = shutil.which("osascript")
    office = shutil.which("libreoffice") or shutil.which("soffice")
    pdf_rasterizer = shutil.which("pdftocairo") or shutil.which("pdftoppm")
    if office and pdf_rasterizer:
        japanese_font = has_japanese_font()
        versions["japanese_font_detected"] = japanese_font
        if japanese_font is not False:
            versions["slide_renderer"] = f"{Path(office).name} + {Path(pdf_rasterizer).name}"
            warnings.append({
                "component": "slide-renderer", "issue": "LibreOffice headless rendering selected",
                "impact": "the final OCR guard will stop if Japanese text is missing after rendering",
            })
        elif keynote and osascript:
            versions["slide_renderer"] = "Keynote slide-image export"
            warnings.append({
                "component": "japanese-font", "issue": "LibreOffice route skipped because fontconfig found no Japanese font",
                "impact": "Keynote will be used for slide rendering",
            })
        elif powerpoint and osascript:
            versions["slide_renderer"] = f"PowerPoint PDF export + {Path(pdf_rasterizer).name}"
            warnings.append({
                "component": "japanese-font", "issue": "LibreOffice route skipped because fontconfig found no Japanese font",
                "impact": "PowerPoint will be used for slide rendering",
            })
        else:
            warnings.append({
                "component": "japanese-font", "issue": "fontconfig found no Japanese font",
                "impact": "use Cowork's presentation/PDF creation tools for rendering and visually verify every page",
            })
    elif keynote and osascript:
        versions["slide_renderer"] = "Keynote slide-image export"
    elif powerpoint and osascript and pdf_rasterizer:
        versions["slide_renderer"] = f"PowerPoint PDF export + {Path(pdf_rasterizer).name}"
    else:
        warnings.append({
            "component": "slide-renderer", "issue": "no local rendering binary is available",
            "impact": "use Cowork's presentation/PDF creation tools and render every page for visual QA",
        })

    free_gb = shutil.disk_usage(Path.cwd()).free / (1024 ** 3)
    versions["free_disk_gb"] = round(free_gb, 1)
    if free_gb < MIN_FREE_GB:
        problems.append({
            "component": "disk", "issue": f"only {free_gb:.1f}GB free",
            "fix": f"free at least {MIN_FREE_GB}GB before downloading video cohorts",
        })

    # TikTok への到達性は取得（acquire）でだけ要る。分析は取得済みの raw/*.json と media/ を
    # 読むだけなので、--module analyze で到達性を [STOP] にすると、別回線で取得したデータを
    # 持ち込んで分析する（下の修正文言自身が勧めている）運用ができなくなる。
    if not args.skip_network and needed({"acquire"}):
        # かつては不通のとき「経路B（Claude in Chrome でユーザーにログインさせる）」へ
        # 自動で切り替える設計だった。そのせいで別PCが7回ログインを試して詰まったので、
        # 切り替え先を持たせない。不通なら不通と報告して止める
        for name, url in (("TikTok", "https://www.tiktok.com/"),):
            ok, detail = https_probe(url)
            if not ok:
                problems.append({
                    "component": f"network:{name}", "issue": detail,
                    "fix": ("この回線から TikTok に到達できません。"
                            "別の回線で tiktok-acquire を実行して raw/*.json を持ち込んでください。"
                            "ブラウザ操作ツールでログインして取る経路は採りません"
                            "（アカウント単位でブロックされる危険があるため）"),
                })

    result = {"ok": not problems, "problems": problems, "warnings": warnings, "versions": versions}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif result["ok"]:
        print("[OK] 実行環境を確認しました。")
    else:
        print("[STOP] 不足項目を解消してから処理を開始してください。")
        for problem in problems:
            print(f"- {problem['component']}: {problem['issue']}\n  対応: {problem['fix']}")
        if warnings:
            print("[OPTIONAL]")
            for warning in warnings:
                print(f"- {warning['component']}: {warning['impact']}")
    raise SystemExit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
