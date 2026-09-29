#!/usr/bin/env python3
"""Shared utilities for the tiktok-suite tiktok-analyze module.

build_dataset, acquire_media, extract_signals, classify_market_categories,
measure_keywords, rank_patterns, import_browser_photos, select_evidence_frames
(current pipeline) — plus legacy/validate_input, legacy/normalize_dataset
(retired Excel-input path) — import from this module rather than
duplicating logic. In particular the column-name aliasing, video-id
extraction, hashtag parsing, and #PR / text-normalization rules must
stay identical across scripts or downstream counts silently drift.
"""
import json
import hashlib
import ipaddress
import re
import socket
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Column schema
# ---------------------------------------------------------------------------
# Canonical field -> list of source-column-name aliases we've seen in the
# wild. The primary source is a 22-column TikTok search export confirmed
# against real brand and market-keyword files, but we also accept the
# query_group/query/rank-style schema in
# case a future export tool (or a hand-built Excel) uses that shape
# instead, so this skill isn't hard-locked to one vendor.
COLUMN_ALIASES = {
    "cover_image": ["動画カバー", "cover", "thumbnail"],
    "caption": ["動画タイトル", "caption", "動画キャプション", "タイトル"],
    "posted_at": ["投稿時間", "posted_at", "投稿日時"],
    "duration": ["動画の長さ", "duration", "動画時間"],
    "quality_score": ["動画品質スコア", "quality_score"],
    "promo_flag_raw": ["商品販促動画ですか？", "商品販促動画ですか", "is_promo"],
    "creator_name": ["インフルエンサー名", "creator", "creator_name"],
    "creator_id": ["インフルエンサーID", "creator_id"],
    "follower_count": ["フォロワー数", "follower_count", "followers"],
    "views": ["再生数", "views", "play_count"],
    "likes": ["いいね数", "likes", "like_count"],
    "shares": ["シェア数", "shares", "share_count"],
    "comments": ["コメント数", "comments", "comment_count"],
    "saves": ["保存数", "saves", "save_count"],
    "engagement_rate": ["エンゲージメント率", "engagement_rate"],
    "video_url": ["動画URL", "video_url", "url"],
    "hashtags_raw": ["ハッシュタグ", "hashtags"],
    "product_name": ["商品名", "product_name"],
    "product_id": ["製品ID", "product_id"],
    "sku_count": ["SKU数", "sku_count"],
    "product_category": ["商品カテゴリー", "product_category"],
    "product_link": ["商品リンク", "product_link"],
    # Optional legacy/alternate schema (spec-style combined workbook)
    "query_group": ["query_group"],
    "query": ["query"],
    "rank": ["rank", "検索順位"],
    "video_id": ["video_id"],
    "creator_alt": ["creator"],
}


def build_header_map(header_row):
    """Map a raw Excel header row to canonical field names.

    Returns dict: canonical_name -> raw_column_name (only for columns that
    were found). Unmatched raw columns are ignored (forward-compatible with
    an export tool adding new columns later).
    """
    header_map = {}
    normalized_header = {str(h).strip(): h for h in header_row if h is not None}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalized_header:
                header_map[canonical] = normalized_header[alias]
                break
    return header_map


# ---------------------------------------------------------------------------
# Text normalization (shared by #PR detection AND keyword matching)
# ---------------------------------------------------------------------------
_KATAKANA_START, _HIRAGANA_START, _KANA_RANGE_END_OFFSET = ord("ァ"), ord("ぁ"), ord("ヶ") - ord("ァ")


def katakana_to_hiragana(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if _KATAKANA_START <= code <= ord("ヶ"):
            out.append(chr(code - (_KATAKANA_START - _HIRAGANA_START)))
        else:
            out.append(ch)
    return "".join(out)


def is_cjk_char(ch: str) -> bool:
    """Broad CJK check (ideographs + hiragana + katakana + fullwidth
    space), matching the range extract_signals.py's OCR reader already
    uses for its own is-this-Japanese heuristic."""
    return "　" <= ch <= "鿿"


_CJK_INTERNAL_SPACE_RE = re.compile(
    r"(?<=[　-鿿])\s+(?=[　-鿿])"
)


def normalize_text(text: str, kana_fold: bool = False) -> str:
    """Full/half-width fold (NFKC) + lowercase + whitespace squash, PLUS
    removal of whitespace sitting directly between two CJK characters.

    The CJK-internal-space removal exists because Tesseract OCR reads of
    TikTok telops routinely insert a spurious space between every
    character when the source font is stylized/wide-tracked — e.g. a
    telop reading "ヒアルロン酸" is frequently read back as
    "ヒア ル ロ ン 酸". Japanese text never legitimately uses inter-character
    spacing the way English uses word-spacing, so collapsing it is safe;
    NOT collapsing it was found in real OCR-corpus testing to silently
    zero out keyword-appearance-rate matching against actual OCR text,
    which is a correctness bug much worse than the false-positive risk
    this removal could theoretically introduce. Spacing between a CJK
    character and a Latin/digit character is left untouched (that boundary
    is handled separately by contains_term).

    This function is used exclusively for MATCHING (relevance prefilter,
    #PR detection, keyword hit-finding) — never to produce text shown back
    to a human, so this transform does not need to preserve display
    fidelity. kana_fold=True additionally folds katakana->hiragana.
    """
    if text is None:
        return ""
    t = unicodedata.normalize("NFKC", str(text))
    t = t.lower()
    t = re.sub(r"\s+", " ", t).strip()
    t = _CJK_INTERNAL_SPACE_RE.sub("", t)
    if kana_fold:
        t = katakana_to_hiragana(t)
    return t


_LATIN_ALNUM_RE = re.compile(r"[A-Za-z0-9]")


def contains_term(text: str, term: str) -> bool:
    """Boundary-aware substring match. Plain `term in text` is not safe for
    brand/keyword matching in mixed Japanese/Latin text: naive substring
    search on a short brand token can match inside a longer, unrelated
    Latin brand name — a false positive that inflates every
    downstream count. But we also can't require whitespace boundaries like
    English text would, because Japanese has none: 'ABCの新商品' glues the
    brand directly onto a particle and must still match.

    Rule: a match counts unless it is glued onto a Latin letter/digit on
    either side (i.e. it is part of one longer Latin token, such as
    'pre'+'ABC'+'post'). Both args should already be normalize_text()'d by the
    caller so casing/width differences don't hide a real match.
    """
    if not term:
        return False
    start = 0
    while True:
        idx = text.find(term, start)
        if idx == -1:
            return False
        before = text[idx - 1] if idx > 0 else ""
        after = text[idx + len(term)] if idx + len(term) < len(text) else ""
        if not _LATIN_ALNUM_RE.match(before) and not _LATIN_ALNUM_RE.match(after):
            return True
        start = idx + 1


def parse_hashtags(raw: str):
    """Exported hashtag cells are often newline-separated '#tag' tokens, with
    occasional trailing spaces / half-width vs full-width '#'. Returns a
    list of tag strings WITHOUT the leading '#', normalized for comparison
    but preserving original casing in a parallel 'display' isn't needed
    here — callers that need display text should re-derive from raw."""
    if not raw:
        return []
    parts = re.split(r"[\n,、]+", str(raw))
    tags = []
    for p in parts:
        p = p.strip()
        p = re.sub(r"^[#＃]+", "", p)
        if p:
            tags.append(p)
    return tags


def has_pr_tag(hashtags_raw: str, caption: str = "", ocr_text: str = "") -> bool:
    """A post counts as '#PRあり' only if a hashtag/caption/OCR token is
    EXACTLY 'PR' after normalization — not a substring match. This matters
    because real data can contain hashtags like '#brand_pr' or '#PRチーム' that
    are NOT an ad-disclosure tag and must not be misclassified.
    """
    candidates = []
    for tag in parse_hashtags(hashtags_raw):
        candidates.append(tag)
    if caption:
        candidates += re.findall(r"[#＃]([\w一-龠ぁ-んァ-ヶー]+)", caption)
    if ocr_text:
        candidates += re.findall(r"[#＃]([\w一-龠ぁ-んァ-ヶー]+)", ocr_text)
    for c in candidates:
        if normalize_text(c) == "pr":
            return True
    return False


# ---------------------------------------------------------------------------
# TikTok URL / video id
# ---------------------------------------------------------------------------
_VIDEO_ID_RE = re.compile(r"/video/(\d+)")
_PHOTO_RE = re.compile(r"/photo/(\d+)")

TIKTOK_PAGE_HOSTS = {
    "tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
}
TIKTOK_MEDIA_SUFFIXES = (
    ".tiktok.com", ".tiktokcdn.com", ".tiktokv.com", ".ibytedtos.com",
    ".byteoversea.com", ".akamaized.net",
)


def validate_tiktok_page_url(url: str):
    """Return ``(ok, reason)`` for a user-supplied TikTok page URL.

    This is a security boundary: spreadsheet URLs are untrusted input and
    must never turn the downloader into a generic HTTP/SSRF client.
    """
    try:
        parsed = urlparse(str(url or "").strip())
    except ValueError:
        return False, "malformed URL"
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https":
        return False, "only https URLs are accepted"
    try:
        port = parsed.port
    except ValueError:
        return False, "invalid port"
    if parsed.username or parsed.password or port not in (None, 443):
        return False, "credentials and non-standard ports are not accepted"
    if host not in TIKTOK_PAGE_HOSTS:
        return False, f"host is not an allowed TikTok page host: {host or '(missing)'}"
    return True, None


def validate_tiktok_media_url(url: str, resolve_dns=True):
    """Validate a CDN URL extracted from a trusted TikTok page response."""
    try:
        parsed = urlparse(str(url or "").strip())
    except ValueError:
        return False, "malformed media URL"
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or not host:
        return False, "media URL must be https with a hostname"
    try:
        port = parsed.port
    except ValueError:
        return False, "invalid media port"
    if parsed.username or parsed.password or port not in (None, 443):
        return False, "media URL contains credentials or a non-standard port"
    allowed = host in TIKTOK_PAGE_HOSTS or any(host.endswith(suffix) for suffix in TIKTOK_MEDIA_SUFFIXES)
    if not allowed:
        return False, f"media host is outside the TikTok CDN allowlist: {host}"
    if resolve_dns:
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
        except socket.gaierror as exc:
            return False, f"media host DNS resolution failed: {exc}"
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if not ip.is_global:
                return False, f"media host resolved to a non-public address: {address}"
    return True, None


def extract_video_id(url: str):
    if not url:
        return None, None
    safe, _reason = validate_tiktok_page_url(url)
    if not safe:
        return None, "invalid_url"
    m = _VIDEO_ID_RE.search(url)
    if m:
        return m.group(1), "video"
    m = _PHOTO_RE.search(url)
    if m:
        return m.group(1), "photo"
    # vm.tiktok.com / vt.tiktok.com short links have no id in the URL —
    # yt-dlp resolves these itself; treat the whole URL as the dedup key.
    return None, "short_link"


def is_short_link(url: str) -> bool:
    return bool(re.search(r"(vm|vt)\.tiktok\.com/", url or ""))


def resolve_media_path(raw_path, media_dir):
    """取得台帳（acquire_log.jsonl）に書かれた媒体パスを、今の run-dir の media/ 配下で解決する。

    台帳のパスは search.mjs が**書いたときの形のまま**（絶対パス、または
    `--run-dir run` で実行したときの `run/media/<id>.mp4` のようなカレント相対）。
    これをそのまま Path() に渡すと、run-dir を移動・コピー・共有したときや、
    解析をスキル側の scripts/ から実行したときに全件「媒体が無い」になる
    （実測: 全投稿が error になり、既存の正常な signals まで上書きされた）。

    そこで次の順に候補を試し、**解決後に media_dir の内側にある実在ファイル**だけを返す。
    台帳を書き換えて media/ の外を読ませる改ざんは、最後の relative_to で従来どおり弾く。
      1. 書かれたまま（絶対パス／カレント相対）
      2. run-dir 基準・run-dir の親基準（search.mjs を相対 --run-dir で実行した場合）
      3. パス中の最後の `media` より後ろを、今の media_dir に付け直したもの（run-dir を移動した場合）
      4. `media` を含まないときは末尾2要素（<id>_photos/01.jpg）／末尾1要素
    """
    if not raw_path:
        return None
    media_dir = Path(media_dir)
    try:
        media_root = media_dir.resolve(strict=True)
    except OSError:
        return None
    raw = Path(str(raw_path))
    candidates = [raw]
    if not raw.is_absolute():
        run_dir = media_dir.parent
        candidates += [run_dir / raw, run_dir.parent / raw]
    parts = raw.parts
    media_positions = [i for i, part in enumerate(parts) if part == "media"]
    if media_positions and media_positions[-1] + 1 < len(parts):
        candidates.append(media_dir.joinpath(*parts[media_positions[-1] + 1:]))
    elif parts:
        if len(parts) >= 2:
            candidates.append(media_dir.joinpath(*parts[-2:]))
        candidates.append(media_dir / parts[-1])
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
            resolved.relative_to(media_root)
        except (OSError, ValueError):
            continue
        if resolved.is_file():
            return resolved
    return None


def safe_artifact_id(value) -> str:
    """Map an untrusted logical ID to a collision-resistant filename token.

    Normal TikTok numeric IDs and generated hex hashes remain readable.  IDs
    containing path syntax, whitespace, or excessive length are represented by
    a short sanitized hint plus a SHA-256 suffix, avoiding both traversal and
    the collisions caused by lossy character replacement alone.
    """
    raw = str(value or "")
    if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", raw):
        return raw
    hint = re.sub(r"[^A-Za-z0-9_-]", "_", raw).strip("_")[:32] or "id"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"{hint}_{digest}"


# ---------------------------------------------------------------------------
# JSONL helpers
# ---------------------------------------------------------------------------
def read_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    records = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def write_jsonl(path, records):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def append_jsonl(path, record):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_checkpoint_ids(path, id_field="video_id"):
    """Return the set of ids already recorded in a jsonl checkpoint file."""
    return {r.get(id_field) for r in read_jsonl(path) if r.get(id_field)}


# ---------------------------------------------------------------------------
# Numeric / date parsing — some export tools write every metric as a display STRING
# ("5,900,000", "0.27%", "00:21", "2022/10/04 19:01:59"), not a native Excel
# number. Every downstream script must go through these so a comma or a
# stray "%" never silently turns into a parse error or a wrong count.
# ---------------------------------------------------------------------------
import datetime  # noqa: E402


def parse_int(text):
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return int(text)
    s = str(text).strip().replace(",", "")
    if s in ("", "-", "N/A", "n/a"):
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


def parse_percent(text):
    if text is None:
        return None
    s = str(text).strip().replace("%", "")
    if s in ("", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_score(text):
    """動画品質スコア: values are usually ~50-100. A literal 0 has been
    observed on rows that otherwise look unscored (no other anomaly), so we
    treat exactly 0 as 'not scored' (None) rather than a real worst-case
    score. Keep the raw string separately if the caller needs it."""
    v = parse_int(text) if isinstance(text, str) and "." not in text else None
    try:
        f = float(str(text).strip()) if text not in (None, "", "-") else None
    except ValueError:
        f = None
    if f is None or f == 0:
        return None
    return f


def parse_duration_to_seconds(text):
    """'00:21' -> 21, '01:31' -> 91, '1:02:03' -> 3723."""
    if not text:
        return None
    parts = str(text).strip().split(":")
    try:
        parts = [int(p) for p in parts]
    except ValueError:
        return None
    seconds = 0
    for p in parts:
        seconds = seconds * 60 + p
    return seconds


def extract_cover_image_map(xlsx_path):
    """Map 0-indexed worksheet row -> embedded media filename (e.g. 'xl/media/image7.jpeg').

    A "動画カバーをエクスポート" option may embed one picture per row via
    a <xdr:oneCellAnchor> drawing anchored to that row, referencing
    xl/media/imageN.* through a relationship id. We parse the drawing XML
    directly (rather than assuming image1.jpeg==row1, image2.jpeg==row2...)
    so this stays correct even if a future export reorders rows after
    inserting images.
    """
    import zipfile
    from xml.etree import ElementTree as ET

    ns = {
        "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    }
    row_to_filename = {}
    try:
        with zipfile.ZipFile(xlsx_path) as z:
            drawing_names = [n for n in z.namelist() if re.match(r"xl/drawings/drawing\d+\.xml$", n)]
            if not drawing_names:
                return row_to_filename
            drawing_name = drawing_names[0]
            rels_name = f"xl/drawings/_rels/{Path(drawing_name).name}.rels"
            rid_to_target = {}
            if rels_name in z.namelist():
                rels_root = ET.fromstring(z.read(rels_name))
                for rel in rels_root:
                    rid = rel.attrib.get("Id")
                    target = rel.attrib.get("Target", "")
                    target = re.sub(r"^\.\./", "xl/", target)
                    if not target.startswith("xl/"):
                        target = "xl/drawings/" + target
                    rid_to_target[rid] = target

            root = ET.fromstring(z.read(drawing_name))
            for anchor in root:
                tag = anchor.tag.split("}")[-1]
                if tag not in ("oneCellAnchor", "twoCellAnchor"):
                    continue
                frm = anchor.find("xdr:from", ns)
                if frm is None:
                    continue
                row_el = frm.find("xdr:row", ns)
                if row_el is None:
                    continue
                row_idx = int(row_el.text)
                # namespace-agnostic search is more robust than a qualified
                # find() here — anchor shapes/pics can nest a few different
                # ways across Excel/Sheets/LibreOffice writers
                blip = next((el for el in anchor.iter() if el.tag.endswith("}blip")), None)
                if blip is None:
                    continue
                embed_rid = blip.attrib.get(f"{{{ns['r']}}}embed")
                target = rid_to_target.get(embed_rid)
                if target:
                    row_to_filename[row_idx] = target
    except Exception:
        return row_to_filename
    return row_to_filename


def parse_datetime(text):
    """'2022/10/04 19:01:59' -> ISO 8601 string. Returns None (not a raise)
    on anything unparseable, since a bad date shouldn't crash a 200-row
    batch — callers should treat None as 'unknown, flag for review'."""
    if not text:
        return None
    for fmt in ("%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(str(text).strip(), fmt).isoformat()
        except ValueError:
            continue
    return None
