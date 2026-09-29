#!/usr/bin/env python3
"""extract_frames.py — 動画から「構成が読めるコマ」を抜き、一覧シートにまとめる。

なぜこの抜き方か（実測にもとづく）:
  78秒の実投稿で3方式を比較した結果:
    等間隔11枚        … 7.8秒に1枚。粗く、冒頭3段構えや第4ブロックを取り逃す
    シーン検出のみ     … 48秒以降が0枚。後半38%が丸ごと空白になった（連続ショットで
                         切り替わりが緩いと検出されないため）。一番危ない
    シーン検出＋時間下限 … 44枚・最大の空白4.0秒・末尾まで到達
  よって「シーン変化 または N秒経過、かつ冒頭を必ず含む」を採る。

  依存は ffmpeg だけ。scenedetect / OpenCV は使わない（他PCで動かない原因を増やさない）。

出力:
  <out>/<video_id>/000.jpg …            抽出コマ（連番）
  <out>/<video_id>/frames.json          各コマの時刻と抽出理由
  <out>/<video_id>/contact.jpg          一覧シート（AIはまずこれを見る）

使い方:
  python3 tools/extract_frames.py --video media/xxx.mp4 --out frames/
  python3 tools/extract_frames.py --media-dir media/ --out frames/     # 一括
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys

SCENE = 0.4      # シーン変化の閾値。0.5 だと後半を取り逃した実績がある
FLOOR_SEC = 4.0  # この秒数より長い空白を作らない
MAX_GAP_ALLOWED = FLOOR_SEC * 1.5   # 検証で許す最大の空白


def need(cmd: str) -> str:
    p = shutil.which(cmd)
    if not p:
        sys.exit(f"[致命的] {cmd} が見つかりません。ffmpeg を入れてください")
    return p


def duration(video: str) -> float:
    out = subprocess.run(
        [need("ffprobe"), "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", video],
        capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        sys.exit(f"[致命的] 長さを取得できません: {video}")


def extract(video: str, outdir: str, scene: float, floor: float):
    os.makedirs(outdir, exist_ok=True)
    for old in os.listdir(outdir):
        if old.endswith((".jpg", ".json")):
            os.remove(os.path.join(outdir, old))
    expr = f"gt(scene,{scene})+lt(prev_selected_t,t-{floor})+eq(n,0)"
    # 画像の書き出しと、時刻の記録を同時に行う（別々に走らせるとズレる）
    proc = subprocess.run(
        [need("ffmpeg"), "-loglevel", "info", "-i", video,
         "-vf", f"select='{expr}',showinfo", "-fps_mode", "vfr",
         os.path.join(outdir, "%03d.jpg")],
        capture_output=True, text=True)
    times = [float(m) for m in re.findall(r"pts_time:([0-9.]+)", proc.stderr)]
    imgs = sorted(f for f in os.listdir(outdir) if f.endswith(".jpg"))
    if not imgs:
        sys.exit(f"[致命的] コマを1枚も抽出できません: {video}")
    # 画像枚数と記録した時刻の数は一致しなければならない。ズレたまま進むと
    # 「このコマは何秒の場面か」が全部ずれる
    if len(times) != len(imgs):
        print(f"  [警告] 画像 {len(imgs)}枚 と 時刻 {len(times)}件 が不一致。"
              f"時刻は記録しない", file=sys.stderr)
        times = []
    return imgs, times


def contact_sheet(video: str, dest: str, scene: float, floor: float, n: int):
    """一覧シート。AIはまずこれを1枚見て全体構成を掴む"""
    cols = 8
    rows = max(1, math.ceil(n / cols))
    expr = f"gt(scene,{scene})+lt(prev_selected_t,t-{floor})+eq(n,0)"
    subprocess.run(
        [need("ffmpeg"), "-loglevel", "error", "-y", "-i", video,
         "-vf", f"select='{expr}',scale=200:-1,tile={cols}x{rows}",
         "-frames:v", "1", dest],
        capture_output=True, text=True)
    return os.path.exists(dest)


def run_one(video: str, out_root: str, scene: float, floor: float) -> dict:
    vid = os.path.splitext(os.path.basename(video))[0]
    outdir = os.path.join(out_root, vid)
    dur = duration(video)
    imgs, times = extract(video, outdir, scene, floor)

    # 時間の空白を検証する。ここを黙って通すと「後半が丸ごと無い」状態で
    # 「全部見た」と書いてしまう（シーン検出のみの方式で実際に起きた）
    gaps = []
    if times:
        seq = [0.0] + sorted(times) + [dur]
        gaps = [round(b - a, 1) for a, b in zip(seq, seq[1:])]
    max_gap = max(gaps) if gaps else None

    sheet = os.path.join(outdir, "contact.jpg")
    contact_sheet(video, sheet, scene, floor, len(imgs))

    meta = {
        "video_id": vid, "duration_sec": round(dur, 1),
        "frames": len(imgs), "scene_threshold": scene, "floor_sec": floor,
        "timestamps": [round(t, 2) for t in times],
        "max_gap_sec": max_gap,
        "contact_sheet": os.path.relpath(sheet, out_root) if os.path.exists(sheet) else None,
        "coverage_ok": (max_gap is not None and max_gap <= MAX_GAP_ALLOWED),
    }
    json.dump(meta, open(os.path.join(outdir, "frames.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    return meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video")
    ap.add_argument("--media-dir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scene", type=float, default=SCENE)
    ap.add_argument("--floor", type=float, default=FLOOR_SEC)
    a = ap.parse_args()
    if not a.video and not a.media_dir:
        sys.exit("--video か --media-dir のどちらかが要ります")

    vids = ([a.video] if a.video else
            sorted(os.path.join(a.media_dir, f) for f in os.listdir(a.media_dir)
                   if f.lower().endswith((".mp4", ".mov", ".webm"))))
    if not vids:
        sys.exit(f"[致命的] 動画が1本もありません: {a.media_dir}")

    os.makedirs(a.out, exist_ok=True)
    bad = []
    print(f"extract_frames: {len(vids)} 本")
    for v in vids:
        m = run_one(v, a.out, a.scene, a.floor)
        mark = "" if m["coverage_ok"] else "  ← 空白が大きい"
        print(f"  {m['video_id']}  {m['duration_sec']:>5.1f}秒  {m['frames']:>3}枚  "
              f"最大の空白 {m['max_gap_sec']}秒{mark}")
        if not m["coverage_ok"]:
            bad.append(m["video_id"])
    if bad:
        print(f"\n[警告] 時間の空白が {MAX_GAP_ALLOWED}秒 を超えた動画が {len(bad)} 本あります。")
        print("       その動画は『全コマを見た』と書けません。--floor を小さくして取り直してください。")
        for b in bad:
            print(f"       - {b}")
        return 1
    print("\n  すべての動画で時間の空白が基準内。コンタクトシートを見て8軸を埋めてください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
