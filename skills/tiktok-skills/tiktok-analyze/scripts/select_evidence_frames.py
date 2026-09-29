#!/usr/bin/env python3
"""Select real TikTok media images for top-post evidence and visual review.

For video posts, save up to three timestamped frames.  For photo-mode posts,
copy up to three actual TikTok carousel images, retaining their photo index.
Every evidence image is tied to its original TikTok URL and explicitly labeled
as ``actual_video_frame`` or ``actual_tiktok_photo``.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import read_jsonl, safe_artifact_id, validate_tiktok_page_url  # noqa: E402


def first_pattern_timestamp(classification):
    for key in ("B_proof", "A_opening_hook", "F_cta"):
        category = classification.get(key, {})
        if category.get("evidence_timestamp_sec") is not None:
            return float(category["evidence_timestamp_sec"]), key
        for evidence in category.get("evidence", []) or []:
            if isinstance(evidence, dict) and evidence.get("start") is not None:
                return float(evidence["start"]), key
    product_ts = classification.get("E_product_connection", {}).get("first_mention_sec")
    if product_ts is not None:
        return float(product_ts), "E_product_connection"
    return None, None


def first_pattern_photo_index(classification):
    for key in ("B_proof", "A_opening_hook", "F_cta", "E_product_connection"):
        category = classification.get(key, {})
        direct_index = category.get("evidence_photo_index", category.get("first_mention_photo"))
        if direct_index is not None:
            return int(direct_index), key
        for evidence in category.get("evidence", []) or []:
            if isinstance(evidence, dict):
                photo_index = evidence.get("photo_index", evidence.get("evidence_photo_index"))
                if photo_index is not None:
                    return int(photo_index), key
        heuristic = category.get("text_audio_signal") or {}
        direct_index = heuristic.get("evidence_photo_index", heuristic.get("first_mention_photo"))
        if direct_index is not None:
            return int(direct_index), key
        for evidence in heuristic.get("evidence", []) or []:
            if isinstance(evidence, dict) and evidence.get("photo_index") is not None:
                return int(evidence["photo_index"]), key
    return None, None


def extract_frame(media_path, timestamp, output_path):
    command = [
        "ffmpeg", "-y", "-ss", f"{max(0.0, timestamp):.3f}", "-i", str(media_path),
        "-frames:v", "1", "-q:v", "2", str(output_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)
    return result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 1000


def safe_existing_path(raw_path, allowed_root):
    if not raw_path:
        return None
    try:
        path = Path(raw_path).resolve(strict=True)
        path.relative_to(allowed_root.resolve(strict=True))
    except (OSError, ValueError):
        return None
    return path if path.is_file() else None


def photo_evidence_candidates(photo_paths, audit, signal, classification, max_images):
    """Return (zero-based list index, purpose) without inventing timestamps."""
    if not photo_paths:
        return []
    candidates = [(0, "opening_photo")]
    ocr_occurrences = (audit or {}).get("channel_occurrences", {}).get("ocr", [])
    if ocr_occurrences:
        span_index = ocr_occurrences[0].get("span_index")
        spans = (signal or {}).get("ocr_spans", [])
        if isinstance(span_index, int) and 0 <= span_index < len(spans):
            photo_index = (spans[span_index].get("source_provenance") or {}).get("photo_index")
            if isinstance(photo_index, int) and 1 <= photo_index <= len(photo_paths):
                candidates.append((photo_index - 1, "keyword_photo"))
    pattern_index, pattern_key = first_pattern_photo_index(classification)
    if pattern_index is not None and 1 <= pattern_index <= len(photo_paths):
        candidates.append((pattern_index - 1, f"pattern_{pattern_key}"))
    candidates.extend((index, "photo_fallback") for index in range(len(photo_paths)))

    selected = []
    seen = set()
    for index, purpose in candidates:
        if index in seen:
            continue
        seen.add(index)
        selected.append((index, purpose))
        if len(selected) >= max_images:
            break
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--max-frames-per-video", type=int, default=3)
    args = parser.parse_args()
    run_dir = Path(args.run_dir)

    patterns_path = run_dir / "measurement" / "rank_patterns_output.json"
    measure_path = run_dir / "measurement" / "measure_output.json"
    if not patterns_path.exists() or not measure_path.exists():
        print("ERROR: run measure_keywords.py and rank_patterns.py first", file=sys.stderr)
        raise SystemExit(1)
    patterns = json.loads(patterns_path.read_text(encoding="utf-8"))
    measure = json.loads(measure_path.read_text(encoding="utf-8"))
    audits = {item["video_id"]: item for item in measure.get("video_level_audit", [])}
    videos = {v["video_id"]: v for v in read_jsonl(run_dir / "normalized" / "videos.jsonl")}
    signals = {}
    for signal_path in (run_dir / "signals").glob("*.json"):
        try:
            signal = json.loads(signal_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if signal.get("video_id"):
            signals[signal["video_id"]] = signal

    latest_acquire = {}
    for item in read_jsonl(run_dir / "media" / "acquire_log.jsonl"):
        if item.get("video_id"):
            latest_acquire[item["video_id"]] = item

    unique_classifications = {}
    appearances = {}
    for axis in patterns.get("axes", []):
        for classification in axis.get("video_classifications", []):
            vid = classification["video_id"]
            unique_classifications.setdefault(vid, classification)
            appearances.setdefault(vid, []).append({
                "axis": axis.get("label"), "role": axis.get("role"), "rank": classification.get("rank")
            })

    output_root = run_dir / "evidence_frames"
    output_root.mkdir(parents=True, exist_ok=True)
    manifest = {"version": "2.0", "videos": {}}
    for vid in sorted(unique_classifications):
        classification = unique_classifications[vid]
        video = videos.get(vid, {})
        acquire = latest_acquire.get(vid, {})
        media_type = acquire.get("media_type") or "video"
        media_root = run_dir / "media"
        media_path = (
            safe_existing_path(acquire.get("path"), media_root)
            if acquire.get("status") == "ok" and media_type == "video" else None
        )
        url = video.get("video_url")
        url_ok, _ = validate_tiktok_page_url(url)
        entry = {
            "video_id": vid,
            "video_url": url if url_ok else None,
            "appearances": appearances.get(vid, []),
            "media_status": acquire.get("status", "not_acquired"),
            "media_type": media_type,
            "acquisition_sha256": acquire.get("acquisition_sha256"),
            "frames": [],
        }
        if acquire.get("status") == "ok" and media_type == "photo":
            logged_photo_paths = acquire.get("photo_paths", [])
            expected_photo_count = acquire.get("photo_count_expected", len(logged_photo_paths))
            photo_paths = [safe_existing_path(raw_path, media_root) for raw_path in logged_photo_paths]
            if len(logged_photo_paths) != expected_photo_count or any(path is None for path in photo_paths):
                entry["error"] = (
                    f"actual TikTok photo set is incomplete or unsafe "
                    f"({sum(path is not None for path in photo_paths)}/{expected_photo_count})"
                )
                manifest["videos"][vid] = entry
                continue
            video_dir = output_root / safe_artifact_id(vid)
            video_dir.mkdir(parents=True, exist_ok=True)
            candidates = photo_evidence_candidates(
                photo_paths, audits.get(vid), signals.get(vid), classification,
                args.max_frames_per_video)
            for output_index, (photo_list_index, purpose) in enumerate(candidates, 1):
                source_path = photo_paths[photo_list_index]
                output_path = video_dir / f"{output_index:02d}_photo_{photo_list_index + 1:02d}_{purpose}.jpg"
                try:
                    shutil.copy2(source_path, output_path)
                except OSError as exc:
                    entry.setdefault("frame_errors", []).append({
                        "photo_index": photo_list_index + 1, "purpose": purpose, "error": str(exc)})
                    continue
                if output_path.exists() and output_path.stat().st_size > 1000:
                    entry["frames"].append({
                        "path": str(output_path),
                        "timestamp_sec": None,
                        "photo_index": photo_list_index + 1,
                        "purpose": purpose,
                        "evidence_source": "actual_tiktok_photo",
                        "source_path": str(source_path),
                    })
            manifest["videos"][vid] = entry
            continue
        if not media_path or not media_path.exists():
            entry["error"] = "media file is unavailable"
            manifest["videos"][vid] = entry
            continue

        duration = classification.get("duration_seconds") or video.get("duration_seconds") or 20.0
        candidates = [(min(0.5, max(0.0, duration * 0.05)), "opening")]
        timed_groups = audits.get(vid, {}).get("timed_mention_groups", [])
        if timed_groups and timed_groups[0].get("event_start") is not None:
            candidates.append((float(timed_groups[0]["event_start"]), "keyword_event"))
        else:
            candidates.append((max(0.0, duration * 0.35), "midpoint_fallback"))
        pattern_ts, pattern_key = first_pattern_timestamp(classification)
        if pattern_ts is not None:
            candidates.append((pattern_ts, f"pattern_{pattern_key}"))
        else:
            candidates.append((max(0.0, duration * 0.7), "late_fallback"))

        # Deduplicate nearby timestamps while preserving semantic priority.
        selected = []
        for timestamp, purpose in candidates:
            timestamp = min(max(0.0, timestamp), max(0.0, duration - 0.05))
            if any(abs(timestamp - prior[0]) < 0.35 for prior in selected):
                continue
            selected.append((timestamp, purpose))
            if len(selected) >= args.max_frames_per_video:
                break

        video_dir = output_root / safe_artifact_id(vid)
        video_dir.mkdir(parents=True, exist_ok=True)
        for index, (timestamp, purpose) in enumerate(selected, 1):
            output_path = video_dir / f"{index:02d}_{timestamp:.2f}s_{purpose}.jpg"
            if extract_frame(media_path, timestamp, output_path):
                entry["frames"].append({
                    "path": str(output_path), "timestamp_sec": round(timestamp, 2), "purpose": purpose,
                    "evidence_source": "actual_video_frame",
                })
            else:
                entry.setdefault("frame_errors", []).append({"timestamp_sec": timestamp, "purpose": purpose})
        manifest["videos"][vid] = entry

    manifest_path = output_root / "evidence_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    extracted = sum(len(item.get("frames", [])) for item in manifest["videos"].values())
    print(f"wrote {manifest_path} ({extracted} real TikTok evidence images)")


if __name__ == "__main__":
    main()
