#!/usr/bin/env python3
"""Extract OCR (on-screen telop/photo text) + ASR signals from acquired
TikTok media, and make the final relevance / #PR decision.

Frame sampling uses scene-detection (PySceneDetect) as the primary trigger
— it catches telop changes that a fixed interval would straddle or waste
compute re-reading — unioned with a coarse fixed-interval fallback so a
slow pan/zoom with no hard cut still gets sampled. Total frames per video
is capped so a long video can't blow up OCR cost.

Video OCR consecutive-frame text is merged into spans by fuzzy similarity
(difflib), not exact match — real tesseract reads of the same static
telop are rarely byte-identical (compression/motion-blur noise), so exact
dedup would fragment one telop into many spurious spans.  Photo-mode posts
are different: every actual carousel image is OCRed once, kept as its own
span, and tied to its source path/photo index.  Their music/audio is still
sent to ASR when it was acquired, but untimed photos are never falsely
aligned with timed speech.

Usage:
    python3 extract_signals.py --run-dir <dir> --confirmed-config confirmed_config.json \
        [--video-ids id1,id2,...] [--max-frames 15] [--whisper-model small]

    # After the ordinary full-corpus pass, densely re-analyze the top 10
    # unique posts in every search axis and generate Agent review sheets:
    python3 extract_signals.py --run-dir <dir> --confirmed-config confirmed_config.json \
        --dense-top-n-per-source 10 --dense-fps 4

Output:
    <run-dir>/signals/<video_id>.json   per-video OCR spans + ASR segments + final relevance/#PR
    <run-dir>/signals/extract_log.jsonl  checkpoint (one line per processed video)
    <run-dir>/signals/dense_selection_manifest.json  per-axis top-N selection audit
    <run-dir>/visual_review/dense_4fps/manifest.json  contact-sheet review manifest
"""
import argparse
import difflib
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import (  # noqa: E402
    read_jsonl, append_jsonl, has_pr_tag, contains_term, normalize_text,
    safe_artifact_id,
)

MAX_FRAMES_DEFAULT = 24
MAX_DURATION_DEFAULT = 180
DENSE_FPS_DEFAULT = 4.0
DENSE_TOP_N_DEFAULT = 10
DENSE_CONTACT_SHEET_MAX_FRAMES = 36
DENSE_CONTACT_SHEET_FRAMES_PER_SHEET = 9
FUZZY_MERGE_THRESHOLD = 0.72
MAX_OCR_IMAGE_DIMENSION = 4000


def expected_dense_frame_count(duration_seconds, fps):
    """Expected CFR frame count for ``ffmpeg -vf fps=...``.

    ffmpeg's fps filter uses nearest-timestamp rounding rather than a ceiling:
    for example, 1.1 seconds at 4 fps yields 4 frames, while 15 seconds yields
    60.  ``floor(x + 0.5)`` mirrors that behavior without Python's bankers'
    rounding at exact half-frame boundaries.  The verifier still treats the
    decoded frame list as the source of truth and allows one-frame duration
    metadata tolerance.
    """
    if duration_seconds is None or duration_seconds <= 0 or fps <= 0:
        return 0
    return max(0, int(math.floor(duration_seconds * fps + 0.5 + 1e-9)))


def _fps_token(fps):
    value = f"{fps:g}".replace(".", "p")
    return f"dense_{value}fps"


def select_top_unique_per_source(videos, top_n):
    """Select the first ``top_n`` unique videos within every search axis.

    Normalization deliberately preserves every source appearance.  A source
    can therefore contain duplicate rows for the same post.  We scan by rank
    and continue until ten *unique* posts have been selected, then return the
    union without processing a cross-axis duplicate twice.
    """
    axes = {}
    for video in videos:
        video_id = video.get("video_id")
        if not video_id:
            continue
        for appearance in video.get("source_appearances", []):
            source_file = appearance.get("source_file")
            rank = appearance.get("rank")
            if not source_file or isinstance(rank, bool) or not isinstance(rank, (int, float)):
                continue
            axis = axes.setdefault(source_file, {
                "source_file": source_file,
                "label": appearance.get("label"),
                "role": appearance.get("role"),
                "candidates": [],
            })
            axis["candidates"].append((float(rank), str(video_id)))

    union_ids = []
    union_seen = set()
    axis_output = []
    for source_file, axis in axes.items():
        selected = []
        axis_seen = set()
        for rank, video_id in sorted(axis.pop("candidates"), key=lambda item: (item[0], item[1])):
            if video_id in axis_seen:
                continue
            axis_seen.add(video_id)
            selected.append({
                "rank": int(rank) if rank.is_integer() else rank,
                "video_id": video_id,
            })
            if video_id not in union_seen:
                union_seen.add(video_id)
                union_ids.append(video_id)
            if len(selected) >= top_n:
                break
        axis["selected"] = selected
        axis["selected_count"] = len(selected)
        axis_output.append(axis)
    return union_ids, axis_output


def get_duration(video_path):
    import subprocess
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video_path)],
        capture_output=True, text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def get_scene_timestamps(video_path, max_frames):
    """Scene-cut timestamps unioned with a coarse fixed grid, capped and
    de-duplicated. Falls back to a pure fixed grid if scene detection
    itself errors out (corrupt video, unsupported codec quirk, etc.) —
    OCR coverage degrading gracefully beats the whole video being skipped.
    """
    duration = get_duration(video_path) or 20.0
    fixed_grid = [round(t, 2) for t in _frange(0, duration, max(2.0, duration / 12))]

    scene_ts = []
    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector
        video = open_video(str(video_path))
        sm = SceneManager()
        sm.add_detector(ContentDetector(threshold=27.0))
        sm.detect_scenes(video)
        for start, _end in sm.get_scene_list():
            scene_ts.append(round(start.get_seconds(), 2))
    except ImportError:
        # 未導入なら黙って固定グリッドに落ちる実装だった。
        # 「シーン検出した」つもりのデータが実は等間隔、という状態を作るので警告する
        print("[警告] scenedetect が未導入のため、シーン検出ではなく等間隔で抽出します。"
              "テロップの切り替わりを取り逃す可能性があります。"
              "コマ抽出は tiktok-deck/tools/extract_frames.py（ffmpegのみ）を推奨します。",
              file=sys.stderr)
    except Exception as e:  # noqa: BLE001  壊れた動画でも全体は止めない
        print(f"[警告] シーン検出に失敗したため等間隔で抽出します: {e}", file=sys.stderr)

    merged = sorted(set(fixed_grid) | set(scene_ts))
    # collapse timestamps closer than 0.6s together (keep the earlier one)
    collapsed = []
    for t in merged:
        if not collapsed or t - collapsed[-1] >= 0.6:
            collapsed.append(t)
    if len(collapsed) > max_frames:
        step = len(collapsed) / max_frames
        collapsed = [collapsed[int(i * step)] for i in range(max_frames)]
    return collapsed


def _frange(start, stop, step):
    t = start
    while t < stop:
        yield t
        t += step


def extract_frame(video_path, timestamp, out_dir: Path):
    """指定秒のフレームを切り出して**残す**。

    機械OCR撤去後は、このフレーム画像が Claude がテロップを読む唯一の対象になる。
    旧実装は OCR 後に unlink していたため、読む対象が存在しなかった。
    戻り値は保存先パス（失敗時 None）。
    """
    import subprocess

    out_dir.mkdir(parents=True, exist_ok=True)
    frame_path = out_dir / f"f_{timestamp:07.2f}.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(timestamp), "-i", str(video_path),
         "-frames:v", "1", "-q:v", "3", str(frame_path)],
        capture_output=True, timeout=20,
    )
    return frame_path if frame_path.exists() else None


def ocr_frame(video_path, timestamp, tmp_dir: Path):
    """互換用。機械OCRは撤去済みなので常に未計測を返す。"""
    return "", -1.0


# ── 機械OCR は廃止 ───────────────────────────────────────────────
# 旧版は Tesseract で全フレームを OCR していたが、次の理由で撤去した。
#   * Windows / Linux / macOS で導入手順がバラバラ（brew / apt / インストーラ）
#   * 日本語データ（jpn, jpn_vert）の追加導入を忘れる事故が最も多かった
#   * 装飾テロップ（縁取り・グラデーション・半透明帯・縦書き）の読み取り精度が低い
# 代わりに、抽出済みフレーム画像を Claude が直接読み、その結果を
# import_agent_telop.py で取り込む。機械OCRを行わないため、telop は
# 取り込み前の時点では「0件」ではなく **未計測** として記録する。
TELOP_SOURCE = "agent"


def telop_is_measured():
    """機械OCRは行わない。telop は agent 取り込み後にのみ値を持つ。"""
    return False


def ocr_pil_image(image):
    """機械OCRは廃止。呼び出し互換のため残すが常に未計測を返す。

    confidence に -1.0 を返すことで、下流が「読めたが空文字」と
    「そもそも計測していない」を取り違えないようにしている。
    """
    return "", -1.0


def ocr_image(image_path):
    from PIL import Image

    with Image.open(image_path) as image:
        return ocr_pil_image(image)


def extract_dense_frames(video_path, output_dir: Path, fps):
    """Decode the complete video to constant-rate JPEGs in one ffmpeg pass."""
    output_dir.mkdir(parents=True, exist_ok=True)
    for stale in output_dir.glob("frame_*.jpg"):
        stale.unlink(missing_ok=True)
    output_pattern = output_dir / "frame_%06d.jpg"
    command = [
        "ffmpeg", "-y", "-i", str(video_path), "-an",
        "-vf", f"fps=fps={fps:g}:start_time=0", "-q:v", "3", str(output_pattern),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=900)
    frame_paths = sorted(output_dir.glob("frame_*.jpg"))
    if result.returncode != 0 or not frame_paths:
        tail = (result.stderr or "")[-600:].replace("\n", " ")
        raise RuntimeError(f"dense frame extraction failed: {tail or 'no frames produced'}")
    return frame_paths


def _frame_signature(image_path):
    """Small luminance fingerprint used only to select review frames."""
    from PIL import Image, ImageOps

    with Image.open(image_path) as image:
        image = ImageOps.exif_transpose(image).convert("L").resize((24, 24))
        pixels = (
            image.get_flattened_data()
            if hasattr(image, "get_flattened_data") else image.getdata()
        )
        return tuple(pixels)


def _signature_difference(first, second):
    if not first or not second or len(first) != len(second):
        return 1.0
    return sum(abs(a - b) for a, b in zip(first, second)) / (255.0 * len(first))


def _even_pick(items, count):
    """Pick up to ``count`` items across an ordered list, including edges."""
    items = list(dict.fromkeys(items))
    if count <= 0:
        return []
    if len(items) <= count:
        return items
    if count == 1:
        return [items[0]]
    indices = [round(i * (len(items) - 1) / (count - 1)) for i in range(count)]
    return [items[index] for index in dict.fromkeys(indices)]


def select_contact_sheet_frames(frame_infos, max_frames=DENSE_CONTACT_SHEET_MAX_FRAMES):
    """Return representative dense-frame indexes plus auditable reasons.

    OCR still runs over every frame.  This selection only bounds what a human
    or multimodal Agent must inspect: the opening two seconds, OCR transitions,
    major visual transitions, and evenly spaced temporal anchors.
    """
    total = len(frame_infos)
    if total == 0 or max_frames <= 0:
        return []
    reasons = {}

    def mark(index, reason):
        if 0 <= index < total:
            reasons.setdefault(index, set()).add(reason)

    opening = list(range(min(8, total)))
    for index in opening:
        mark(index, "opening_2_seconds")
    mark(total - 1, "ending")

    text_changes = []
    prior_text = ""
    for index, info in enumerate(frame_infos):
        text = normalize_text(info.get("text", ""))
        changed = bool(text) and (
            not prior_text
            or difflib.SequenceMatcher(None, prior_text, text).ratio() < FUZZY_MERGE_THRESHOLD
        )
        if changed:
            text_changes.append(index)
        prior_text = text

    visual_changes = []
    prior_signature = None
    for index, info in enumerate(frame_infos):
        signature = info.get("signature")
        if prior_signature is not None and _signature_difference(prior_signature, signature) >= 0.13:
            visual_changes.append(index)
        prior_signature = signature

    anchor_count = min(12, total)
    anchors = [round(i * (total - 1) / max(1, anchor_count - 1)) for i in range(anchor_count)]

    # Reserve the opening and ending first, then distribute scarce review
    # capacity across text changes, visual cuts, and time anchors in that order.
    selected = list(dict.fromkeys(opening + [total - 1]))[:max_frames]
    groups = [
        (text_changes, "ocr_text_change"),
        (visual_changes, "visual_change"),
        (anchors, "timeline_anchor"),
    ]
    for candidates, reason in groups:
        remaining = max_frames - len(selected)
        if remaining <= 0:
            break
        candidates = [index for index in candidates if index not in selected]
        for index in _even_pick(candidates, remaining):
            selected.append(index)
            mark(index, reason)

    selected.sort()
    return [{
        "index": index,
        "reasons": sorted(reasons.get(index, {"representative"})),
    } for index in selected]


def create_contact_sheets(frame_infos, output_dir: Path, *, max_frames=None,
                          frames_per_sheet=DENSE_CONTACT_SHEET_FRAMES_PER_SHEET,
                          media_type="video", include_all=False):
    """Build review sheets using contain-fit tiles; never crop or stretch."""
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    output_dir.mkdir(parents=True, exist_ok=True)
    for stale in output_dir.glob("contact_sheet_*.jpg"):
        stale.unlink(missing_ok=True)

    max_frames = max_frames or DENSE_CONTACT_SHEET_MAX_FRAMES
    selected = (
        [{"index": index, "reasons": ["complete_photo_sequence"]}
         for index in range(len(frame_infos))]
        if include_all else select_contact_sheet_frames(frame_infos, max_frames=max_frames)
    )
    if not selected:
        return {"contact_sheets": [], "selected_frames": []}

    tile_width, tile_height, label_height = 216, 384, 28
    columns = 3
    rows = max(1, math.ceil(frames_per_sheet / columns))
    font = ImageFont.load_default()
    selected_output = []
    sheets = []
    for sheet_number, start in enumerate(range(0, len(selected), frames_per_sheet), 1):
        group = selected[start:start + frames_per_sheet]
        canvas = Image.new(
            "RGB", (columns * tile_width, rows * (tile_height + label_height)), "white")
        draw = ImageDraw.Draw(canvas)
        sheet_frames = []
        for tile_index, selected_item in enumerate(group):
            frame_index = selected_item["index"]
            info = frame_infos[frame_index]
            with Image.open(info["path"]) as source:
                source = ImageOps.exif_transpose(source).convert("RGB")
                source_size = list(source.size)
                fitted = ImageOps.contain(source, (tile_width, tile_height), Image.Resampling.LANCZOS)
            column = tile_index % columns
            row = tile_index // columns
            x = column * tile_width + (tile_width - fitted.width) // 2
            y = row * (tile_height + label_height) + (tile_height - fitted.height) // 2
            canvas.paste(fitted, (x, y))
            draw.rectangle(
                (column * tile_width, row * (tile_height + label_height),
                 (column + 1) * tile_width - 1,
                 row * (tile_height + label_height) + tile_height - 1),
                outline="#8e99a8", width=1)
            if media_type == "photo":
                label = f"PHOTO {frame_index + 1:02d}"
            else:
                label = f"{info.get('timestamp_sec', 0.0):06.2f}s  F{frame_index + 1:04d}"
            draw.text(
                (column * tile_width + 6, row * (tile_height + label_height) + tile_height + 7),
                label, fill="#111111", font=font)
            frame_entry = {
                "frame_index": frame_index + 1,
                "timestamp_sec": info.get("timestamp_sec"),
                "reasons": selected_item["reasons"],
                "source_size": source_size,
                "rendered_size": [fitted.width, fitted.height],
                "sheet_number": sheet_number,
                "tile_index": tile_index + 1,
            }
            if media_type == "photo":
                frame_entry["photo_index"] = frame_index + 1
            selected_output.append(frame_entry)
            sheet_frames.append(frame_entry)

        sheet_path = output_dir / f"contact_sheet_{sheet_number:02d}.jpg"
        canvas.save(sheet_path, "JPEG", quality=92, optimize=True)
        sheets.append({
            "path": str(sheet_path),
            "sheet_number": sheet_number,
            "frame_count": len(group),
            "frames": sheet_frames,
        })
    return {
        "aspect_ratio_policy": "contain; preserve source ratio; never crop/stretch/circle",
        "tile_size": [tile_width, tile_height],
        "contact_sheets": sheets,
        "selected_frames": selected_output,
    }


def _is_cjk_like(s):
    return any("　" <= ch <= "鿿" for ch in s)


def merge_ocr_spans(frame_reads, max_gap_seconds=None):
    """frame_reads: list of (timestamp, text, confidence), time-sorted.
    Consecutive reads with fuzzy similarity >= threshold become one span.

    Dense sampling supplies ``max_gap_seconds`` so an identical telop that
    disappears and later returns is counted as a new appearance rather than
    one artificial span bridged across blank frames.  Adaptive legacy sampling
    keeps its prior behavior by leaving the argument as ``None``.
    """
    spans = []
    for ts, text, conf in frame_reads:
        if not text:
            continue
        if spans:
            last = spans[-1]
            ratio = difflib.SequenceMatcher(None, last["text"], text).ratio()
            within_gap = (
                max_gap_seconds is None
                or ts - last["end"] <= max_gap_seconds
            )
            if ratio >= FUZZY_MERGE_THRESHOLD and within_gap:
                last["end"] = ts
                last["confidences"].append(conf)
                if len(text) > len(last["text"]):
                    last["text"] = text  # keep the fuller reading
                continue
        spans.append({"start": ts, "end": ts, "text": text, "confidences": [conf]})
    for s in spans:
        s["avg_confidence"] = round(sum(s["confidences"]) / len(s["confidences"]), 1)
        del s["confidences"]
    return spans


def transcribe(model, media_path, source_type="video_audio"):
    segments, info = model.transcribe(
        str(media_path), language="ja", vad_filter=True, word_timestamps=True)
    out = []
    for s in segments:
        words = []
        for word in getattr(s, "words", []) or []:
            words.append({
                "start": round(word.start, 2) if word.start is not None else None,
                "end": round(word.end, 2) if word.end is not None else None,
                "text": word.word,
                "probability": round(word.probability, 4) if word.probability is not None else None,
            })
        out.append({
            "start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
            "words": words, "time_quality": "word_timestamp" if words else "segment_timestamp",
            "avg_logprob": getattr(s, "avg_logprob", None),
            "source_provenance": {"source_type": source_type, "path": str(media_path)},
        })
    return out, getattr(info, "language", None)


def decide_relevance(video_record, ocr_spans, asr_segments, brand, product):
    """Final (post-extraction) relevance call — see SKILL.md's two-pass
    design. Conservative: only 'relevant' on a real hit, otherwise
    'uncertain' for human review rather than a confident 'non_relevant'
    that could silently shrink the denominator."""
    if video_record.get("relevance_prefilter") == "likely_relevant":
        return "relevant", ["prefilter"]
    hits = []
    all_ocr_text = normalize_text(" ".join(s["text"] for s in ocr_spans))
    all_asr_text = normalize_text(" ".join(s["text"] for s in asr_segments))
    brand_n = normalize_text(brand) if brand else ""
    product_n = normalize_text(product) if product else ""
    if brand_n:
        if contains_term(all_ocr_text, brand_n):
            hits.append("ocr_brand")
        if contains_term(all_asr_text, brand_n):
            hits.append("asr_brand")
    if product_n:
        if contains_term(all_ocr_text, product_n):
            hits.append("ocr_product")
        if contains_term(all_asr_text, product_n):
            hits.append("asr_product")
    return ("relevant", hits) if hits else ("uncertain", [])


def process_video(video_record, media_path, whisper_model, max_frames, brand, product, tmp_dir,
                  has_audio=True, frames_root=None):
    video_tmp_dir = tmp_dir / safe_artifact_id(video_record["video_id"])
    video_tmp_dir.mkdir(parents=True, exist_ok=True)
    # フレームは run-dir 配下に残す。Claude がこれを読み、
    # import_agent_telop.py で telop として取り込む。
    frames_dir = (frames_root / safe_artifact_id(video_record["video_id"])) if frames_root else video_tmp_dir
    ts_list = get_scene_timestamps(media_path, max_frames)
    frame_reads = []
    frame_files = []
    for ts in ts_list:
        fp = extract_frame(media_path, ts, frames_dir)
        if fp:
            frame_files.append({"timestamp": round(ts, 2), "path": str(fp), "frame": fp.name})
        frame_reads.append((ts, "", -1.0))
    ocr_spans = merge_ocr_spans(frame_reads)
    low_confidence_spans = [s for s in ocr_spans if s["avg_confidence"] < 55]

    if has_audio and whisper_model:
        asr_segments, detected_lang = transcribe(whisper_model, media_path, "video_audio")
    else:
        asr_segments, detected_lang = [], None

    all_ocr_text = " ".join(s["text"] for s in ocr_spans)
    pr_final = has_pr_tag(
        ",".join(video_record.get("hashtags", [])), video_record.get("caption", ""), all_ocr_text
    )
    relevance_final, relevance_hits = decide_relevance(video_record, ocr_spans, asr_segments, brand, product)

    return {
        "video_id": video_record["video_id"],
        # import_agent_telop がこの2つで「別投稿の読み取り混入」と
        # 「動画長を超える timestamp」を検出する。欠けると検証が無言でスキップされる。
        "video_url": video_record.get("video_url"),
        "duration_seconds": video_record.get("duration_seconds"),
        # 動画は発話がありうるので音声を分母に含める（写真パス側で not_applicable にする）。
        # 音声トラックの有無だけで measured にすると、ASR が失敗・未実行でも
        # 「計測済み・0件」として下流に流れる。実際に走ったかは後段で上書きする
        "voice_channel": "pending" if has_audio else "not_applicable",
        "voice_channel_reason": None if has_audio else "音声トラックが無い",
        "media_type": "video",
        "sampling_mode": "adaptive_scene_grid",
        "sampling_fps": None,
        "frames_sampled": len(ts_list),
        "expected_frames": None,
        "sampling_coverage_ratio": None,
        "sampled_timestamps_sec": ts_list,
        # Claude が読むフレーム画像。ここが空だとテロップを取り込めない。
        "frames_dir": str(frames_dir),
        "frame_files": frame_files,
        "frames_retained": len(frame_files),
        # テロップ読み取りの被覆率。分母は抽出したコマ数。
        "telop_frames_total": len(frame_files),
        "telop_frames_read": 0,
        "ocr_spans": ocr_spans,
        "telop_measured": telop_is_measured(),
        "telop_source": TELOP_SOURCE,
        "low_confidence_ocr_span_count": len(low_confidence_spans),
        "asr_segments": asr_segments,
        "asr_detected_language": detected_lang,
        "pr_status_final": "pr" if pr_final else video_record.get("pr_status_prelim", "no_pr"),
        "relevance_final": relevance_final,
        "relevance_final_hits": relevance_hits,
        "ocr_sampling_note": f"scene-aware/fixed-grid sampling, max {max_frames} frames",
        "source_provenance": {
            "ocr_source_type": "sampled_video_frame",
            "ocr_media_path": str(media_path),
            "asr_source_type": "video_audio" if has_audio else None,
            "asr_media_path": str(media_path) if has_audio else None,
        },
    }


def process_video_dense(video_record, media_path, whisper_model, dense_fps, brand, product,
                        tmp_dir, review_dir, *, duration_seconds=None, has_audio=True,
                        reused_asr=None, requested_whisper_model=None):
    """OCR every frame from a 4fps decode and build bounded review sheets."""
    video_id = video_record["video_id"]
    file_id = safe_artifact_id(video_id)
    dense_tmp_dir = tmp_dir / file_id / _fps_token(dense_fps)
    review_video_dir = review_dir / file_id
    duration = duration_seconds if duration_seconds is not None else get_duration(media_path)
    try:
        frame_paths = extract_dense_frames(media_path, dense_tmp_dir, dense_fps)
        frame_infos = []
        frame_reads = []
        ocr_errors = []
        for index, frame_path in enumerate(frame_paths):
            timestamp = round(index / dense_fps, 3)
            try:
                text, confidence = ocr_image(frame_path)
            except Exception as exc:
                text, confidence = "", 0.0
                ocr_errors.append({
                    "frame_index": index + 1,
                    "timestamp_sec": timestamp,
                    "error": str(exc),
                })
            try:
                signature = _frame_signature(frame_path)
            except Exception:
                signature = None
            frame_reads.append((timestamp, text, confidence))
            frame_infos.append({
                "path": frame_path,
                "timestamp_sec": timestamp,
                "text": text,
                "confidence": confidence,
                "signature": signature,
            })

        ocr_spans = merge_ocr_spans(
            frame_reads, max_gap_seconds=max(0.75, 2.5 / dense_fps))
        low_confidence_spans = [span for span in ocr_spans if span["avg_confidence"] < 55]
        review = create_contact_sheets(frame_infos, review_video_dir, media_type="video")

        if reused_asr is not None:
            asr_segments = reused_asr.get("segments", [])
            detected_lang = reused_asr.get("language")
            asr_reused = True
            asr_model_actual = reused_asr.get("model")
            asr_completed = True
            asr_status = "reused_completed"
        elif has_audio and whisper_model:
            asr_segments, detected_lang = transcribe(whisper_model, media_path, "video_audio")
            asr_reused = False
            asr_model_actual = requested_whisper_model
            asr_completed = True
            asr_status = "completed"
        else:
            asr_segments, detected_lang = [], None
            asr_reused = False
            asr_model_actual = None
            asr_completed = not has_audio
            asr_status = "not_required" if not has_audio else "missing"

        all_ocr_text = " ".join(span["text"] for span in ocr_spans)
        pr_final = has_pr_tag(
            ",".join(video_record.get("hashtags", [])), video_record.get("caption", ""),
            all_ocr_text)
        relevance_final, relevance_hits = decide_relevance(
            video_record, ocr_spans, asr_segments, brand, product)

        expected_frames = expected_dense_frame_count(duration, dense_fps)
        sampled = len(frame_paths)
        coverage = (
            round(sampled / expected_frames, 4) if expected_frames else None
        )
        analyzed_duration = (
            round(min(duration, sampled / dense_fps), 3)
            if duration is not None else round(sampled / dense_fps, 3)
        )
        review_entry = {
            "video_id": video_id,
            "video_url": video_record.get("video_url"),
            "media_type": "video",
            "sampling_mode": _fps_token(dense_fps),
            "sampling_fps": dense_fps,
            "duration_seconds": duration,
            "duration_analyzed_seconds": analyzed_duration,
            "expected_frame_count": expected_frames,
            "ocr_frame_count": sampled,
            "ocr_error_count": len(ocr_errors),
            **review,
        }
        incomplete_reasons = []
        if ocr_errors:
            incomplete_reasons.append(
                f"OCR failed for {len(ocr_errors)}/{sampled} dense frames; rerun before measurement")
        if has_audio and not asr_completed:
            incomplete_reasons.append("ASR was required but did not complete")
        return {
            "video_id": video_id,
            "media_type": "video",
            "sampling_mode": _fps_token(dense_fps),
            "sampling_fps": dense_fps,
            "frames_sampled": sampled,
            "expected_frames": expected_frames,
            "sampling_coverage_ratio": coverage,
            "duration_seconds": duration,
            "duration_analyzed_seconds": analyzed_duration,
            "sampled_timestamps_sec": [info["timestamp_sec"] for info in frame_infos],
            "ocr_frames_attempted": sampled,
            "ocr_frame_error_count": len(ocr_errors),
            "ocr_frame_errors": ocr_errors,
            "ocr_spans": ocr_spans,
        "telop_measured": telop_is_measured(),
        "telop_source": TELOP_SOURCE,
            "low_confidence_ocr_span_count": len(low_confidence_spans),
            "asr_segments": asr_segments,
            "asr_detected_language": detected_lang,
            "asr_required": has_audio,
            "asr_completed": asr_completed,
            "asr_status": asr_status,
            # ASR が実際に完了したかで音声チャネルを確定する。
            # pending のまま下流へ流すと「計測済み・0件」と誤集計される
            "voice_channel": ("not_applicable" if not has_audio
                              else ("measured" if asr_completed else "unmeasured")),
            "voice_channel_reason": (None if not has_audio else
                                     (None if asr_completed
                                      else f"音声の文字起こしが完了していない（{asr_status}）")),
            "asr_model_actual": asr_model_actual,
            "asr_reused_from_existing_signal": asr_reused,
            "asr_reused_source_analysis_profile": (
                reused_asr.get("source_analysis_profile") if reused_asr else None
            ),
            "pr_status_final": "pr" if pr_final else video_record.get("pr_status_prelim", "no_pr"),
            "relevance_final": relevance_final,
            "relevance_final_hits": relevance_hits,
            "ocr_sampling_note": (
                f"complete video decoded at {dense_fps:g} fps; OCR attempted on every decoded frame; "
                f"contact sheets are representative review frames only"
            ),
            "visual_review_contact_sheet_paths": [
                sheet["path"] for sheet in review.get("contact_sheets", [])
            ],
            "source_provenance": {
                "ocr_source_type": "dense_video_frames",
                "ocr_media_path": str(media_path),
                "asr_source_type": "video_audio" if has_audio else None,
                "asr_media_path": str(media_path) if has_audio else None,
            },
            "_visual_review_entry": review_entry,
            "_incomplete_reasons": incomplete_reasons,
        }
    finally:
        # Raw 4fps JPEGs are a transient OCR substrate.  The bounded, labeled
        # contact sheets remain for Agent/human review; the source video remains
        # in media/ for later evidence-frame extraction.
        shutil.rmtree(dense_tmp_dir, ignore_errors=True)


def process_photo_post(video_record, photo_paths, audio_path, whisper_model, brand, product,
                       reused_asr=None, requested_whisper_model=None):
    """OCR every acquired TikTok photo and ASR the retained post audio.

    Photo OCR spans deliberately have no timestamps.  A carousel image has a
    stable order but no truthful presentation time, so assigning synthetic
    seconds would cause measure_keywords.py to merge unrelated OCR and speech.
    """
    ocr_spans = []
    for photo_index, photo_path in enumerate(photo_paths, 1):
        text, confidence = ocr_image(photo_path)
        if not text:
            continue
        ocr_spans.append({
            "start": None,
            "end": None,
            "text": text,
            "avg_confidence": round(confidence, 1),
            "source_provenance": {
                "source_type": "actual_tiktok_photo",
                "path": str(photo_path),
                "photo_index": photo_index,
            },
        })
    low_confidence_spans = [span for span in ocr_spans if span["avg_confidence"] < 55]

    if reused_asr is not None:
        asr_segments = reused_asr.get("segments", [])
        detected_lang = reused_asr.get("language")
        asr_reused = True
        asr_model_actual = reused_asr.get("model")
        asr_completed = True
        asr_status = "reused_completed"
    elif audio_path and whisper_model:
        asr_segments, detected_lang = transcribe(
            whisper_model, audio_path, "tiktok_photo_audio")
        asr_reused = False
        asr_model_actual = requested_whisper_model
        asr_completed = True
        asr_status = "completed"
    else:
        asr_segments, detected_lang = [], None
        asr_reused = False
        asr_model_actual = None
        asr_completed = not bool(audio_path)
        asr_status = "not_required" if not audio_path else "missing"

    all_ocr_text = " ".join(span["text"] for span in ocr_spans)
    pr_final = has_pr_tag(
        ",".join(video_record.get("hashtags", [])), video_record.get("caption", ""), all_ocr_text)
    relevance_final, relevance_hits = decide_relevance(
        video_record, ocr_spans, asr_segments, brand, product)
    return {
        "video_id": video_record["video_id"],
        "video_url": video_record.get("video_url"),
        "duration_seconds": video_record.get("duration_seconds"),
        # 写真投稿はBGMのみで投稿者の発話が無い。音声を分母に入れると
        # 楽曲の歌詞をキーワード言及として数えてしまうため、構造的に対象外とする。
        "voice_channel": "not_applicable",
        "voice_channel_reason": "写真投稿はBGMのみで投稿者の発話が無い前提。楽曲歌詞の誤計上を避けるためASR対象外",
        # テロップの読み取り対象は <id>_photos/NN.jpg そのもの（フレーム抽出はしない）。
        "photo_paths": [str(p) for p in photo_paths],
        "media_type": "photo",
        "sampling_mode": "photo_all_images",
        "sampling_fps": None,
        "frames_sampled": len(photo_paths),
        "expected_frames": len(photo_paths),
        "sampling_coverage_ratio": 1.0 if photo_paths else None,
        "sampled_timestamps_sec": [],
        # 機械OCRは撤去済みなので、この時点で読み取れている枚数は 0。
        # 取り込み後に import_agent_telop が telop_frames_read を書く。
        "photos_ocrd": 0,
        "photos_extracted": len(photo_paths),
        # テロップ読み取りの被覆率。分母は写真の枚数。
        "telop_frames_total": len(photo_paths),
        "telop_frames_read": 0,
        "ocr_spans": ocr_spans,
        "telop_measured": telop_is_measured(),
        "telop_source": TELOP_SOURCE,
        "low_confidence_ocr_span_count": len(low_confidence_spans),
        "asr_segments": asr_segments,
        "asr_detected_language": detected_lang,
        "asr_required": bool(audio_path),
        "asr_completed": asr_completed,
        "asr_status": asr_status,
        "asr_model_actual": asr_model_actual,
        "asr_reused_from_existing_signal": asr_reused,
        "asr_reused_source_analysis_profile": (
            reused_asr.get("source_analysis_profile") if reused_asr else None
        ),
        "pr_status_final": "pr" if pr_final else video_record.get("pr_status_prelim", "no_pr"),
        "relevance_final": relevance_final,
        "relevance_final_hits": relevance_hits,
        "ocr_sampling_note": "写真は全枚を抽出済み。読み取りは import_agent_telop での取り込み分のみ",
        "source_provenance": {
            "ocr_source_type": "actual_tiktok_photo",
            "ocr_photo_paths": [str(path) for path in photo_paths],
            "asr_source_type": "tiktok_photo_audio" if audio_path else None,
            "asr_media_path": str(audio_path) if audio_path else None,
        },
        "_incomplete_reasons": (
            ["ASR was required but did not complete"] if audio_path and not asr_completed else []
        ),
    }


def safe_acquired_path(raw_path, media_dir):
    """Reject tampered checkpoint paths that escape this run's media folder."""
    if not raw_path:
        return None
    try:
        path = Path(raw_path).resolve(strict=True)
        path.relative_to(media_dir.resolve(strict=True))
    except (OSError, ValueError):
        return None
    return path if path.is_file() else None


def resolve_photo_acquisition(acquisition, media_dir):
    """Require the complete ordered carousel and any logged audio to exist."""
    logged_photo_paths = acquisition.get("photo_paths", [])
    expected_photo_count = acquisition.get("photo_count_expected", len(logged_photo_paths))
    if len(logged_photo_paths) != expected_photo_count:
        raise ValueError(
            f"photo-mode checkpoint is incomplete: {len(logged_photo_paths)}/{expected_photo_count} paths")
    photo_paths = [safe_acquired_path(raw_path, media_dir) for raw_path in logged_photo_paths]
    if any(path is None for path in photo_paths):
        raise ValueError("one or more acquired TikTok photo paths are missing or unsafe")
    logged_audio_path = acquisition.get("audio_path")
    audio_path = safe_acquired_path(logged_audio_path, media_dir)
    if logged_audio_path and audio_path is None:
        raise ValueError("acquired TikTok photo audio path is missing or unsafe")
    return photo_paths, audio_path


def latest_successful_checkpoint_ids(log_path, acquisitions=None, analysis_profile=None):
    latest = {}
    for item in read_jsonl(log_path):
        video_id = item.get("video_id")
        if not video_id:
            continue
        if analysis_profile is None:
            key = video_id
        else:
            # Profiles are independent checkpoints: a later dense run must not
            # erase the earlier adaptive success (or vice versa).
            key = (video_id, item.get("analysis_profile"))
        latest[key] = item
    successful = set()
    for key, item in latest.items():
        video_id = key if analysis_profile is None else key[0]
        if analysis_profile is not None and key[1] != analysis_profile:
            continue
        if item.get("status") != "ok":
            continue
        acquisition = (acquisitions or {}).get(video_id)
        if acquisition is None:
            successful.add(video_id)
            continue
        current_fingerprint = acquisition.get("acquisition_sha256")
        checkpoint_fingerprint = item.get("acquisition_sha256")
        if current_fingerprint == checkpoint_fingerprint:
            successful.add(video_id)
    return successful


def missing_adaptive_checkpoint_ids(log_path, acquisitions):
    """Return current acquisitions lacking a successful adaptive full-corpus pass.

    Dense top-N signals overwrite selected per-video JSON files by design, so
    prerequisite validation is based on profile-aware extraction checkpoints,
    not the current signal file's sampling mode.
    """
    latest = {}
    for item in read_jsonl(log_path):
        profile = item.get("analysis_profile")
        video_id = item.get("video_id")
        if video_id and isinstance(profile, str) and profile.startswith("adaptive_scene_grid_max"):
            latest[(video_id, profile)] = item
    missing = []
    for video_id, acquisition in acquisitions.items():
        fingerprint = acquisition.get("acquisition_sha256")
        complete = any(
            candidate_id == video_id
            and item.get("status") == "ok"
            and fingerprint
            and item.get("acquisition_sha256") == fingerprint
            for (candidate_id, _profile), item in latest.items()
        )
        if not complete:
            missing.append(video_id)
    return sorted(missing)


def _load_json_object(path, fallback):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else fallback
    except (OSError, json.JSONDecodeError):
        return fallback


def _reusable_asr(signal_path, acquisition, requested_model):
    """Reuse full-audio ASR when dense mode only changes visual sampling."""
    signal = _load_json_object(signal_path, {})
    if signal.get("status") != "ok":
        return None
    fingerprint = acquisition.get("acquisition_sha256")
    if not fingerprint or signal.get("acquisition_sha256") != fingerprint:
        return None
    if not isinstance(signal.get("asr_segments"), list):
        return None
    # Only reuse a transcript produced by the same requested model.  This keeps
    # the dense signal from claiming a model that did not actually generate it.
    actual_model = signal.get("asr_model_actual") or signal.get("whisper_model")
    if not actual_model or actual_model != requested_model:
        return None
    return {
        "segments": signal["asr_segments"],
        "language": signal.get("asr_detected_language"),
        "source_analysis_profile": signal.get("analysis_profile"),
        "model": actual_model,
    }


def _dense_review_complete(review_manifest, video_id):
    entry = (review_manifest.get("videos") or {}).get(video_id)
    if not entry or not entry.get("contact_sheets"):
        return False
    return all(
        Path(sheet.get("path", "")).is_file()
        and Path(sheet["path"]).stat().st_size > 1000
        for sheet in entry["contact_sheets"]
    )


def _signal_uses_requested_asr(signal, acquisition, requested_model):
    media_type = acquisition.get("media_type") or "video"
    asr_required = (
        bool(acquisition.get("audio_path")) if media_type == "photo"
        else acquisition.get("has_audio") is not False
    )
    if not asr_required:
        return True
    actual_model = signal.get("asr_model_actual") or signal.get("whisper_model")
    return signal.get("asr_completed") is True and actual_model == requested_model


def _dense_signal_complete_payload(signal, profile, acquisition, requested_model=None):
    if signal.get("status") != "ok":
        return False
    if signal.get("acquisition_sha256") != acquisition.get("acquisition_sha256"):
        return False
    media_type = acquisition.get("media_type") or "video"
    if requested_model is not None and not _signal_uses_requested_asr(
            signal, acquisition, requested_model):
        return False
    if media_type == "photo":
        expected = acquisition.get("photo_count_expected", len(acquisition.get("photo_paths", [])))
        return (
            signal.get("sampling_mode") == "photo_all_images"
            and signal.get("photos_ocrd") == expected
        )
    return (
        signal.get("analysis_profile") == profile
        and signal.get("sampling_mode") == profile
        and signal.get("ocr_frames_attempted") == signal.get("frames_sampled")
        and signal.get("ocr_frame_error_count", 0) == 0
    )


def _dense_signal_complete(signal_path, profile, acquisition, requested_model=None):
    return _dense_signal_complete_payload(
        _load_json_object(signal_path, {}), profile, acquisition, requested_model)


def _adaptive_signal_complete(signal_path, profile, acquisition, requested_model):
    """Accept the requested adaptive signal or a richer dense replacement."""
    signal = _load_json_object(signal_path, {})
    if signal.get("status") != "ok":
        return False
    if signal.get("acquisition_sha256") != acquisition.get("acquisition_sha256"):
        return False
    if not _signal_uses_requested_asr(signal, acquisition, requested_model):
        return False
    sampling_mode = signal.get("sampling_mode")
    if (acquisition.get("media_type") or "video") == "photo":
        return sampling_mode == "photo_all_images"
    return sampling_mode == profile or str(sampling_mode or "").startswith("dense_")


def _photo_review_entry(video_record, photo_paths, result, review_video_dir):
    frame_infos = []
    text_by_photo = {}
    for span in result.get("ocr_spans", []):
        provenance = span.get("source_provenance") or {}
        if provenance.get("photo_index"):
            text_by_photo[provenance["photo_index"]] = span.get("text", "")
    for index, photo_path in enumerate(photo_paths, 1):
        try:
            signature = _frame_signature(photo_path)
        except Exception:
            signature = None
        frame_infos.append({
            "path": photo_path,
            "timestamp_sec": None,
            "text": text_by_photo.get(index, ""),
            "signature": signature,
        })
    review = create_contact_sheets(
        frame_infos, review_video_dir,
        max_frames=max(DENSE_CONTACT_SHEET_MAX_FRAMES, len(photo_paths)),
        media_type="photo", include_all=True)
    return {
        "video_id": video_record["video_id"],
        "video_url": video_record.get("video_url"),
        "media_type": "photo",
        "sampling_mode": "photo_all_images",
        "sampling_fps": None,
        "expected_frame_count": len(photo_paths),
        "ocr_frame_count": len(photo_paths),
        "ocr_error_count": 0,
        **review,
    }


def _selection_appearances(video_id, axes):
    appearances = []
    for axis in axes:
        match = next(
            (item for item in axis.get("selected", []) if item.get("video_id") == video_id),
            None)
        if match:
            appearances.append({
                "source_file": axis.get("source_file"),
                "label": axis.get("label"),
                "role": axis.get("role"),
                "rank": match.get("rank"),
            })
    return appearances


def _write_dense_selection_manifest(path, manifest):
    videos = manifest.get("videos", {})
    manifest["completed_video_count"] = sum(
        item.get("analysis_complete") is True for item in videos.values())
    manifest["incomplete_video_ids"] = [
        video_id for video_id in manifest.get("union_video_ids", [])
        if not videos.get(video_id, {}).get("analysis_complete")
    ]
    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--confirmed-config", required=True)
    ap.add_argument("--reset-telop", action="store_true",
                    help="再解析時に取り込み済みテロップを引き継がず破棄する（既定は引き継ぐ）")
    ap.add_argument("--video-ids", default=None)
    ap.add_argument(
        "--force", action="store_true",
        help="reprocess only the IDs explicitly supplied with --video-ids, ignoring successful checkpoints",
    )
    ap.add_argument("--max-frames", type=int, default=MAX_FRAMES_DEFAULT)
    ap.add_argument("--max-duration-seconds", type=float, default=MAX_DURATION_DEFAULT)
    ap.add_argument("--whisper-model", default="small")
    ap.add_argument(
        "--dense-top-n-per-source", type=int, default=None,
        help=(
            "after ordinary full-corpus extraction, re-analyze the first N unique posts "
            "within every source_file using dense OCR (approved default workflow: 10)"
        ),
    )
    ap.add_argument(
        "--dense-fps", type=float, default=DENSE_FPS_DEFAULT,
        help="frame rate for --dense-top-n-per-source (approved default: 4)",
    )
    args = ap.parse_args()
    if args.force and not args.video_ids:
        ap.error("--force is allowed only with an explicit --video-ids list")
    if args.dense_top_n_per_source is not None and args.video_ids:
        ap.error("--dense-top-n-per-source cannot be combined with --video-ids")
    if args.dense_top_n_per_source is not None and args.dense_top_n_per_source <= 0:
        ap.error("--dense-top-n-per-source must be a positive integer")
    if args.dense_fps <= 0 or args.dense_fps > 16:
        ap.error("--dense-fps must be greater than 0 and no more than 16")
    if args.dense_top_n_per_source is not None and args.dense_top_n_per_source != DENSE_TOP_N_DEFAULT:
        ap.error(f"approved dense workflow requires --dense-top-n-per-source {DENSE_TOP_N_DEFAULT}")
    if args.dense_top_n_per_source is not None and not math.isclose(
            args.dense_fps, DENSE_FPS_DEFAULT, abs_tol=1e-9):
        ap.error(f"approved dense workflow requires --dense-fps {DENSE_FPS_DEFAULT:g}")

    run_dir = Path(args.run_dir)
    cfg = json.loads(Path(args.confirmed_config).read_text(encoding="utf-8"))
    brand = cfg.get("brand")
    # 旧 run-dir は product_name にだけ入っている。両方見る。
    product = cfg.get("product") or cfg.get("product_name")

    video_list = read_jsonl(run_dir / "normalized" / "videos.jsonl")
    videos = {v["video_id"]: v for v in video_list}
    media_dir = run_dir / "media"
    acquisitions = {}
    for record in read_jsonl(media_dir / "acquire_log.jsonl"):
        if record.get("video_id"):
            acquisitions[record["video_id"]] = record
    ok_acquisitions = {
        video_id: record for video_id, record in acquisitions.items()
        if record.get("status") == "ok" and record.get("media_type") in (None, "video", "photo")
    }

    signals_dir = run_dir / "signals"
    signals_dir.mkdir(parents=True, exist_ok=True)
    log_path = signals_dir / "extract_log.jsonl"
    dense_mode = args.dense_top_n_per_source is not None
    dense_axes = []
    selection_manifest_path = None
    selection_manifest = None
    review_manifest_path = None
    review_manifest = None
    if dense_mode:
        missing_adaptive = missing_adaptive_checkpoint_ids(log_path, ok_acquisitions)
        if missing_adaptive:
            shown = ", ".join(missing_adaptive[:12])
            suffix = f" (+{len(missing_adaptive) - 12} more)" if len(missing_adaptive) > 12 else ""
            ap.error(
                "dense top-10 analysis requires the ordinary adaptive full-corpus pass first; "
                f"missing current checkpoints for: {shown}{suffix}. Run extract_signals.py "
                "without --dense-top-n-per-source, then rerun this command."
            )
        target_ids, dense_axes = select_top_unique_per_source(
            video_list, args.dense_top_n_per_source)
        analysis_profile = _fps_token(args.dense_fps)
        selection_manifest = {
            "version": "1.0",
            "selection_policy": "first N unique videos by source_appearances.rank per source_file",
            "top_n_per_source": args.dense_top_n_per_source,
            "sampling_fps": args.dense_fps,
            "analysis_profile": analysis_profile,
            "axes": dense_axes,
            "union_video_ids": target_ids,
            "union_video_count": len(target_ids),
            "acquired_video_ids": [video_id for video_id in target_ids if video_id in ok_acquisitions],
            "missing_acquisition_video_ids": [
                video_id for video_id in target_ids if video_id not in ok_acquisitions
            ],
            "videos": {
                video_id: {
                    "video_id": video_id,
                    "appearances": _selection_appearances(video_id, dense_axes),
                    "acquisition_status": (
                        "ok" if video_id in ok_acquisitions else "missing_acquisition"
                    ),
                    "acquisition_sha256": (
                        ok_acquisitions.get(video_id, {}).get("acquisition_sha256")
                    ),
                    "analysis_status": (
                        "pending" if video_id in ok_acquisitions else "missing_acquisition"
                    ),
                    "analysis_complete": False,
                    "analysis_profile": analysis_profile,
                }
                for video_id in target_ids
            },
        }
        selection_manifest_path = signals_dir / "dense_selection_manifest.json"
        _write_dense_selection_manifest(selection_manifest_path, selection_manifest)

        review_root = run_dir / "visual_review" / analysis_profile
        review_root.mkdir(parents=True, exist_ok=True)
        review_manifest_path = review_root / "manifest.json"
        existing_review = _load_json_object(review_manifest_path, {})
        existing_videos = existing_review.get("videos", {}) if (
            existing_review.get("analysis_profile") == analysis_profile) else {}
        review_manifest = {
            "version": "1.0",
            "analysis_profile": analysis_profile,
            "sampling_policy": {
                "video_ocr": f"all decoded frames at {args.dense_fps:g} fps",
                "photo_ocr": "every acquired TikTok photo once",
                "agent_review": (
                    "bounded contact sheets selected from opening, OCR changes, visual changes, "
                    "and timeline anchors"
                ),
                "aspect_ratio": "contain; preserve source ratio; never crop/stretch/circle",
            },
            "axes": dense_axes,
            "videos": {
                video_id: existing_videos[video_id]
                for video_id in target_ids if video_id in existing_videos
            },
        }
        for video_id in target_ids:
            if video_id not in ok_acquisitions:
                review_manifest["videos"][video_id] = {
                    "video_id": video_id,
                    "status": "missing_acquisition",
                    "contact_sheets": [],
                }
        review_manifest_path.write_text(
            json.dumps(review_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        target_ids = args.video_ids.split(",") if args.video_ids else list(ok_acquisitions.keys())
        analysis_profile = f"adaptive_scene_grid_max{args.max_frames}"

    already_done = (
        set() if args.force else latest_successful_checkpoint_ids(
            log_path, ok_acquisitions, analysis_profile=analysis_profile)
    )
    if dense_mode:
        # A dense signal without its review artifact is not a complete dense
        # checkpoint; regenerate it instead of silently skipping Agent evidence.
        already_done = {
            video_id for video_id in already_done
            if _dense_review_complete(review_manifest, video_id)
            and _dense_signal_complete(
                signals_dir / f"{safe_artifact_id(video_id)}.json",
                analysis_profile, ok_acquisitions[video_id], args.whisper_model)
        }
        for video_id in already_done:
            cached_signal = _load_json_object(
                signals_dir / f"{safe_artifact_id(video_id)}.json", {})
            selection_manifest["videos"][video_id].update({
                "analysis_status": "cached_completed",
                "analysis_complete": True,
                "completion_fingerprint": ok_acquisitions[video_id].get("acquisition_sha256"),
                "frames_sampled": cached_signal.get("frames_sampled"),
                "ocr_frame_error_count": cached_signal.get("ocr_frame_error_count", 0),
                "asr_completed": cached_signal.get("asr_completed"),
                "asr_model_actual": cached_signal.get("asr_model_actual"),
            })
        _write_dense_selection_manifest(selection_manifest_path, selection_manifest)
    else:
        # A profile log alone is insufficient when the requested ASR model
        # changes or a later run replaced the signal file.  Reprocess unless
        # the current signal is tied to the same media and actual ASR model.
        already_done = {
            video_id for video_id in already_done
            if _adaptive_signal_complete(
                signals_dir / f"{safe_artifact_id(video_id)}.json",
                analysis_profile, ok_acquisitions[video_id], args.whisper_model)
        }
    to_process = [vid for vid in target_ids if vid in ok_acquisitions and vid not in already_done]

    print(
        f"profile={analysis_profile} target={len(target_ids)} "
        f"already_done={len(already_done)} to_process={len(to_process)}")
    if not to_process:
        # 「対象0本」を無風で通すと、後段の measure_keywords が
        # 「すべて計測済み」と書き、資料に未計測が計測値として載る。
        # 全部済んでいるのか、1本も無いのかを分けて、後者では止める
        if already_done and len(already_done) >= len(target_ids) > 0:
            print(f"  すべて処理済みです（{len(already_done)} 件）")
            return
        print("\n[STOP] 解析できる動画が1本もありません。")
        print(f"  対象 {len(target_ids)} 件 / 取得できている動画 {len(ok_acquisitions)} 件")
        if not ok_acquisitions:
            print("  media/acquire_log.jsonl が無いか、動画のダウンロードが1本も成功していません。")
            print("  先に取得モジュール（tiktok-acquire）の fetch モードで動画実体を取得してください:")
            print("    node search.mjs --mode fetch --urls-file urls.txt --run-dir <run-dir>")
        print("  このまま先へ進めると、未計測が「計測済み」として資料に載ります。")
        return 2

    # Dense mode changes only visual sampling.  Reuse the already completed
    # full-audio transcript when it is tied to the exact same media bytes.
    asr_reuse = {}
    if dense_mode:
        for video_id in to_process:
            reusable = _reusable_asr(
                signals_dir / f"{safe_artifact_id(video_id)}.json",
                ok_acquisitions[video_id], args.whisper_model)
            if reusable is not None:
                asr_reuse[video_id] = reusable

    # All ordinary videos may contain audio.  Photo posts only require Whisper
    # when an audio path was actually retained and no safe transcript is reusable.
    needs_asr = any(
        video_id not in asr_reuse and (
            (record.get("media_type") == "photo" and record.get("audio_path"))
            or (record.get("media_type") != "photo" and record.get("has_audio") is not False)
        )
        for video_id, record in ok_acquisitions.items() if video_id in to_process
    )
    model = None
    if needs_asr:
        print(f"loading faster-whisper model '{args.whisper_model}' ...")
        from faster_whisper import WhisperModel
        model = WhisperModel(args.whisper_model, device="cpu", compute_type="int8")

    tmp_dir = run_dir / "tmp" / "extract_frames"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    for i, vid in enumerate(to_process, 1):
        acquisition = ok_acquisitions[vid]
        video_record = videos.get(vid, {"video_id": vid})
        try:
            media_type = acquisition.get("media_type") or "video"
            if media_type == "photo":
                photo_paths, audio_path = resolve_photo_acquisition(acquisition, media_dir)
                if not photo_paths:
                    raise ValueError("photo-mode acquisition has no safe existing photo paths")
                duration = get_duration(audio_path) if audio_path else None
                if duration and duration > args.max_duration_seconds:
                    result = {
                        "video_id": vid, "status": "skipped_too_long", "media_type": "photo",
                        "duration_seconds": duration,
                        "error": f"photo-mode audio exceeds safety limit {args.max_duration_seconds}s; rerun with an explicit higher limit after review",
                    }
                else:
                    result = process_photo_post(
                        video_record, photo_paths, audio_path, model, brand, product,
                        reused_asr=asr_reuse.get(vid),
                        requested_whisper_model=args.whisper_model)
                    if dense_mode:
                        review_entry = _photo_review_entry(
                            video_record, photo_paths, result,
                            review_root / safe_artifact_id(vid))
                        result["visual_review_contact_sheet_paths"] = [
                            sheet["path"] for sheet in review_entry.get("contact_sheets", [])
                        ]
                        result["_visual_review_entry"] = review_entry
                    incomplete_reasons = result.pop("_incomplete_reasons", [])
                    result["status"] = "error" if incomplete_reasons else "ok"
                    if incomplete_reasons:
                        result["error"] = "; ".join(incomplete_reasons)
                    result["whisper_model"] = result.get("asr_model_actual")
                    result["max_frames"] = None
            else:
                media_path = safe_acquired_path(acquisition.get("path"), media_dir)
                if media_path is None:
                    raise ValueError("video acquisition has no safe existing video path")
                duration = get_duration(media_path)
                if duration and duration > args.max_duration_seconds:
                    result = {
                        "video_id": vid, "status": "skipped_too_long", "media_type": "video",
                        "duration_seconds": duration,
                        "error": f"duration exceeds safety limit {args.max_duration_seconds}s; rerun with an explicit higher limit after review",
                    }
                else:
                    has_audio = acquisition.get("has_audio") is not False
                    if dense_mode:
                        result = process_video_dense(
                            video_record, media_path, model, args.dense_fps, brand, product,
                            tmp_dir, review_root, duration_seconds=duration,
                            has_audio=has_audio, reused_asr=asr_reuse.get(vid),
                            requested_whisper_model=args.whisper_model)
                    else:
                        result = process_video(
                            video_record, media_path, model, args.max_frames, brand, product, tmp_dir,
                            has_audio=has_audio, frames_root=(run_dir / "frames"))
                    incomplete_reasons = result.pop("_incomplete_reasons", [])
                    result["status"] = "error" if incomplete_reasons else "ok"
                    if incomplete_reasons:
                        result["error"] = "; ".join(incomplete_reasons)
                    if not dense_mode:
                        result.update({
                            "asr_required": has_audio,
                            "asr_completed": True,
                            "asr_status": "completed" if has_audio else "not_required",
                            "asr_model_actual": args.whisper_model if has_audio else None,
                            # ここで確定させないと "pending" のまま signal に書かれ、
                            # 下流で「計測済みのASRが未計測」に化ける（分母が全件ゼロになる）
                            "voice_channel": "measured" if has_audio else "not_applicable",
                            "voice_channel_reason": None if has_audio else "音声トラックが無い",
                        })
                    result["whisper_model"] = result.get("asr_model_actual")
                    result["max_frames"] = None if dense_mode else args.max_frames
        except Exception as e:
            result = {"video_id": vid, "status": "error", "error": str(e)}
        visual_review_entry = result.pop("_visual_review_entry", None)
        result["analysis_profile"] = analysis_profile
        result["acquisition_sha256"] = acquisition.get("acquisition_sha256")
        if dense_mode:
            result["visual_review_manifest_path"] = str(review_manifest_path)
            if visual_review_entry:
                visual_review_entry["status"] = result["status"]
                visual_review_entry["acquisition_sha256"] = acquisition.get("acquisition_sha256")
                visual_review_entry["appearances"] = _selection_appearances(vid, dense_axes)
                review_manifest["videos"][vid] = visual_review_entry
            else:
                review_manifest["videos"][vid] = {
                    "video_id": vid,
                    "status": result["status"],
                    "error": result.get("error"),
                    "contact_sheets": [],
                    "acquisition_sha256": acquisition.get("acquisition_sha256"),
                }
            review_manifest_path.write_text(
                json.dumps(review_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            analysis_complete = (
                result.get("status") == "ok"
                and _dense_signal_complete_payload(
                    result, analysis_profile, acquisition, args.whisper_model)
            )
            selection_manifest["videos"][vid].update({
                "analysis_status": "completed" if analysis_complete else result.get("status", "error"),
                "analysis_complete": analysis_complete,
                "completion_fingerprint": (
                    acquisition.get("acquisition_sha256") if analysis_complete else None
                ),
                "frames_sampled": result.get("frames_sampled"),
                "expected_frames": result.get("expected_frames"),
                "ocr_frame_error_count": result.get("ocr_frame_error_count", 0),
                "asr_completed": result.get("asr_completed"),
                "asr_model_actual": result.get("asr_model_actual"),
                "error": result.get("error"),
            })
        # 取り込み済みのテロップ読み取りを引き継ぐ。
        # フレームを読む作業は人手（Claude）のコストが高く、再解析で黙って
        # 捨てると telop_measured が false に戻り「見せ方が無い」と誤集計される。
        sig_path = signals_dir / f"{safe_artifact_id(vid)}.json"
        if sig_path.exists() and not getattr(args, "reset_telop", False):
            try:
                prev = json.loads(sig_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                prev = {}
            if prev.get("telop_measured") and prev.get("ocr_spans"):
                result["ocr_spans"] = prev["ocr_spans"]
                result["telop_measured"] = True
                result["telop_source"] = prev.get("telop_source")
                result["telop_import"] = prev.get("telop_import")
                result["telop_carried_over"] = {
                    "reason": "再解析前の読み取りを引き継いだ（--reset-telop で破棄できる）",
                    "spans": len(prev["ocr_spans"]),
                }
        sig_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        append_jsonl(log_path, {
            "video_id": vid,
            "status": result["status"],
            "analysis_profile": analysis_profile,
            "sampling_mode": result.get("sampling_mode"),
            "sampling_fps": result.get("sampling_fps"),
            "acquisition_sha256": acquisition.get("acquisition_sha256"),
        })
        if dense_mode:
            # Publish completion only after both the signal payload and its
            # checkpoint log are durable.  An interrupted write must leave the
            # selection entry pending/incomplete, never falsely completed.
            _write_dense_selection_manifest(selection_manifest_path, selection_manifest)
        print(f"[{i}/{len(to_process)}] {vid}: {result['status']}"
              + (f" frames={result.get('frames_sampled')} ocr_spans={len(result.get('ocr_spans', []))} "
                 f"asr_segs={len(result.get('asr_segments', []))} relevance={result.get('relevance_final')}"
                 if result["status"] == "ok" else f" error={result.get('error')}"))


if __name__ == "__main__":
    sys.exit(main() or 0)
