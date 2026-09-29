#!/usr/bin/env python3
"""Claude が読み取ったテロップを signals へ取り込む（機械OCRの置き換え）。

旧版は Tesseract で全フレームを OCR していたが、導入負担（OS ごとに手順が違う・
日本語データの入れ忘れ）と装飾テロップでの精度不足のため撤去した。
現行は次の流れになる。

    1. extract_signals.py がフレーム画像を <run-dir>/media/frames/<video_id>/ へ出す
    2. Claude Code がその画像を読み、読み取り結果を manifest(JSON) に書く
    3. 本スクリプトが manifest を検証して signals へ取り込む

取り込むまで telop は「0件」ではなく **未計測**（telop_measured=false）である。
本スクリプトが通った投稿だけ telop_measured=true になる。

manifest の形式:

    {
      "source": "claude-code",
      "read_at": "2026-09-02T10:00:00+09:00",
      "videos": [
        {
          "video_id": "7678464957435940112",
          "video_url": "https://www.tiktok.com/@user/video/7678464957435940112",
          "frames_dir": "media/frames/7678464957435940112",
          "reads": [
            {"timestamp": 0.0,  "text": "結局どれが一番安いの？", "frame": "frame_000001.jpg"},
            {"timestamp": 2.5,  "text": "答えはこれ",           "frame": "frame_000011.jpg"},
            {"timestamp": 5.0,  "text": null}
          ]
        }
      ]
    }

写真投稿は「秒」が無いため、`timestamp` の代わりに `photo_index`（1始まり）を使う。

    {"video_id": "...", "reads": [
      {"photo_index": 1, "text": "＼保存必須／ メガ割でコスパ最強", "frame": "01.jpg"},
      {"photo_index": 2, "text": null}
    ]}

`text` が null のフレームは「読んだが文字が無い」= 空文字として扱う。
フレーム自体を読んでいない場合は、その要素を manifest に入れない
（入れないものは未確認のままであり、0 とは数えない）。
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_signals import merge_ocr_spans  # noqa: E402

# Claude の読み取りは機械信頼度を持たないため、機械OCRの confidence と
# 取り違えないよう固定値を入れる。100（=機械OCRの満点）は使わない。
AGENT_CONFIDENCE = 95.0


def fail(message):
    print(f"[STOP] {message}", file=sys.stderr)
    raise SystemExit(2)


def load_manifest(path: Path):
    if not path.exists():
        fail(f"manifest が見つかりません: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"manifest の JSON が壊れています: {exc}")
    if not isinstance(data, dict) or not isinstance(data.get("videos"), list):
        fail("manifest は {'videos': [...]} 形式である必要があります")
    if not data["videos"]:
        fail("manifest の videos が空です")
    return data


def validate_entry(entry, index, signals_dir: Path):
    """1投稿ぶんを検証して (video_id, frame_reads) を返す。"""
    where = f"videos[{index}]"
    video_id = str(entry.get("video_id") or "").strip()
    if not video_id:
        fail(f"{where}: video_id がありません")

    signal_path = signals_dir / f"{video_id}.json"
    if not signal_path.exists():
        fail(f"{where}: signals に存在しない video_id です（先に extract_signals.py を実行）: {video_id}")

    signal = json.loads(signal_path.read_text(encoding="utf-8"))

    # URL を突き合わせて、別投稿の読み取りを取り違えないようにする。
    declared_url = (entry.get("video_url") or "").strip()
    known_url = (signal.get("video_url") or "").strip()
    if declared_url and known_url and declared_url != known_url:
        fail(f"{where}: video_url が signals と一致しません\n  manifest: {declared_url}\n  signals : {known_url}")

    reads = entry.get("reads")
    if not isinstance(reads, list) or not reads:
        fail(f"{where}: reads が空です。読んでいないなら manifest に含めないでください")

    is_photo = signal.get("media_type") == "photo"
    photo_count = len(signal.get("photo_paths") or []) or (signal.get("frames_sampled") or 0)
    duration = signal.get("duration_seconds") or signal.get("duration") or 0
    frame_reads, seen = [], set()
    for r_index, read in enumerate(reads):
        rwhere = f"{where}.reads[{r_index}]"
        if not isinstance(read, dict):
            fail(f"{rwhere}: オブジェクトである必要があります")

        if is_photo:
            # 写真投稿に秒数は無い。入口は「何枚目か」（1始まり）。
            if "photo_index" not in read:
                fail(f"{rwhere}: 写真投稿なので photo_index（1始まり）が必須です。"
                     "timestamp ではなく何枚目かを指定してください")
            try:
                photo_index = int(read["photo_index"])
            except (TypeError, ValueError):
                fail(f"{rwhere}: photo_index を整数にできません: {read['photo_index']!r}")
            if photo_index < 1:
                fail(f"{rwhere}: photo_index は1始まりです: {photo_index}")
            if photo_count and photo_index > photo_count:
                fail(f"{rwhere}: photo_index {photo_index} が枚数 {photo_count} を超えています")
            if photo_index in seen:
                fail(f"{rwhere}: photo_index {photo_index} が重複しています")
            seen.add(photo_index)
            key = photo_index
        else:
            if "timestamp" not in read:
                fail(f"{rwhere}: timestamp は必須です")
            try:
                timestamp = float(read["timestamp"])
            except (TypeError, ValueError):
                fail(f"{rwhere}: timestamp を数値にできません: {read['timestamp']!r}")
            if timestamp < 0:
                fail(f"{rwhere}: timestamp が負です: {timestamp}")
            if duration and timestamp > float(duration) + 1.0:
                fail(f"{rwhere}: timestamp {timestamp} が動画長 {duration}s を超えています")
            if timestamp in seen:
                fail(f"{rwhere}: timestamp {timestamp} が重複しています")
            seen.add(timestamp)
            key = timestamp

        text = read.get("text")
        text = "" if text is None else str(text).strip()
        frame_reads.append((key, text, AGENT_CONFIDENCE if text else 0.0))

    frame_reads.sort(key=lambda item: item[0])
    return video_id, frame_reads, signal, signal_path, is_photo


def main():
    ap = argparse.ArgumentParser(description="Claude の読み取りテロップを signals へ取り込む")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--dry-run", action="store_true", help="検証だけ行い書き込まない")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    signals_dir = run_dir / "signals"
    if not signals_dir.exists():
        fail(f"signals ディレクトリがありません: {signals_dir}")

    manifest = load_manifest(Path(args.manifest).expanduser())
    source = manifest.get("source") or "claude-code"

    # 全件を先に検証してから書き込む（途中で落ちて半端に混ざるのを防ぐ）。
    validated = [
        validate_entry(entry, index, signals_dir)
        for index, entry in enumerate(manifest["videos"])
    ]

    imported = []
    for video_id, frame_reads, signal, signal_path, is_photo in validated:
        if is_photo:
            # 写真は1枚=1出現。start/end は「秒」ではなく 0 始まりの枚数序数を入れる
            # （時系列前提のコードが落ちないようにするための互換値）。
            spans = [
                {
                    "start": idx - 1,
                    "end": idx - 1,
                    "text": text,
                    "avg_confidence": AGENT_CONFIDENCE,
                    "source_provenance": {
                        "ocr_source_type": "photo_image",
                        "photo_index": idx,
                        "index_is_ordinal_not_seconds": True,
                    },
                }
                for idx, text, _c in frame_reads if text
            ]
        else:
            spans = merge_ocr_spans(frame_reads)
        read_count = len(frame_reads)
        text_count = sum(1 for _ts, text, _c in frame_reads if text)

        if not args.dry_run:
            signal["ocr_spans"] = spans
            # 「1枚読んだら計測済み」にすると、未読フレームが 0 として集計される。
            # 何枚中何枚読んだかを必ず残し、下流はこれを使って被覆率を出す。
            total = (signal.get("telop_frames_total")
                     or len(signal.get("photo_paths") or [])
                     or len(signal.get("frame_files") or []) or 0)
            signal["telop_frames_total"] = total
            signal["telop_frames_read"] = read_count
            signal["telop_coverage_pct"] = (round(read_count / total * 100, 1)
                                            if total else None)
            signal["telop_measured"] = True
            signal["telop_source"] = source
            signal["telop_import"] = {
                "source": source,
                "imported_at": datetime.now(timezone.utc).astimezone().isoformat(),
                "frames_read": read_count,
                "frames_with_text": text_count,
                "spans": len(spans),
                "manifest": str(Path(args.manifest).expanduser()),
                # 全フレーム網羅ではないため、資料側で「確認できた場面」と書くための根拠。
                "coverage": "sampled",
                "unit": "photo_index" if is_photo else "timestamp_seconds",
            }
            signal_path.write_text(
                json.dumps(signal, ensure_ascii=False, indent=2), encoding="utf-8")

        imported.append({
            "video_id": video_id,
            "frames_read": read_count,
            "frames_with_text": text_count,
            "spans": len(spans),
        })

    report = {
        "ok": True,
        "dry_run": args.dry_run,
        "source": source,
        "videos": len(imported),
        "frames_read_total": sum(v["frames_read"] for v in imported),
        "spans_total": sum(v["spans"] for v in imported),
        "detail": imported,
        # 資料へ書く際の必須注記。網羅計測ではないことを明示的に残す。
        "coverage_note": (
            "Claude が読み取ったフレームのみ。全フレーム網羅の機械計測ではないため、"
            "資料には『確認できた場面』と記載し、未読フレームを0件として扱わないこと。"
        ),
    }
    if not args.dry_run:
        (run_dir / "signals" / "_telop_import.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
