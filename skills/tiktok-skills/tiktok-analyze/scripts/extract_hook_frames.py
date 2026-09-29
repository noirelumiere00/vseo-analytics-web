#!/usr/bin/env python3
"""冒頭の数秒を高密度でコマ画像にする（フック解剖用）。

TikTok は**最初の数秒でスワイプされるかが決まる**ため、
全体を等間隔で抜いた 24 コマでは冒頭の作りが解像しない。
既定で 0〜3 秒を 8fps（24コマ）で抜き、`frames/<video_id>/hook_*.jpg` に残す。

    python3 extract_hook_frames.py --run-dir <run-dir>
    python3 extract_hook_frames.py --run-dir <run-dir> --seconds 3 --fps 8

写真投稿は「冒頭」の概念が違う（1枚目が入口）ので、
既に取得済みの `<id>_photos/01.jpg` を先頭として扱い、ここでは何もしない。
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def read_jsonl(path: Path):
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def main():
    ap = argparse.ArgumentParser(description="冒頭数秒を高密度でコマ画像にする")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--seconds", type=float, default=3.0, help="冒頭何秒を対象にするか")
    ap.add_argument("--fps", type=float, default=8.0, help="秒あたり何コマ抜くか")
    ap.add_argument("--video-ids", default=None, help="対象を絞る（カンマ区切り）")
    ap.add_argument("--force", action="store_true", help="既存の hook_*.jpg を作り直す")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    media_dir = run_dir / "media"
    log = media_dir / "acquire_log.jsonl"
    if not log.exists():
        fail(f"acquire_log.jsonl がありません: {log}\n"
             "  取得モジュールで `search.mjs --mode fetch --run-dir <run-dir>` を実行してください")

    only = {x.strip() for x in args.video_ids.split(",")} if args.video_ids else None
    results = []
    for rec in read_jsonl(log):
        if rec.get("status") != "ok":
            continue
        vid = rec.get("video_id")
        if only and vid not in only:
            continue
        if rec.get("media_type") == "photo":
            # 写真投稿は 01.jpg が入口。ここでは切り出さない。
            results.append({"video_id": vid, "kind": "photo", "frames": 0,
                            "note": "写真投稿は <id>_photos/01.jpg を先頭として扱う"})
            continue
        path = rec.get("path")
        if not path or not Path(path).exists():
            results.append({"video_id": vid, "kind": "video", "frames": 0,
                            "error": "媒体ファイルが見つかりません"})
            continue

        out_dir = run_dir / "frames" / vid
        out_dir.mkdir(parents=True, exist_ok=True)
        existing = sorted(out_dir.glob("hook_*.jpg"))
        if existing and not args.force:
            results.append({"video_id": vid, "kind": "video", "frames": len(existing),
                            "note": "既存を再利用（--force で作り直し）"})
            continue
        for stale in existing:
            stale.unlink(missing_ok=True)

        # -t で冒頭だけに絞り、fps で密度を上げる。ファイル名は秒数が読める形にする。
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(path),
             "-t", str(args.seconds), "-vf", f"fps={args.fps}", "-q:v", "2",
             str(out_dir / "hook_%03d.jpg")],
            capture_output=True, timeout=120,
        )
        made = sorted(out_dir.glob("hook_*.jpg"))
        # 連番 → 秒数入りの名前に付け替える（何秒の画面かが一目で分かるようにする）
        renamed = []
        for i, f in enumerate(made):
            ts = i / args.fps
            new = out_dir / f"hook_{ts:05.2f}s.jpg"
            f.rename(new)
            renamed.append(new)
        results.append({
            "video_id": vid, "kind": "video", "frames": len(renamed),
            "seconds": args.seconds, "fps": args.fps,
            "dir": str(out_dir),
            "error": (proc.stderr.decode()[:200] or None) if not renamed else None,
        })

    total = sum(r["frames"] for r in results)
    print(json.dumps({
        "ok": total > 0,
        "videos": len(results),
        "frames_total": total,
        "seconds": args.seconds, "fps": args.fps,
        "detail": results,
        "next": "frames/<video_id>/hook_*.jpg を Claude が読み、"
                "冒頭の作り（1枚目の言葉・見せる順番・買う判断材料）を分析する",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
