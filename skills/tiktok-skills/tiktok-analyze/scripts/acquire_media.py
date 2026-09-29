#!/usr/bin/env python3
"""Acquire public TikTok video and photo-mode media with checkpoints.

Video posts are downloaded with yt-dlp first and a public-page metadata
fallback second.  TikTok photo-mode posts often make yt-dlp return only the
post's music as M4A/MP3.  An audio-only file is therefore never reported as an
ordinary video: the public post page is fetched, its embedded TikTok metadata
is parsed, and the actual carousel images are downloaded alongside any audio.

The page fetch uses curl_cffi when available and plain requests as a fallback.
It does not solve, bypass, or retry through CAPTCHA challenges.  Every input,
redirect, and media URL stays inside the TikTok page/CDN allowlists, and byte,
image-count, and image-dimension limits are enforced before files are accepted.

Output:
    <run-dir>/media/<video_id>.<ext>               video or retained audio
    <run-dir>/media/<video_id>_photos/NN.jpg       actual TikTok photos
    <run-dir>/media/acquire_log.jsonl              acquisition checkpoint
"""
import argparse
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import requests

sys.path.insert(0, str(Path(__file__).parent))
from common import (  # noqa: E402
    read_jsonl, append_jsonl, extract_video_id, safe_artifact_id,
    validate_tiktok_page_url, validate_tiktok_media_url,
)

RETRYABLE_SNIPPETS = [
    "unable to extract webpage video data", "unable to extract video data",
    "no video formats found", "attempting impersonation, but no impersonate target is available",
    "unable to download webpage", "http error 403", "http error 429",
    "connection reset by peer", "recv failure", "could not locate video play url",
    "could not locate photo metadata", "photo download failed", "photo download incomplete",
    "photo audio download failed",
]
PERMANENT_SNIPPETS = [
    "video not available", "status code 10216", "status code 10222",
    "this video is unavailable", "private", "video has been removed",
    "does not exist", "content unavailable", "page returned 404",
]
BLOCKED_SNIPPETS = [
    "status code 10204", "ip address", "captcha", "unusual traffic", "verify challenge",
]

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
DEFAULT_MAX_FILE_MB = 250
MAX_PHOTOS_PER_POST = 35
MAX_IMAGE_PIXELS = 50_000_000
MAX_IMAGE_DIMENSION = 12_000
TERMINAL_CHECKPOINT_STATUSES = {"ok", "permanent_unavailable", "invalid_input"}
YT_DLP = Path(sys.executable).with_name("yt-dlp")
if not YT_DLP.exists():
    YT_DLP = Path("yt-dlp")

_UNIVERSAL_DATA_RE = re.compile(
    r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', re.S)
_SIGI_STATE_RE = re.compile(r'<script id="SIGI_STATE"[^>]*>(.*?)</script>', re.S)


def classify_failure(stderr_text: str, attempt: int, max_attempts: int):
    text = stderr_text.lower()
    if any(snippet in text for snippet in PERMANENT_SNIPPETS):
        return "permanent_unavailable"
    if any(snippet in text for snippet in BLOCKED_SNIPPETS):
        return "rate_limited_or_blocked" if attempt >= max_attempts else "retry"
    if any(snippet in text for snippet in RETRYABLE_SNIPPETS):
        return "rate_limited_or_blocked" if attempt >= max_attempts else "retry"
    return "unknown_error" if attempt >= max_attempts else "retry"


def safe_media_id(value):
    """Backward-compatible local name for the shared artifact ID mapper."""
    return safe_artifact_id(value)


def probe_media_streams(path):
    """Return ffprobe stream facts; absence of a video stream is authoritative."""
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "stream=codec_type:format=format_name", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=25,
        )
        if proc.returncode != 0:
            return {"has_video": False, "has_audio": False, "format_name": None,
                    "error": (proc.stderr or "ffprobe failed")[-1000:]}
        data = json.loads(proc.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return {"has_video": False, "has_audio": False, "format_name": None, "error": str(exc)}
    stream_types = {stream.get("codec_type") for stream in data.get("streams", [])}
    return {
        "has_video": "video" in stream_types,
        "has_audio": "audio" in stream_types,
        "format_name": (data.get("format") or {}).get("format_name"),
    }


def download_via_ytdlp(video_id, url, out_dir: Path, timeout_s=60,
                        max_bytes=DEFAULT_MAX_FILE_MB * 1024 * 1024):
    file_id = safe_media_id(video_id)
    out_template = str(out_dir / f"{file_id}.%(ext)s")
    cmd = [
        str(YT_DLP), "--impersonate", "chrome", "-f", "best[ext=mp4]/best",
        "-o", out_template, "--no-warnings", "--no-progress", "--no-playlist",
        "--force-overwrites", "--retries", "0", "--socket-timeout", "15",
        "--max-filesize", str(max_bytes), "--print", "after_move:filepath", url,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"yt-dlp timed out after {timeout_s}s"}
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr[-4000:]}

    candidates = []
    output_root = out_dir.resolve()
    for line in (proc.stdout or "").splitlines():
        raw_path = line.strip()
        if not raw_path:
            continue
        try:
            candidate = Path(raw_path).resolve(strict=True)
            candidate.relative_to(output_root)
        except (OSError, ValueError):
            continue
        if candidate.is_file() and candidate.name.startswith(f"{file_id}."):
            candidates.append(candidate)
    if not candidates:
        return {"ok": False, "error": "yt-dlp exited 0 but did not report a new scoped output file"}
    inspected = []
    for path in candidates:
        if path.stat().st_size > max_bytes:
            path.unlink(missing_ok=True)
            continue
        probe = probe_media_streams(path)
        inspected.append((path, probe))
    video_candidate = next(((path, probe) for path, probe in inspected if probe["has_video"]), None)
    if video_candidate:
        path, probe = video_candidate
        return {
            "ok": True, "path": str(path), "media_type": "video", "method": "yt-dlp",
            "has_audio": probe["has_audio"],
        }
    audio_candidate = next(((path, probe) for path, probe in inspected if probe["has_audio"]), None)
    if audio_candidate:
        path, _probe = audio_candidate
        return {
            "ok": True, "audio_path": str(path), "media_type": "audio_only", "method": "yt-dlp",
        }
    return {"ok": False, "error": "yt-dlp output has neither a video nor an audio stream"}


def _find_first(obj, target_key):
    if isinstance(obj, dict):
        if target_key in obj:
            return obj[target_key]
        for value in obj.values():
            found = _find_first(value, target_key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find_first(value, target_key)
            if found is not None:
                return found
    return None


def _loads_embedded_json(raw):
    for candidate in (raw, html.unescape(raw)):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _find_post_item(data, video_id=None):
    """Find the requested post item without accidentally selecting an avatar."""
    item_module = _find_first(data, "ItemModule")
    if isinstance(item_module, dict):
        if video_id and isinstance(item_module.get(str(video_id)), dict):
            return item_module[str(video_id)]
        if not video_id:
            for item in item_module.values():
                if isinstance(item, dict) and (item.get("imagePost") or item.get("video")):
                    return item

    requested = str(video_id) if video_id is not None else None
    fallback = None
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            if node.get("imagePost") or node.get("video"):
                node_id = node.get("id") or node.get("aweme_id")
                if requested and str(node_id) == requested:
                    return node
                fallback = fallback or node
            item_struct = node.get("itemStruct")
            if isinstance(item_struct, dict):
                item_id = item_struct.get("id") or item_struct.get("aweme_id")
                if not requested or str(item_id) == requested:
                    return item_struct
                fallback = fallback or item_struct
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
    return None if requested else fallback


def _url_values(value):
    if isinstance(value, str):
        return [html.unescape(value)]
    if isinstance(value, list):
        return [html.unescape(item) for item in value if isinstance(item, str)]
    if not isinstance(value, dict):
        return []
    urls = []
    for key in ("urlList", "url_list", "urls", "url", "uri"):
        urls.extend(_url_values(value.get(key)))
    return urls


def parse_public_post_metadata(page_text, video_id=None):
    """Parse only post-scoped video/photo/music URLs from public page JSON."""
    data = None
    for regex in (_UNIVERSAL_DATA_RE, _SIGI_STATE_RE):
        match = regex.search(page_text or "")
        if match:
            data = _loads_embedded_json(match.group(1))
            if data is not None:
                break
    if data is None:
        return {"item_found": False, "photo_url_groups": [], "photo_count_total": 0,
                "photo_limit_exceeded": False, "video_url": None, "audio_url": None}
    item = _find_post_item(data, video_id)
    if not isinstance(item, dict):
        return {"item_found": False, "photo_url_groups": [], "photo_count_total": 0,
                "photo_limit_exceeded": False, "video_url": None, "audio_url": None}

    photo_groups = []
    image_post = item.get("imagePost") or item.get("image_post") or {}
    for image in image_post.get("images", []) if isinstance(image_post, dict) else []:
        if not isinstance(image, dict):
            continue
        candidates = []
        for key in ("imageURL", "imageUrl", "displayImage", "ownerWatermarkImage", "thumbnail"):
            candidates.extend(_url_values(image.get(key)))
        candidates.extend(_url_values(image.get("urlList")))
        unique = list(dict.fromkeys(url for url in candidates if isinstance(url, str) and url.startswith("https://")))
        # Preserve one list slot per carousel image, including an empty list
        # when TikTok metadata contains an image whose URLs we cannot parse.
        # This keeps original indices stable and makes incomplete acquisition
        # fail instead of silently renumbering later photos.
        photo_groups.append(unique)

    video_node = item.get("video") if isinstance(item.get("video"), dict) else {}
    video_urls = _url_values(video_node.get("playAddr")) + _url_values(video_node.get("play_addr"))
    music = item.get("music") if isinstance(item.get("music"), dict) else {}
    audio_urls = _url_values(music.get("playUrl")) + _url_values(music.get("play_url"))
    return {
        "item_found": True,
        "photo_url_groups": photo_groups[:MAX_PHOTOS_PER_POST],
        "photo_count_total": len(photo_groups),
        "photo_limit_exceeded": len(photo_groups) > MAX_PHOTOS_PER_POST,
        "video_url": next((url for url in video_urls if url.startswith("https://")), None),
        "audio_url": next((url for url in audio_urls if url.startswith("https://")), None),
    }


def _looks_like_challenge(text):
    lowered = (text or "").lower()
    return (
        "secsdk-captcha" in lowered
        or "captcha_verify" in lowered
        or ("captcha" in lowered and ("verify" in lowered or "challenge" in lowered))
        or "verifycenter" in lowered
    )


def _get_with_safe_redirects(session, url, validator, timeout_s, headers=None,
                             stream=False, max_redirects=5):
    """Follow redirects only after validating each Location before requesting it."""
    current = str(url)
    visited = set()
    for _redirect_number in range(max_redirects + 1):
        ok, reason = validator(current)
        if not ok:
            return {"ok": False, "error": f"URL rejected before request: {reason}"}
        if current in visited:
            return {"ok": False, "error": "redirect loop detected"}
        visited.add(current)
        try:
            response = session.get(
                current, headers=headers, timeout=timeout_s, stream=stream, allow_redirects=False)
        except Exception as exc:
            return {"ok": False, "error": f"request failed: {exc}"}
        if response.status_code not in (301, 302, 303, 307, 308):
            return {"ok": True, "response": response, "final_url": current}
        location = response.headers.get("Location")
        try:
            response.close()
        except Exception:
            pass
        if not location:
            return {"ok": False, "error": f"redirect HTTP {response.status_code} has no Location"}
        target = urljoin(current, location)
        target_ok, target_reason = validator(target)
        if not target_ok:
            return {"ok": False, "error": f"redirect target rejected before request: {target_reason}"}
        current = target
    return {"ok": False, "error": f"too many redirects (>{max_redirects})"}


def _page_sessions():
    try:
        from curl_cffi import requests as curl_requests
        yield "curl_cffi", curl_requests.Session(impersonate="chrome")
    except (ImportError, RuntimeError):
        pass
    yield "requests", requests.Session()


def fetch_public_page(url, timeout_s=30):
    errors = []
    for method, session in _page_sessions():
        session.headers.update({"User-Agent": UA, "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8"})
        fetched = _get_with_safe_redirects(
            session, url, validate_tiktok_page_url, timeout_s, stream=False)
        if not fetched["ok"]:
            errors.append(f"{method}: page fetch failed: {fetched['error']}")
            try:
                session.close()
            except Exception:
                pass
            continue
        page = fetched["response"]
        if page.status_code == 404:
            try:
                session.close()
            except Exception:
                pass
            return {"ok": False, "error": "public page returned 404 (likely deleted/private)"}
        if page.status_code != 200:
            errors.append(f"{method}: page fetch HTTP {page.status_code}")
            try:
                session.close()
            except Exception:
                pass
            continue
        if _looks_like_challenge(page.text):
            try:
                session.close()
            except Exception:
                pass
            return {"ok": False, "error": "public page returned a CAPTCHA/verify challenge; no bypass attempted"}
        return {"ok": True, "session": session, "text": page.text, "method": method,
                "final_url": fetched["final_url"]}
    return {"ok": False, "error": " | ".join(errors) or "public page fetch failed"}


def metadata_post_id(page_result, requested_id):
    """Prefer the ID in the resolved public URL; accept only numeric supplied IDs."""
    resolved_id, _kind = extract_video_id(page_result.get("final_url"))
    if resolved_id:
        return resolved_id
    requested = str(requested_id or "")
    return requested if requested.isdigit() else None


def detect_public_post_kind(video_id, url, timeout_s=30):
    """Resolve a short link and classify its public post metadata."""
    page = fetch_public_page(url, timeout_s=timeout_s)
    if not page["ok"]:
        return page
    session = page["session"]
    try:
        resolved_id, resolved_url_kind = extract_video_id(page.get("final_url"))
        post_id = resolved_id or metadata_post_id(page, video_id)
        if not post_id:
            return {"ok": False, "error": "short link did not resolve to a URL containing a post ID"}
        metadata = parse_public_post_metadata(page["text"], post_id)
        if metadata.get("photo_url_groups") or resolved_url_kind == "photo":
            return {"ok": True, "kind": "photo", "final_url": page.get("final_url")}
        if metadata.get("video_url") or resolved_url_kind == "video":
            return {"ok": True, "kind": "video", "final_url": page.get("final_url")}
        return {"ok": False, "error": "short link resolved but public post kind is unknown"}
    finally:
        try:
            session.close()
        except Exception:
            pass


def _download_response(session, url, timeout_s, max_bytes, accepted_prefixes):
    safe, reason = validate_tiktok_media_url(url)
    if not safe:
        return {"ok": False, "error": f"rejected media URL: {reason}"}
    headers = {"User-Agent": UA, "Referer": "https://www.tiktok.com/", "Accept": "*/*",
               "Range": "bytes=0-", "Origin": "https://www.tiktok.com"}
    fetched = _get_with_safe_redirects(
        session, url, validate_tiktok_media_url, timeout_s, headers=headers, stream=True)
    if not fetched["ok"]:
        return {"ok": False, "error": f"CDN fetch failed: {fetched['error']}"}
    response = fetched["response"]
    if response.status_code not in (200, 206):
        return {"ok": False, "error": f"CDN fetch HTTP {response.status_code}"}
    content_type = (response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type != "application/octet-stream" and not any(
            content_type.startswith(prefix) for prefix in accepted_prefixes):
        return {"ok": False, "error": f"unexpected Content-Type {content_type}"}
    try:
        declared_size = int(response.headers.get("Content-Length") or 0)
    except (TypeError, ValueError):
        declared_size = 0
    if declared_size > max_bytes:
        return {"ok": False, "error": f"declared file size {declared_size} exceeds limit {max_bytes}"}
    return {"ok": True, "response": response, "content_type": content_type}


def _stream_to_path(response, output_path, max_bytes):
    total = 0
    try:
        with output_path.open("wb") as handle:
            for chunk in response.iter_content(1 << 16):
                if not chunk:
                    continue
                if total + len(chunk) > max_bytes:
                    raise ValueError(f"stream exceeded limit {max_bytes} bytes")
                handle.write(chunk)
                total += len(chunk)
    except Exception as exc:
        output_path.unlink(missing_ok=True)
        return {"ok": False, "error": str(exc)}
    if total == 0:
        output_path.unlink(missing_ok=True)
        return {"ok": False, "error": "empty CDN response"}
    return {"ok": True, "bytes": total}


def download_image_asset(session, url, output_stem: Path, timeout_s, max_bytes):
    result = _download_response(session, url, timeout_s, max_bytes, ("image/",))
    if not result["ok"]:
        return result
    temp_path = output_stem.with_suffix(".download")
    normalized_path = output_stem.with_name(output_stem.name + ".normalized.jpg")
    output_path = output_stem.with_suffix(".jpg")
    streamed = _stream_to_path(result["response"], temp_path, max_bytes)
    if not streamed["ok"]:
        return streamed
    try:
        from PIL import Image, ImageOps
        with Image.open(temp_path) as image:
            image.verify()
        with Image.open(temp_path) as image:
            if (image.width > MAX_IMAGE_DIMENSION or image.height > MAX_IMAGE_DIMENSION
                    or image.width * image.height > MAX_IMAGE_PIXELS):
                raise ValueError(f"image dimensions {image.width}x{image.height} exceed safety limit")
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.save(normalized_path, "JPEG", quality=94, optimize=True)
            if normalized_path.stat().st_size > max_bytes:
                raise ValueError(f"normalized JPEG exceeds remaining byte limit {max_bytes}")
            normalized_path.replace(output_path)
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        normalized_path.unlink(missing_ok=True)
        return {"ok": False, "error": f"invalid/unsupported image: {exc}"}
    temp_path.unlink(missing_ok=True)
    return {"ok": True, "path": str(output_path), "bytes": output_path.stat().st_size}


def _audio_suffix(content_type, format_name):
    if "mpeg" in (content_type or "") or format_name == "mp3":
        return ".mp3"
    if "aac" in (content_type or "") or format_name == "aac":
        return ".aac"
    return ".m4a"


def download_audio_asset(session, url, output_stem: Path, timeout_s, max_bytes):
    result = _download_response(session, url, timeout_s, max_bytes, ("audio/", "video/"))
    if not result["ok"]:
        return result
    temp_path = output_stem.with_suffix(".audio.download")
    streamed = _stream_to_path(result["response"], temp_path, max_bytes)
    if not streamed["ok"]:
        return streamed
    probe = probe_media_streams(temp_path)
    if not probe["has_audio"]:
        temp_path.unlink(missing_ok=True)
        return {"ok": False, "error": "downloaded photo-mode music has no audio stream"}
    output_path = output_stem.with_suffix(_audio_suffix(result.get("content_type"), probe.get("format_name")))
    temp_path.replace(output_path)
    return {"ok": True, "path": str(output_path), "bytes": streamed["bytes"]}


def download_photo_post(video_id, url, out_dir: Path, timeout_s=30,
                        max_bytes=DEFAULT_MAX_FILE_MB * 1024 * 1024,
                        existing_audio_path=None):
    """Download actual images and retain music for one public photo-mode post."""
    page = fetch_public_page(url, timeout_s=timeout_s)
    if not page["ok"]:
        return page
    session = page["session"]
    try:
        post_id = metadata_post_id(page, video_id)
        if not post_id:
            return {"ok": False, "error": "resolved public photo page has no trustworthy post ID"}
        metadata = parse_public_post_metadata(page["text"], post_id)
        groups = metadata["photo_url_groups"]
        if metadata.get("photo_limit_exceeded"):
            return {
                "ok": False,
                "error": (
                    f"photo count {metadata.get('photo_count_total')} exceeds safety limit "
                    f"{MAX_PHOTOS_PER_POST}"
                ),
            }
        if not groups:
            return {"ok": False, "error": "could not locate photo metadata in public post page"}

        file_id = safe_media_id(video_id)
        photo_dir = out_dir / f"{file_id}_photos"
        photo_dir.mkdir(parents=True, exist_ok=True)
        budget = max_bytes
        audio_path = None
        if existing_audio_path and Path(existing_audio_path).is_file():
            audio_path = str(Path(existing_audio_path))
            budget = max(0, budget - Path(existing_audio_path).stat().st_size)

        photo_paths = []
        photo_errors = []
        for index, candidate_urls in enumerate(groups[:MAX_PHOTOS_PER_POST], 1):
            if budget <= 0:
                photo_errors.append({"photo_index": index, "error": "post byte budget exhausted"})
                break
            downloaded = None
            errors = []
            for candidate_url in candidate_urls:
                attempt = download_image_asset(
                    session, candidate_url, photo_dir / f"{index:02d}", timeout_s, budget)
                if attempt["ok"]:
                    downloaded = attempt
                    break
                errors.append(attempt.get("error", "unknown image error"))
            if downloaded:
                photo_paths.append(downloaded["path"])
                budget -= downloaded["bytes"]
            else:
                photo_errors.append({"photo_index": index, "error": " | ".join(errors)[-2000:]})

        if not photo_paths:
            return {"ok": False, "error": "photo download failed for every image", "photo_errors": photo_errors}

        if len(photo_paths) != len(groups):
            return {
                "ok": False,
                "error": f"photo download incomplete: {len(photo_paths)}/{len(groups)} images",
                "media_type": "photo_partial",
                "photo_paths": photo_paths,
                "photo_count_expected": len(groups),
                "photo_download_errors": photo_errors,
                "audio_path": audio_path,
            }

        audio_error = None
        if not audio_path and metadata.get("audio_url"):
            if budget <= 0:
                audio_error = "post byte budget exhausted before photo-mode audio"
            else:
                audio = download_audio_asset(
                    session, metadata["audio_url"], out_dir / f"{file_id}_photo_audio", timeout_s, budget)
                if audio["ok"]:
                    audio_path = audio["path"]
                else:
                    audio_error = audio.get("error")
            if audio_error:
                return {
                    "ok": False,
                    "error": f"photo audio download failed: {audio_error}",
                    "media_type": "photo_partial",
                    "photo_paths": photo_paths,
                    "photo_count_expected": len(groups),
                    "photo_download_errors": photo_errors,
                }
        return {
            "ok": True,
            "media_type": "photo",
            "photo_paths": photo_paths,
            "audio_path": audio_path,
            "photo_count_expected": len(groups),
            "photo_download_errors": photo_errors,
            "audio_download_error": None,
            "method": f"public-photo-metadata:{page['method']}",
        }
    finally:
        try:
            session.close()
        except Exception:
            pass


def download_via_requests_fallback(video_id, url, out_dir: Path, timeout_s=30,
                                   max_bytes=DEFAULT_MAX_FILE_MB * 1024 * 1024):
    """Download an ordinary video from public-page embedded post metadata."""
    page = fetch_public_page(url, timeout_s=timeout_s)
    if not page["ok"]:
        return page
    session = page["session"]
    try:
        post_id = metadata_post_id(page, video_id)
        if not post_id:
            return {"ok": False, "error": "resolved public video page has no trustworthy post ID"}
        metadata = parse_public_post_metadata(page["text"], post_id)
        play_url = metadata.get("video_url")
        if not play_url:
            kind = "photo-mode post" if metadata.get("photo_url_groups") else "page data"
            return {"ok": False, "error": f"could not locate video play URL in {kind}"}
        result = _download_response(session, play_url, timeout_s, max_bytes, ("video/", "audio/"))
        if not result["ok"]:
            return {"ok": False, "error": f"fallback: {result['error']}"}
        file_id = safe_media_id(video_id)
        temp_path = out_dir / f".{file_id}.media.download"
        streamed = _stream_to_path(result["response"], temp_path, max_bytes)
        if not streamed["ok"]:
            return {"ok": False, "error": f"fallback: {streamed['error']}"}
        if streamed["bytes"] < 10_000:
            temp_path.unlink(missing_ok=True)
            return {"ok": False, "error": f"fallback: downloaded only {streamed['bytes']} bytes, discarding"}
        probe = probe_media_streams(temp_path)
        if probe["has_video"]:
            output_path = out_dir / f"{file_id}.mp4"
            temp_path.replace(output_path)
            return {"ok": True, "path": str(output_path), "media_type": "video",
                    "has_audio": probe["has_audio"], "method": f"public-video-metadata:{page['method']}",
                    "bytes": streamed["bytes"], "confirmed_post_kind": "video"}
        if probe["has_audio"]:
            output_path = out_dir / f"{file_id}{_audio_suffix(result.get('content_type'), probe.get('format_name'))}"
            temp_path.replace(output_path)
            return {"ok": True, "audio_path": str(output_path), "media_type": "audio_only",
                    "method": f"public-video-metadata:{page['method']}", "bytes": streamed["bytes"]}
        temp_path.unlink(missing_ok=True)
        return {"ok": False, "error": "fallback: downloaded media has no video or audio stream"}
    finally:
        try:
            session.close()
        except Exception:
            pass


def _photo_result_as_status(result, attempts):
    return {"status": "ok", "attempts": attempts, **{key: value for key, value in result.items() if key != "ok"}}


def _unlink_scoped_file(raw_path, output_root):
    if not raw_path:
        return
    try:
        path = Path(raw_path).resolve(strict=True)
        path.relative_to(output_root.resolve(strict=True))
    except (OSError, ValueError):
        return
    if path.is_file():
        path.unlink()


def download_one(video_id, url, out_dir: Path, max_attempts=3, timeout_s=60,
                 skip_ytdlp=False, max_bytes=DEFAULT_MAX_FILE_MB * 1024 * 1024,
                 expected_kind=None):
    safe, reason = validate_tiktok_page_url(url)
    if not safe:
        return {"status": "invalid_input", "error": reason, "attempts": 0}
    last_errors = []
    last_photo_details = {}
    if expected_kind == "short_link":
        detected = detect_public_post_kind(video_id, url, timeout_s=min(timeout_s, 30))
        if detected.get("ok"):
            expected_kind = detected["kind"]
        else:
            last_errors.append(("short-link-metadata", detected.get("error", "unknown post kind")))
    for attempt in range(1, max_attempts + 1):
        audio_path = None
        if not skip_ytdlp:
            ytdlp = download_via_ytdlp(video_id, url, out_dir, timeout_s=timeout_s, max_bytes=max_bytes)
            if (ytdlp["ok"] and ytdlp.get("media_type") == "video"
                    and expected_kind not in ("photo", "short_link")):
                return {"status": "ok", "attempts": attempt, **{k: v for k, v in ytdlp.items() if k != "ok"}}
            if ytdlp["ok"]:
                if expected_kind in ("photo", "short_link") and ytdlp.get("media_type") == "video":
                    # Some yt-dlp builds synthesize a slideshow video for a
                    # photo post.  It is not the actual photo evidence and can
                    # consume the whole post budget, so discard it and fetch
                    # the genuine images/music from public metadata.
                    _unlink_scoped_file(ytdlp.get("path"), out_dir)
                    audio_path = None
                else:
                    audio_path = ytdlp.get("audio_path")
            else:
                last_errors.append(("yt-dlp", ytdlp["error"]))

        if expected_kind == "photo" or audio_path:
            photo = download_photo_post(
                video_id, url, out_dir, timeout_s=min(timeout_s, 30), max_bytes=max_bytes,
                existing_audio_path=audio_path)
            if photo["ok"]:
                return _photo_result_as_status(photo, attempt)
            last_photo_details = {
                key: photo[key] for key in (
                    "media_type", "photo_paths", "photo_count_expected", "photo_download_errors", "audio_path"
                ) if photo.get(key) is not None
            }
            last_errors.append(("photo-metadata", photo.get("error", "unknown photo error")))
            if expected_kind == "photo":
                combined = " | ".join(f"{method}: {error}" for method, error in last_errors[-2:])
                verdict = classify_failure(combined, attempt, max_attempts)
                if verdict == "retry":
                    time.sleep(min(2 ** attempt, 15))
                    continue
                result = {"status": verdict, "error": combined, "attempts": attempt}
                result.update(last_photo_details)
                if audio_path:
                    result.setdefault("audio_path", audio_path)
                    result.setdefault("media_type", "audio_only")
                return result

        fallback = download_via_requests_fallback(
            video_id, url, out_dir, timeout_s=min(timeout_s, 30), max_bytes=max_bytes)
        fallback_video_confirmed = (
            fallback.get("confirmed_post_kind") == "video"
            and expected_kind != "photo"
        )
        if (fallback["ok"] and fallback.get("media_type") == "video"
                and (expected_kind not in ("photo", "short_link") or fallback_video_confirmed)):
            return {"status": "ok", "attempts": attempt, **{k: v for k, v in fallback.items() if k != "ok"}}
        if fallback["ok"] and fallback.get("media_type") == "video":
            _unlink_scoped_file(fallback.get("path"), out_dir)
            fallback = {"ok": False, "error": "unconfirmed video output rejected for photo/short-link input"}
        if fallback["ok"] and fallback.get("media_type") == "audio_only":
            audio_path = fallback.get("audio_path")
            photo = download_photo_post(
                video_id, url, out_dir, timeout_s=min(timeout_s, 30), max_bytes=max_bytes,
                existing_audio_path=audio_path)
            if photo["ok"]:
                return _photo_result_as_status(photo, attempt)
            last_photo_details = {
                key: photo[key] for key in (
                    "media_type", "photo_paths", "photo_count_expected", "photo_download_errors", "audio_path"
                ) if photo.get(key) is not None
            }
            last_errors.append(("photo-metadata", photo.get("error", "unknown photo error")))
        else:
            last_errors.append(("fallback", fallback.get("error", "unknown fallback error")))
            # A /video URL can still resolve to photo-mode metadata.  Try once
            # when neither downloader produced an ordinary video.
            photo = download_photo_post(
                video_id, url, out_dir, timeout_s=min(timeout_s, 30), max_bytes=max_bytes,
                existing_audio_path=audio_path)
            if photo["ok"]:
                return _photo_result_as_status(photo, attempt)
            last_photo_details = {
                key: photo[key] for key in (
                    "media_type", "photo_paths", "photo_count_expected", "photo_download_errors", "audio_path"
                ) if photo.get(key) is not None
            }
            last_errors.append(("photo-metadata", photo.get("error", "unknown photo error")))

        combined_error = " | ".join(f"{method}: {error}" for method, error in last_errors[-3:])
        verdict = classify_failure(combined_error, attempt, max_attempts)
        if verdict == "retry":
            time.sleep(min(2 ** attempt, 15))
            continue
        result = {"status": verdict, "error": combined_error, "attempts": attempt}
        result.update(last_photo_details)
        if audio_path:
            result.setdefault("audio_path", audio_path)
            result.setdefault("media_type", "audio_only")
        return result
    return {"status": "unknown_error",
            "error": " | ".join(f"{method}: {error}" for method, error in last_errors),
            "attempts": max_attempts, **last_photo_details}


def select_videos(all_videos, select_top_n_per_source, video_ids, limit):
    if video_ids:
        wanted = set(video_ids)
        return [video for video in all_videos if video["video_id"] in wanted]
    if select_top_n_per_source:
        chosen = {}
        for video in all_videos:
            for appearance in video["source_appearances"]:
                if appearance["rank"] <= select_top_n_per_source:
                    chosen[video["video_id"]] = video
                    break
        result = list(chosen.values())
    else:
        result = list(all_videos)
    return result[:limit] if limit else result


def terminal_checkpoint_ids(log_path):
    """Only terminal outcomes suppress a later retry; latest record wins."""
    latest = {}
    for record in read_jsonl(log_path):
        if record.get("video_id"):
            latest[record["video_id"]] = record.get("status")
    return {video_id for video_id, status in latest.items() if status in TERMINAL_CHECKPOINT_STATUSES}


def _is_scoped_media_name(name, file_id):
    return (
        name == f"{file_id}_photos"
        or name.startswith(f"{file_id}.")
        or name.startswith(f"{file_id}_photo_audio.")
        or name.startswith(f".{file_id}.")
    )


def _sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def attach_acquisition_fingerprint(result):
    """Bind downstream checkpoints to the exact acquired media bytes."""
    if result.get("status") != "ok":
        return result
    files = []
    try:
        if result.get("media_type") == "video":
            path = Path(result["path"])
            files.append({"role": "video", "sha256": _sha256_file(path), "bytes": path.stat().st_size})
        elif result.get("media_type") == "photo":
            for index, raw_path in enumerate(result.get("photo_paths", []), 1):
                path = Path(raw_path)
                files.append({"role": "photo", "photo_index": index,
                              "sha256": _sha256_file(path), "bytes": path.stat().st_size})
            if result.get("audio_path"):
                path = Path(result["audio_path"])
                files.append({"role": "audio", "sha256": _sha256_file(path), "bytes": path.stat().st_size})
        else:
            raise ValueError(f"unsupported successful media_type {result.get('media_type')}")
    except (OSError, KeyError, ValueError) as exc:
        return {"status": "unknown_error", "attempts": result.get("attempts", 0),
                "error": f"could not fingerprint acquired media: {exc}"}
    payload = json.dumps(files, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    updated = dict(result)
    updated["media_hashes"] = files
    updated["acquisition_sha256"] = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return updated


def _remove_path(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def prepare_force_stage(media_dir, video_id):
    """Create an isolated output directory for one explicitly forced ID."""
    file_id = safe_media_id(video_id)
    stage = media_dir / f".force_stage_{file_id}"
    if stage.exists():
        _remove_path(stage)
    stage.mkdir(parents=False)
    return stage


def _remap_result_paths(result, source_root, destination_root):
    def remap(raw):
        if not raw:
            return raw
        try:
            relative = Path(raw).resolve().relative_to(source_root.resolve())
        except (OSError, ValueError):
            return raw
        return str(destination_root / relative)

    updated = dict(result)
    for key in ("path", "audio_path"):
        if updated.get(key):
            updated[key] = remap(updated[key])
    if updated.get("photo_paths"):
        updated["photo_paths"] = [remap(path) for path in updated["photo_paths"]]
    return updated


def commit_forced_acquisition(media_dir, video_id, stage_dir, result):
    """Atomically preserve old media unless the scoped replacement succeeded.

    Files are downloaded into ``stage_dir``.  On success, existing outputs for
    only this safe artifact ID are moved to a backup, staged outputs are moved
    into place, and the backup is removed.  Any commit error rolls the old set
    back.  A failed acquisition simply drops its stage and leaves old files.
    """
    file_id = safe_media_id(video_id)
    if result.get("status") != "ok":
        result = dict(result)
        if result.get("photo_paths"):
            result["staged_photo_count_discarded"] = len(result["photo_paths"])
            result["photo_paths"] = []
        result.pop("path", None)
        result.pop("audio_path", None)
        _remove_path(stage_dir)
        return result

    backup = media_dir / f".force_backup_{file_id}"
    if backup.exists():
        _remove_path(backup)
    backup.mkdir()
    old_paths = [
        child for child in media_dir.iterdir()
        if child not in (stage_dir, backup) and _is_scoped_media_name(child.name, file_id)
    ]
    installed_new = []
    try:
        for old in old_paths:
            shutil.move(str(old), str(backup / old.name))
        for staged in list(stage_dir.iterdir()):
            destination = media_dir / staged.name
            if destination.exists():
                raise FileExistsError(f"forced destination already exists: {destination}")
            shutil.move(str(staged), str(destination))
            installed_new.append(destination)
        updated = _remap_result_paths(result, stage_dir, media_dir)
    except Exception as exc:
        for path in installed_new:
            if path.exists() or path.is_symlink():
                _remove_path(path)
        for old in list(backup.iterdir()):
            shutil.move(str(old), str(media_dir / old.name))
        _remove_path(stage_dir)
        _remove_path(backup)
        return {"status": "unknown_error", "error": f"forced acquisition commit failed: {exc}",
                "attempts": result.get("attempts", 0)}
    _remove_path(stage_dir)
    _remove_path(backup)
    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--videos", required=True, help="path to normalized/videos.jsonl")
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--select-top-n-per-source", type=int, default=None)
    parser.add_argument("--video-ids", default=None, help="comma-separated explicit list")
    parser.add_argument(
        "--force", action="store_true",
        help="re-acquire only the IDs explicitly supplied with --video-ids, ignoring terminal checkpoints",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--max-file-mb", type=int, default=DEFAULT_MAX_FILE_MB,
                        help=f"hard aggregate media-size limit per post (default: {DEFAULT_MAX_FILE_MB}MB)")
    parser.add_argument("--skip-ytdlp", action="store_true",
                        help="skip yt-dlp and use public-page metadata only")
    parser.add_argument("--sleep-between", type=float, default=1.5,
                        help="seconds to sleep between posts to reduce rate-limiting")
    args = parser.parse_args()
    if args.force and not args.video_ids:
        parser.error("--force is allowed only with an explicit --video-ids list")

    run_dir = Path(args.run_dir)
    media_dir = run_dir / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    log_path = media_dir / "acquire_log.jsonl"

    all_videos = read_jsonl(args.videos)
    video_ids = args.video_ids.split(",") if args.video_ids else None
    selected = select_videos(all_videos, args.select_top_n_per_source, video_ids, args.limit)
    already_done = set() if args.force else terminal_checkpoint_ids(log_path)
    to_process = [video for video in selected if video["video_id"] not in already_done]
    print(f"selected={len(selected)} already_checkpointed={len(selected) - len(to_process)} to_process={len(to_process)}")

    counts = {"ok": 0, "permanent_unavailable": 0, "rate_limited_or_blocked": 0,
              "invalid_input": 0, "unknown_error": 0}
    method_counts = {}
    media_type_counts = {}
    for index, video in enumerate(to_process, 1):
        video_id = video["video_id"]
        output_dir = prepare_force_stage(media_dir, video_id) if args.force else media_dir
        result = download_one(
            video_id, video["video_url"], output_dir, max_attempts=args.max_attempts,
            skip_ytdlp=args.skip_ytdlp, max_bytes=args.max_file_mb * 1024 * 1024,
            expected_kind=video.get("video_url_kind"),
        )
        if args.force:
            result = attach_acquisition_fingerprint(result)
            result = commit_forced_acquisition(media_dir, video_id, output_dir, result)
        else:
            result = attach_acquisition_fingerprint(result)
        counts[result["status"]] = counts.get(result["status"], 0) + 1
        if result.get("method"):
            method_counts[result["method"]] = method_counts.get(result["method"], 0) + 1
        if result.get("media_type"):
            media_type_counts[result["media_type"]] = media_type_counts.get(result["media_type"], 0) + 1
        record = {"video_id": video_id, "video_url": video["video_url"], **result}
        append_jsonl(log_path, record)
        print(f"[{index}/{len(to_process)}] {video_id}: {result['status']}"
              + (f" media_type={result.get('media_type')}" if result.get("media_type") else "")
              + (f" via {result.get('method')}" if result.get("method") else ""))
        if index < len(to_process):
            time.sleep(args.sleep_between)

    print(json.dumps({"processed_this_run": len(to_process), "counts_this_run": counts,
                      "method_counts": method_counts, "media_type_counts": media_type_counts},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
