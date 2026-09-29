#!/usr/bin/env python3
"""Safely import TikTok photo-mode images captured by a logged-in browser.

This is an explicit, audited fallback for posts whose public-page downloader
returns only the post audio.  It never discovers files by glob: the operator
must provide their exact carousel order in a JSON manifest.  Every referenced
artifact is required to resolve below ``<run-dir>/media`` and to belong to the
manifest post's scoped media location before a latest-success acquisition
record is appended.

Accepted manifest shapes are a JSON list, ``{"posts": [...]}``, or one post
object.  Each post has:

    video_id      required TikTok numeric post ID
    video_url     required exact URL from normalized/videos.jsonl
    photo_paths   required ordered, non-empty list (absolute or run-relative)
    audio_path    optional audio artifact (absolute or run-relative)
    method        required human-readable capture method

The validated submission and the exact acquisition records are preserved in
``<run-dir>/media/browser_photo_imports`` for audit.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import warnings
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, UnidentifiedImageError

sys.path.insert(0, str(Path(__file__).parent))
from acquire_media import (  # noqa: E402
    DEFAULT_MAX_FILE_MB, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS,
    MAX_PHOTOS_PER_POST, attach_acquisition_fingerprint, probe_media_streams,
)
from common import extract_video_id, read_jsonl, safe_artifact_id, validate_tiktok_page_url  # noqa: E402


MAX_MANIFEST_BYTES = 2 * 1024 * 1024
SUPPORTED_IMAGE_FORMATS = {"JPEG", "PNG"}


class ImportValidationError(ValueError):
    """The manifest is unsafe or inconsistent with the normalized dataset."""


def _sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def _resolve_media_file(raw_path, run_dir, media_dir, label):
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ImportValidationError(f"{label} must be a non-empty path string")
    candidate = Path(raw_path.strip())
    if not candidate.is_absolute():
        candidate = run_dir / candidate
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(media_dir)
    except FileNotFoundError as exc:
        raise ImportValidationError(f"{label} does not exist: {candidate}") from exc
    except (OSError, RuntimeError, ValueError) as exc:
        raise ImportValidationError(
            f"{label} must resolve below {media_dir}: {candidate}") from exc
    if not resolved.is_file():
        raise ImportValidationError(f"{label} is not a regular file: {resolved}")
    if resolved.stat().st_size <= 0:
        raise ImportValidationError(f"{label} is empty: {resolved}")
    return resolved


def _validate_image(path, label):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                image_format = image.format
                width, height = image.size
                image.verify()
            if image_format not in SUPPORTED_IMAGE_FORMATS:
                raise ImportValidationError(
                    f"{label} format {image_format!r} is unsupported; use JPEG or PNG")
            if width <= 0 or height <= 0:
                raise ImportValidationError(f"{label} has invalid dimensions: {width}x{height}")
            if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                raise ImportValidationError(
                    f"{label} exceeds dimension limit {MAX_IMAGE_DIMENSION}: {width}x{height}")
            if width * height > MAX_IMAGE_PIXELS:
                raise ImportValidationError(
                    f"{label} exceeds pixel limit {MAX_IMAGE_PIXELS}: {width}x{height}")
            # verify() validates structure; load() on a fresh handle forces a
            # full pixel decode and catches otherwise hidden truncation.
            with Image.open(path) as image:
                image.load()
    except ImportValidationError:
        raise
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise ImportValidationError(f"{label} is not a decodable image: {path}: {exc}") from exc
    return {"format": image_format, "width": width, "height": height}


def _validate_audio(path, label):
    streams = probe_media_streams(path)
    if not streams.get("has_audio"):
        raise ImportValidationError(
            f"{label} has no decodable audio stream: {path}: {streams.get('error', 'ffprobe')}")
    try:
        decoded = subprocess.run(
            ["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
             "-map", "0:a:0", "-f", "null", "-"],
            capture_output=True, text=True, timeout=240,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ImportValidationError(f"{label} audio decode failed: {path}: {exc}") from exc
    if decoded.returncode != 0:
        raise ImportValidationError(
            f"{label} audio decode failed: {path}: {(decoded.stderr or 'ffmpeg failed')[-1000:]}")
    return streams


def _manifest_posts(document):
    if isinstance(document, list):
        posts = document
    elif isinstance(document, dict) and "posts" in document:
        posts = document["posts"]
    elif isinstance(document, dict):
        posts = [document]
    else:
        raise ImportValidationError("manifest must be a post object, a list, or an object with posts[]")
    if not isinstance(posts, list) or not posts:
        raise ImportValidationError("manifest posts must be a non-empty list")
    if not all(isinstance(post, dict) for post in posts):
        raise ImportValidationError("every manifest post must be an object")
    return posts


def load_manifest(path):
    path = Path(path)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ImportValidationError(f"cannot read manifest {path}: {exc}") from exc
    if not raw or len(raw) > MAX_MANIFEST_BYTES:
        raise ImportValidationError(
            f"manifest size must be 1..{MAX_MANIFEST_BYTES} bytes; got {len(raw)}")
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ImportValidationError(f"manifest must be valid UTF-8 JSON: {exc}") from exc
    return document, _manifest_posts(document), raw


def _normalized_video_index(run_dir):
    path = run_dir / "normalized" / "videos.jsonl"
    if not path.is_file():
        raise ImportValidationError(f"normalized dataset is missing: {path}")
    videos = read_jsonl(path)
    index = {}
    for video in videos:
        video_id = str(video.get("video_id") or "")
        if video_id:
            index[video_id] = video
    return index


def validate_post(post, run_dir, media_dir, normalized_by_id):
    video_id = str(post.get("video_id") or "").strip()
    if not re.fullmatch(r"\d{1,32}", video_id):
        raise ImportValidationError(f"video_id must be numeric: {video_id!r}")

    video_url = str(post.get("video_url") or "").strip()
    safe_url, reason = validate_tiktok_page_url(video_url)
    if not safe_url:
        raise ImportValidationError(f"{video_id}: unsafe TikTok URL: {reason}")
    url_id, url_kind = extract_video_id(video_url)
    if url_kind not in ("video", "photo") or url_id != video_id:
        raise ImportValidationError(
            f"{video_id}: video_url must contain the same direct TikTok post ID")

    normalized = normalized_by_id.get(video_id)
    if not normalized:
        raise ImportValidationError(f"{video_id}: ID is not present in normalized/videos.jsonl")
    normalized_url = str(normalized.get("video_url") or "").strip()
    if video_url != normalized_url:
        raise ImportValidationError(
            f"{video_id}: video_url differs from normalized/videos.jsonl")

    method = post.get("method")
    if not isinstance(method, str) or not method.strip() or len(method.strip()) > 200:
        raise ImportValidationError(f"{video_id}: method must be a 1..200 character string")
    method = method.strip()

    raw_photos = post.get("photo_paths")
    if not isinstance(raw_photos, list) or not raw_photos:
        raise ImportValidationError(f"{video_id}: photo_paths must be a non-empty ordered list")
    if len(raw_photos) > MAX_PHOTOS_PER_POST:
        raise ImportValidationError(
            f"{video_id}: photo count exceeds safety limit {MAX_PHOTOS_PER_POST}")
    if post.get("photo_count") is not None and post.get("photo_count") != len(raw_photos):
        raise ImportValidationError(
            f"{video_id}: photo_count does not equal len(photo_paths)")

    scoped_photo_dir = (media_dir / f"{safe_artifact_id(video_id)}_photos").resolve()
    photo_paths = []
    photo_details = []
    for index, raw_path in enumerate(raw_photos, 1):
        path = _resolve_media_file(
            raw_path, run_dir, media_dir, f"{video_id} photo_paths[{index - 1}]")
        if path.parent != scoped_photo_dir:
            raise ImportValidationError(
                f"{video_id}: photo {index} must be directly inside {scoped_photo_dir}: {path}")
        photo_paths.append(path)
        photo_details.append({"photo_index": index, "path": str(path), **_validate_image(
            path, f"{video_id} photo {index}")})
    if len(set(photo_paths)) != len(photo_paths):
        raise ImportValidationError(f"{video_id}: photo_paths contains a duplicate image")

    audio_path = None
    audio_details = None
    if post.get("audio_path") not in (None, ""):
        audio_path = _resolve_media_file(
            post["audio_path"], run_dir, media_dir, f"{video_id} audio_path")
        file_id = safe_artifact_id(video_id)
        if audio_path.parent != media_dir or not (
                audio_path.name.startswith(f"{file_id}.")
                or audio_path.name.startswith(f"{file_id}_photo_audio.")):
            raise ImportValidationError(
                f"{video_id}: audio_path must be a scoped file directly inside {media_dir}")
        audio_details = _validate_audio(audio_path, f"{video_id} audio_path")

    total_bytes = sum(path.stat().st_size for path in photo_paths)
    if audio_path:
        total_bytes += audio_path.stat().st_size
    max_bytes = DEFAULT_MAX_FILE_MB * 1024 * 1024
    if total_bytes > max_bytes:
        raise ImportValidationError(
            f"{video_id}: imported media exceeds {DEFAULT_MAX_FILE_MB}MB safety limit")

    record = {
        "video_id": video_id,
        "video_url": video_url,
        "status": "ok",
        "media_type": "photo",
        "photo_paths": [str(path) for path in photo_paths],
        "photo_count": len(photo_paths),
        "photo_count_expected": len(photo_paths),
        "audio_path": str(audio_path) if audio_path else None,
        "has_audio": bool(audio_path),
        "method": method,
        "attempts": 1,
        "import_source": "browser-page-assets-manifest",
    }
    record = attach_acquisition_fingerprint(record)
    if record.get("status") != "ok":
        raise ImportValidationError(
            f"{video_id}: fingerprinting failed: {record.get('error', 'unknown error')}")
    return record, {
        "video_id": video_id,
        "video_url": video_url,
        "photo_count": len(photo_paths),
        "photo_details": photo_details,
        "audio_path": str(audio_path) if audio_path else None,
        "audio_streams": audio_details,
        "method": method,
    }


def _atomic_write_json(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(
                mode="wb", dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
            temp_name = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and Path(temp_name).exists():
            Path(temp_name).unlink()


def _append_records(log_path, records):
    payload = "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records).encode("utf-8")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = b""
    if log_path.exists() and log_path.stat().st_size:
        with log_path.open("rb") as existing:
            existing.seek(-1, os.SEEK_END)
            if existing.read(1) != b"\n":
                prefix = b"\n"
    descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        view = memoryview(prefix + payload)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError("short write while appending acquisition records")
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def import_browser_photos(run_dir, manifest_path):
    run_dir = Path(run_dir).resolve()
    if not run_dir.is_dir():
        raise ImportValidationError(f"run directory does not exist: {run_dir}")
    media_dir = (run_dir / "media").resolve()
    if not media_dir.is_dir():
        raise ImportValidationError(f"run media directory does not exist: {media_dir}")

    document, posts, raw_manifest = load_manifest(manifest_path)
    normalized_by_id = _normalized_video_index(run_dir)
    seen_ids = set()
    records = []
    validated_posts = []
    for post in posts:
        candidate_id = str(post.get("video_id") or "").strip()
        if candidate_id in seen_ids:
            raise ImportValidationError(f"duplicate video_id in manifest: {candidate_id}")
        seen_ids.add(candidate_id)
        record, validated = validate_post(post, run_dir, media_dir, normalized_by_id)
        records.append(record)
        validated_posts.append(validated)

    source_sha256 = _sha256_bytes(raw_manifest)
    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    audit_dir = media_dir / "browser_photo_imports"
    audit_name = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + f"_{source_sha256[:12]}.json"
    )
    audit_path = audit_dir / audit_name
    suffix = 2
    while audit_path.exists():
        audit_path = audit_dir / f"{Path(audit_name).stem}_{suffix}.json"
        suffix += 1

    for record in records:
        record["browser_import_manifest"] = str(audit_path)
        record["imported_at"] = imported_at
    audit_document = {
        "schema_version": 1,
        "imported_at": imported_at,
        "source_manifest": str(Path(manifest_path).resolve()),
        "source_manifest_sha256": source_sha256,
        "submitted_manifest": document,
        "validated_posts": validated_posts,
        "acquisition_records": records,
    }

    # Validate and fingerprint every entry before either persistent write.
    # The audit copy is written first so every acquisition log record points
    # at an already-existing immutable evidence bundle.
    _atomic_write_json(audit_path, audit_document)
    try:
        _append_records(media_dir / "acquire_log.jsonl", records)
    except Exception:
        audit_path.unlink(missing_ok=True)
        raise
    return {"imported": len(records), "audit_manifest": str(audit_path), "records": records}


def main():
    parser = argparse.ArgumentParser(
        description="Import ordered browser-captured TikTok photos as audited acquisition successes")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    try:
        result = import_browser_photos(args.run_dir, args.manifest)
    except ImportValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(2)
    except OSError as exc:
        print(f"ERROR: import write failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
