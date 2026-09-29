#!/usr/bin/env python3
"""Encode top-ranked videos (rank = row order within each source file, per
user-confirmed convention) against the A-F "killer pattern" taxonomy in
references/analysis-rubric.md, and aggregate common-rates per axis.

This is explicitly a HYPOTHESIS-GENERATION step, not a causal-proof step —
see analysis-rubric.md's closing section on 事実/AI分類/勝因仮説/提案. All
output field names and print strings in this script follow that framing
(e.g. "common_rate", never "winning_formula").

Usage:
    python3 rank_patterns.py --run-dir <dir> --confirmed-config confirmed_config.json \
        [--top-n 10]

Output:
    <run-dir>/measurement/rank_patterns_output.json
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import read_jsonl, normalize_text, contains_term  # noqa: E402

# ---- keyword lexicons for the A / B / C / F sub-patterns (JP) ----
HOOK_QUESTION_RE = re.compile(r"[？?]|か[。\s]*$|かも")
HOOK_NUMBER_RE = re.compile(r"\d+\s*(円|%|％|日|個|位|万|才|歳)")
HOOK_BOLD_WORDS = ["実は", "本当に", "衝撃", "まさか", "絶対", "知らなきゃ", "知らないと", "やばい", "ヤバい"]
HOOK_EMPATHY_WORDS = ["な人", "悩んでる", "あるある", "こんな人"]

PROOF_NUMBER_RE = re.compile(r"\d+\s*(%|％|人|件)")
PROOF_COMPARE_WORDS = ["比較", "検証", "実験", "before", "after", "ビフォー", "アフター", "使う前", "使った後"]
PROOF_THIRDPARTY_WORDS = ["口コミ", "レビュー", "リアルな声", "愛用者"]
PROOF_AUTHORITY_WORDS = ["賞", "ランキング1位", "ランキング１位", "年連続", "専門家"]

STRUCTURE_ORDER_WORDS = ["まず", "次に", "最後に", "1つ目", "2つ目", "3つ目", "1個目"]
# NOTE: circled digits (①②③) are matched separately via CIRCLED_DIGIT_RE on
# RAW (non-normalize_text'd) text — NFKC normalization decomposes "①" into
# a bare "1", which would make this a same-as-any-digit-anywhere match
# (prices, percentages, counts...) instead of a specific structure signal.
CIRCLED_DIGIT_RE = re.compile(r"[①②③④⑤]")

PLACEMENT_CTA_LINK_WORDS = ["購入", "リンク", "概要欄", "プロフィール", "tiktok shop", "shop now"]

CTA_FOLLOW_WORDS = ["フォロー", "保存", "いいねして"]
CTA_LINK_WORDS = ["概要欄", "プロフィール", "リンクから", "購入はこちら", "tiktok shop"]
CTA_COMMENT_WORDS = ["コメントで教えて", "気になったらコメント", "コメントして"]


def _any_word(text, words):
    n = normalize_text(text)
    return [w for w in words if normalize_text(w) in n]


def _window_bounds(duration):
    if not duration or duration <= 0:
        duration = 20.0
    hook_end = max(3.0, duration * 0.15)
    cta_start = duration - max(3.0, duration * 0.15)
    return hook_end, cta_start


def _all_text_with_ts(ocr_spans, asr_segments):
    """Merged list of (start, end, text, source) across OCR+ASR, time-sorted.

    source は "telop" か "voice"。音声の書き起こしは誤認識を含むため、
    資料に引用する側が区別できるように出所を保持する。
    """
    items = []
    for s in ocr_spans or []:
        items.append((s.get("start", 0) or 0, s.get("end", 0) or 0, s.get("text", ""), "telop"))
    for s in asr_segments or []:
        items.append((s.get("start", 0) or 0, s.get("end", 0) or 0, s.get("text", ""), "voice"))
    return sorted(items, key=lambda x: x[0])


def classify_hook(items, hook_end):
    early_items = [{"start": start, "end": end, "text": text, "source": src}
                   for (start, end, text, src) in items if start <= hook_end]
    blob = " ".join(item["text"] for item in early_items)
    tags = []
    if HOOK_QUESTION_RE.search(blob):
        tags.append("疑問形")
    if HOOK_NUMBER_RE.search(blob):
        tags.append("数字訴求")
    hit_bold = _any_word(blob, HOOK_BOLD_WORDS)
    if hit_bold:
        tags.append("断言・煽り")
    hit_empathy = _any_word(blob, HOOK_EMPATHY_WORDS)
    if hit_empathy:
        tags.append("悩み共感")
    return {
        "present": len(tags) > 0,
        "tags": tags,
        "evidence": early_items[:3],
    }


def classify_proof(items):
    blob = " ".join(t for (_, _, t, _s) in items)
    tags = []
    if PROOF_NUMBER_RE.search(blob):
        tags.append("数値・データ提示")
    if _any_word(blob, PROOF_COMPARE_WORDS):
        tags.append("比較・検証")
    if _any_word(blob, PROOF_THIRDPARTY_WORDS):
        tags.append("第三者性")
    if _any_word(blob, PROOF_AUTHORITY_WORDS):
        tags.append("権威・実績")
    evidence = [{"start": start, "end": end, "text": t}
                for (start, end, t, _s) in items if any(
        PROOF_NUMBER_RE.search(t) or _any_word(t, PROOF_COMPARE_WORDS + PROOF_THIRDPARTY_WORDS + PROOF_AUTHORITY_WORDS)
        for _ in [None]
    )][:3]
    return {"present": len(tags) > 0, "tags": tags, "evidence": evidence}


def classify_structure(items, ocr_spans):
    """段階構成 looks at OCR+ASR combined (order words can appear in either).
    リスト構成 deliberately looks at OCR spans ONLY, not ASR: faster-whisper's
    VAD-based segmentation chunks nearly ANY speech into short phrases, so
    'a handful of short items' is true of almost every video's ASR output
    and would make this heuristic fire near-universally. Short, numerous
    ON-SCREEN telops are a much more specific signal of deliberate
    listicle-style overlay design."""
    blob = " ".join(t for (_, _, t, _s) in items)
    order_hits = _any_word(blob, STRUCTURE_ORDER_WORDS)
    circled_count = len(CIRCLED_DIGIT_RE.findall(blob))
    order_signal_count = len(order_hits) + (circled_count if circled_count >= 2 else 0)
    ocr_texts = [s.get("text", "") for s in (ocr_spans or []) if s.get("text")]
    list_like = len([t for t in ocr_texts if len(t) <= 12]) >= 4
    structured = order_signal_count >= 2 or list_like
    return {
        "present": structured,
        "classification": "構成あり" if structured else "単一メッセージ型",
        "tags": (["段階構成"] if order_signal_count >= 2 else []) + (["リスト構成"] if list_like else []),
    }


def classify_placement(measurement_audit, hook_end):
    # measure_keywords.py の監査が無い投稿を present:false にすると、
    # 「計測していない」が「言葉を置いていない」として 0% で集計される。
    # 実測でこれが起き、上位100% vs 下位0%（+100pt）という偽の差分が出た。
    if not measurement_audit:
        return {"present": None, "tags": [], "evidence": [],
                "note": "measure_keywords.py の監査が無いため判定不可（0%ではない）"}
    mention_groups = (measurement_audit or {}).get("timed_mention_groups", [])
    if not mention_groups:
        counts = (measurement_audit or {}).get("channel_counts", {})
        tags = ["キャプション提示"] if counts.get("caption", 0) or counts.get("hashtag", 0) else []
        return {"present": bool(tags), "tags": tags, "evidence": []}
    starts = [g.get("event_start", g.get("representative_start")) for g in mention_groups
              if g.get("event_start", g.get("representative_start")) is not None]
    tags = []
    if starts and min(starts) <= hook_end:
        tags.append("早期提示")
    if len(mention_groups) >= 3:
        tags.append("反復提示")
    counts = (measurement_audit or {}).get("channel_counts", {})
    if (counts.get("caption", 0) or counts.get("hashtag", 0)) and counts.get("ocr", 0):
        tags.append("キャプション＋テロップ")
    if counts.get("ocr", 0) and counts.get("asr", 0):
        tags.append("テロップ＋音声")
    return {"present": len(tags) > 0, "tags": tags, "mention_count": len(mention_groups)}


def classify_product_connection(items, duration, product_terms):
    if not product_terms:
        return {"present": None, "note": "商品名が未確認のため判定不可"}
    first_ts = None
    for (start, _end, t, _s) in items:
        if any(contains_term(normalize_text(t), normalize_text(pt)) for pt in product_terms):
            first_ts = start
            break
    cta_link = _any_word(" ".join(t for (_, _, t, _s) in items), PLACEMENT_CTA_LINK_WORDS)
    if first_ts is None:
        return {"present": False, "tags": (["購買導線あり"] if cta_link else []), "first_mention_sec": None}
    early = duration and first_ts <= duration * 0.5
    tags = (["早期接続"] if early else ["終盤接続"]) + (["購買導線あり"] if cta_link else [])
    return {"present": True, "tags": tags, "first_mention_sec": round(first_ts, 1)}


def classify_cta(items, cta_start):
    late_items = [{"start": start, "end": end, "text": text, "source": src}
                  for (start, end, text, src) in items if end is not None and end >= cta_start]
    blob = " ".join(item["text"] for item in late_items)
    tags = []
    if _any_word(blob, CTA_FOLLOW_WORDS):
        tags.append("フォロー訴求")
    if _any_word(blob, CTA_LINK_WORDS):
        tags.append("購入導線")
    if _any_word(blob, CTA_COMMENT_WORDS):
        tags.append("コメント誘導")
    return {"present": len(tags) > 0, "tags": tags, "evidence": late_items[:3]}


def _photo_evidence(spans, predicate=None):
    result = []
    for span in spans or []:
        text = span.get("text", "")
        if predicate and not predicate(text):
            continue
        provenance = span.get("source_provenance") or {}
        result.append({
            "start": None,
            "end": None,
            "photo_index": provenance.get("photo_index"),
            "text": text,
        })
    return result


def classify_photo_hook(ocr_spans):
    if not ocr_spans:
        # テロップ未取り込み。「無い」ではなく「判定不可」。
        # false にすると aggregate_common_rates の分母に入り 0% として集計される。
        return {"present": None, "tags": [], "evidence": [],
                "note": "写真のテロップ未計測のため判定不可（0%ではない）"}
    first_photo = [
        span for span in (ocr_spans or [])
        if (span.get("source_provenance") or {}).get("photo_index") == 1
    ]
    blob = " ".join(span.get("text", "") for span in first_photo)
    tags = []
    if HOOK_QUESTION_RE.search(blob):
        tags.append("疑問形")
    if HOOK_NUMBER_RE.search(blob):
        tags.append("数字訴求")
    if _any_word(blob, HOOK_BOLD_WORDS):
        tags.append("断言・煽り")
    if _any_word(blob, HOOK_EMPATHY_WORDS):
        tags.append("悩み共感")
    if not first_photo:
        return {"present": None, "tags": [], "evidence": [],
                "note": "1枚目のテロップを読み取れていないため判定不可"}
    return {"present": bool(tags), "tags": tags, "evidence": _photo_evidence(first_photo)[:3]}


def classify_photo_proof(ocr_spans, asr_segments):
    if not ocr_spans and not asr_segments:
        return {"present": None, "tags": [], "evidence": [],
                "note": "写真のテロップ・音声いずれも未計測のため判定不可"}
    # Audio can support the heuristic, while visual evidence remains tied to
    # an actual photo index rather than a fabricated second value.
    blob = " ".join(
        [span.get("text", "") for span in (ocr_spans or [])]
        + [segment.get("text", "") for segment in (asr_segments or [])]
    )
    tags = []
    if PROOF_NUMBER_RE.search(blob):
        tags.append("数値・データ提示")
    if _any_word(blob, PROOF_COMPARE_WORDS):
        tags.append("比較・検証")
    if _any_word(blob, PROOF_THIRDPARTY_WORDS):
        tags.append("第三者性")
    if _any_word(blob, PROOF_AUTHORITY_WORDS):
        tags.append("権威・実績")

    def is_proof(text):
        return bool(
            PROOF_NUMBER_RE.search(text)
            or _any_word(text, PROOF_COMPARE_WORDS + PROOF_THIRDPARTY_WORDS + PROOF_AUTHORITY_WORDS)
        )

    return {"present": bool(tags), "tags": tags, "evidence": _photo_evidence(ocr_spans, is_proof)[:3]}


def classify_photo_product_connection(ocr_spans, asr_segments, product_terms):
    if not ocr_spans and not asr_segments:
        return {"present": None, "tags": [], "evidence": [],
                "note": "写真のテロップ・音声いずれも未計測のため判定不可"}
    if not product_terms:
        return {"present": None, "note": "商品名が未確認のため判定不可"}
    for span in ocr_spans or []:
        text = normalize_text(span.get("text", ""))
        if any(contains_term(text, normalize_text(term)) for term in product_terms):
            photo_index = (span.get("source_provenance") or {}).get("photo_index")
            return {
                "present": True,
                "tags": ["写真内接続"],
                "first_mention_sec": None,
                "first_mention_photo": photo_index,
                "evidence": _photo_evidence([span]),
            }
    audio_blob = normalize_text(" ".join(segment.get("text", "") for segment in (asr_segments or [])))
    if any(contains_term(audio_blob, normalize_text(term)) for term in product_terms):
        return {"present": True, "tags": ["音声接続"], "first_mention_sec": None,
                "first_mention_photo": None, "evidence": []}
    return {"present": False, "tags": [], "first_mention_sec": None,
            "first_mention_photo": None, "evidence": []}


def classify_photo_cta(ocr_spans, total_photo_count=None):
    indexed = [
        ((span.get("source_provenance") or {}).get("photo_index"), span)
        for span in (ocr_spans or [])
    ]
    indices = [index for index, _span in indexed if isinstance(index, int)]
    if not indices and not total_photo_count:
        return {"present": None, "tags": [], "evidence": [], "note": "写真順を確認できないため判定不可"}
    last_index = int(total_photo_count) if total_photo_count else max(indices)
    final_spans = [span for index, span in indexed if index == last_index]
    if not final_spans:
        return {
            "present": None, "tags": [], "evidence": [],
            "note": f"最終写真（{last_index}枚目）の文字を読み取れないため判定不可",
        }
    blob = " ".join(span.get("text", "") for span in final_spans)
    tags = []
    if _any_word(blob, CTA_FOLLOW_WORDS):
        tags.append("フォロー訴求")
    if _any_word(blob, CTA_LINK_WORDS):
        tags.append("購入導線")
    if _any_word(blob, CTA_COMMENT_WORDS):
        tags.append("コメント誘導")
    return {"present": bool(tags), "tags": tags, "evidence": _photo_evidence(final_spans)[:3]}


def get_duration_from_signal(signal):
    ocr = signal.get("ocr_spans") or []
    asr = signal.get("asr_segments") or []
    ends = [s.get("end", 0) or 0 for s in ocr] + [s.get("end", 0) or 0 for s in asr]
    return max(ends) if ends else None


def classify_video(video_record, signal, measurement_audit, product_terms):
    ocr = signal.get("ocr_spans") or []
    # 写真投稿の音声はBGMのみ。楽曲の歌詞を「証明の見せ方」「商品接続」の
    # 根拠にすると、投稿者が言っていないことを言ったことにしてしまう。
    # measured 以外（not_applicable / unmeasured / pending）は実データではない。
    # 空配列を渡すと「発話が無かった」ことにされ、勝ちパターンの判定が歪む
    asr = ([] if signal.get("voice_channel") != "measured"
           else (signal.get("asr_segments") or []))
    items = _all_text_with_ts(ocr, asr)
    duration = video_record.get("duration_seconds") or get_duration_from_signal(signal)
    hook_end, cta_start = _window_bounds(duration)

    media_type = signal.get("media_type", "video")
    if media_type == "photo":
        placement = classify_placement(measurement_audit, hook_end)
        counts = (measurement_audit or {}).get("channel_counts", {})
        if counts.get("ocr", 0):
            placement.setdefault("tags", []).append("写真内提示")
            placement["present"] = True
        result = {
            "video_id": video_record["video_id"],
            "media_type": "photo",
            "duration_seconds": duration,
            "A_opening_hook": classify_photo_hook(ocr),
            "B_proof": classify_photo_proof(ocr, asr),
            "C_structure": classify_structure(items, ocr),
            "D_keyword_placement": placement,
            "E_product_connection": classify_photo_product_connection(ocr, asr, product_terms),
            "F_cta": classify_photo_cta(ocr, signal.get("photos_ocrd")),
        }
    else:
        result = {
            "video_id": video_record["video_id"],
            "media_type": "video",
            "duration_seconds": duration,
            "A_opening_hook": classify_hook(items, hook_end),
            "B_proof": classify_proof(items),
            "C_structure": classify_structure(items, ocr),
            "D_keyword_placement": classify_placement(measurement_audit, hook_end),
            "E_product_connection": classify_product_connection(items, duration, product_terms),
            "F_cta": classify_cta(items, cta_start),
        }
    for key in (category_key for category_key, _ in CATEGORY_KEYS):
        result[key]["basis"] = "text_audio_signal_heuristic"
    result["acquisition_sha256"] = signal.get("acquisition_sha256")
    return result


def apply_visual_review(classification, review):
    """Overlay an AI visual review while preserving the text heuristic."""
    if not isinstance(review, dict):
        return classification
    for key, _label in CATEGORY_KEYS:
        if key == "D_keyword_placement":
            continue
        reviewed = review.get(key)
        if not isinstance(reviewed, dict) or "present" not in reviewed:
            continue
        previous = classification.get(key, {})
        classification[key] = {
            **reviewed,
            "basis": "ai_visual_review",
            "text_audio_signal": previous,
        }
    classification["visual_review_status"] = "reviewed"
    classification["visual_review_note"] = review.get("review_note")
    return classification


CATEGORY_KEYS = [
    ("A_opening_hook", "冒頭フック"),
    ("B_proof", "証明の見せ方"),
    ("C_structure", "情報設計（構成あり）"),
    ("D_keyword_placement", "言葉の置き方"),
    ("E_product_connection", "商品接続"),
    ("F_cta", "行動喚起（CTA）"),
]


MIN_STRATUM_N = 3        # 層ごとの最小本数。これ未満の層は差分を出さない


def rank_up_deltas_by_media(top_classifications, bottom_classifications):
    """上位群と下位群の差分を **媒体種別ごと** に出す。

    動画と写真を混ぜて比べると、上位が動画寄り・下位が写真寄りのときに
    「演出の差」ではなく「動画か写真か」を測ってしまう（実測で下位帯は写真100%）。
    そこで層別にし、両側に十分な本数がある層だけ差分を出す。
    """
    strata = []
    for media in ("video", "photo"):
        top = [c for c in top_classifications if c.get("media_type") == media]
        bot = [c for c in bottom_classifications if c.get("media_type") == media]
        if len(top) < MIN_STRATUM_N or len(bot) < MIN_STRATUM_N:
            strata.append({
                "media_type": media, "comparable": False,
                "top_n": len(top), "bottom_n": len(bot),
                "block_reason": (f"母数不足（上位{len(top)}本／下位{len(bot)}本、"
                                 f"各{MIN_STRATUM_N}本以上が必要）"),
                "category_deltas": [],
            })
            continue
        top_rates = aggregate_common_rates(top)
        bot_rates = aggregate_common_rates(bot)
        rows = []
        for key, label in CATEGORY_KEYS:
            t, b = top_rates[key], bot_rates[key]
            tr, br = t.get("common_rate_pct"), b.get("common_rate_pct")
            if tr is None or br is None:
                # 片側が判定不可（未計測など）。0% と混同しないよう差分を出さない。
                rows.append({"category": label, "delta_pt": None,
                             "note": "片側が判定不可のため差分なし（0ptではない）"})
                continue
            rows.append({
                "category": label,
                "top_common_rate_pct": tr, "top_n": t["applicable_count"],
                "bottom_common_rate_pct": br, "bottom_n": b["applicable_count"],
                "delta_pt": round(tr - br, 1),
            })
        rows.sort(key=lambda r: (r["delta_pt"] is None, -(r["delta_pt"] or 0)))
        strata.append({
            "media_type": media, "comparable": True,
            "top_n": len(top), "bottom_n": len(bot),
            "block_reason": None, "category_deltas": rows,
        })
    return strata


def aggregate_common_rates(video_classifications):
    n = len(video_classifications)
    result = {}
    for key, label in CATEGORY_KEYS:
        applicable = [vc for vc in video_classifications if vc[key].get("present") is not None]
        if not applicable:
            result[key] = {"label": label, "common_rate_pct": None, "note": "判定不可（対象0件）"}
            continue
        present_count = sum(1 for vc in applicable if vc[key]["present"])
        result[key] = {
            "label": label,
            "present_count": present_count,
            "applicable_count": len(applicable),
            "common_rate_pct": round(present_count / len(applicable) * 100, 1),
        }
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--confirmed-config", required=True)
    ap.add_argument("--top-n", type=int, default=10)
    ap.add_argument("--bottom-ids", default=None,
                    help="下位群の video_id をカンマ区切りで明示指定する。"
                         "順位の末尾は投稿日が古く媒体種別も偏るため、"
                         "鮮度を揃えたコホート内の下位を渡すのが正確（--bottom-n より優先）")
    ap.add_argument("--bottom-n", type=int, default=None,
                    help="下位群の本数。指定すると 上位vs下位 の差分を"
                         "媒体種別ごと（動画は動画・写真は写真）に出す。"
                         "未指定なら差分は出さない（既定）")
    ap.add_argument(
        "--allow-unmeasured-telop", action="store_true",
        help="telop 未計測の投稿があっても分類する（テロップ由来の分類は 0%% ではなく未計測として扱う）")
    ap.add_argument("--visual-review", default=None,
                    help="optional AI visual review JSON; see references/visual-review-schema.md")
    args = ap.parse_args()

    run_dir = Path(args.run_dir)
    cfg = json.loads(Path(args.confirmed_config).read_text(encoding="utf-8"))
    confirmed_product = cfg.get("product") or cfg.get("product_name")
    visual_reviews = {}
    if args.visual_review:
        review_path = Path(args.visual_review)
        if not review_path.exists():
            print(f"ERROR: visual review file not found: {review_path}", file=sys.stderr)
            raise SystemExit(1)
        review_data = json.loads(review_path.read_text(encoding="utf-8"))
        visual_reviews = review_data.get("videos", review_data)

    videos = {v["video_id"]: v for v in read_jsonl(run_dir / "normalized" / "videos.jsonl")}

    signals = {}
    signals_dir = run_dir / "signals"
    if signals_dir.exists():
        for fp in signals_dir.glob("*.json"):
            try:
                d = json.loads(fp.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if d.get("status") == "ok":
                signals[d["video_id"]] = d

    measure_path = run_dir / "measurement" / "measure_output.json"
    measurement_audits_by_video = {}
    if measure_path.exists():
        measure = json.loads(measure_path.read_text(encoding="utf-8"))
        for audit in measure.get("video_level_audit", []):
            measurement_audits_by_video[audit["video_id"]] = audit

    axes_out = []
    for file_cfg in cfg["files"]:
        label = file_cfg["label"]
        role = file_cfg["role"]
        source_file = Path(file_cfg["path"]).name

        # rank = row order within this file (per user-confirmed convention)
        ranked = []
        for vid, vr in videos.items():
            for appearance in vr.get("source_appearances", []):
                if appearance["source_file"] == source_file:
                    ranked.append((appearance["rank"], vid))
        ranked.sort(key=lambda x: x[0])

        # Restrict to the TRUE top-N by rank first, THEN drop any that lack a
        # signal file — do not filter-then-slice. A video can legitimately
        # appear in more than one source file's ranking (e.g. a self-brand
        # video that also surfaces in the market-keyword search), so acquiring
        # media for one axis's top-N can incidentally produce a signals file
        # for a video that sits far outside another axis's own top-N. Filtering
        # for "has signal" before slicing let those out-of-rank videos silently
        # backfill the classified set — e.g. a rank #64 video counted toward
        # "top 10" pattern stats for an axis it doesn't actually rank highly in,
        # diluting the common-rate percentages without anything reporting it.
        # Slicing to the true top-N first means a run with acquisition failures
        # inside the top-N honestly reports fewer classified videos instead of
        # quietly reaching further down the list to compensate.
        true_top_n = ranked[: args.top_n]
        top_ids_with_signal = [(rank, vid) for rank, vid in true_top_n if vid in signals]
        skipped_no_signal = [(rank, vid) for rank, vid in true_top_n if vid not in signals]

        # E_product_connection needs a name to look for. For the self axis we
        # have a real confirmed product name; for competitor/market_keyword
        # axes we don't (the 6-input schema only asks for the user's OWN
        # product), so fall back to the axis's own brand/keyword label as a
        # reasonable proxy for "does this video connect to what it's about
        # early on" — better than silently reporting N/A for 3 of 4 axes.
        axis_product_terms = [confirmed_product] if (role == "self" and confirmed_product) else [label]
        axis_product_terms = [t for t in axis_product_terms if t]

        classifications = []
        # telop 未計測の投稿を混ぜると、テロップ由来の分類（冒頭フック・証明・CTA 等）が
        # 「無い」と判定される。実際は「まだ読んでいない」だけなので、
        # 上位の勝ちパターンを 0% と誤って報告することになる。
        unmeasured_here = [v for _r, v in top_ids_with_signal
                           if not signals[v].get("telop_measured", False)]
        if unmeasured_here and not args.allow_unmeasured_telop:
            sample = ", ".join(unmeasured_here[:5])
            more = f" ほか{len(unmeasured_here) - 5}件" if len(unmeasured_here) > 5 else ""
            print(
                f"ERROR: 軸『{label}』の上位に telop 未計測の投稿が "
                f"{len(unmeasured_here)}/{len(top_ids_with_signal)} 件あります。\n"
                "  このまま分類すると『見せ方が無い』＝0% として資料に流れます。\n"
                f"  未計測: {sample}{more}\n"
                f"  対応1: import_agent_telop.py --run-dir {run_dir} --manifest telop.json で取り込む\n"
                "  対応2: テロップ抜きで分類してよい場合のみ --allow-unmeasured-telop\n"
                "          （その場合、資料には該当分類を『未計測（0%ではない）』と明記すること）",
                file=sys.stderr,
            )
            raise SystemExit(2)
        def classify_group(ids_with_signal):
            out = []
            for rank, vid in ids_with_signal:
                c = classify_video(videos[vid], signals[vid],
                                   measurement_audits_by_video.get(vid, {}),
                                   axis_product_terms)
                c = apply_visual_review(c, visual_reviews.get(vid))
                c["rank"] = rank
                out.append(c)
            return out

        classifications = classify_group(top_ids_with_signal)

        # 下位群（--bottom-n 指定時のみ）。上位と同じ関数で分類するので
        # 共通率の意味が揃う。信号が無い分は静かに繰り上げず件数で報告する。
        bottom_classifications, bottom_skipped = [], []
        bottom_ids_arg = ({x.strip() for x in args.bottom_ids.split(",") if x.strip()}
                          if args.bottom_ids else None)
        if bottom_ids_arg or args.bottom_n:
            if bottom_ids_arg:
                # 明示指定。順位の末尾ではなく、鮮度を揃えた下位を渡せる。
                true_bottom = [(r, v) for r, v in ranked if v in bottom_ids_arg]
            else:
                true_bottom = ranked[-args.bottom_n:]
            # 上位と重複する投稿は下位群から外す（母数の二重計上を防ぐ）
            top_vids = {v for _r, v in true_top_n}
            true_bottom = [(r, v) for r, v in true_bottom if v not in top_vids]
            bottom_ids_with_signal = [(r, v) for r, v in true_bottom if v in signals]
            bottom_skipped = [(r, v) for r, v in true_bottom if v not in signals]
            bottom_classifications = classify_group(bottom_ids_with_signal)

        axes_out.append({
            "role": role,
            "label": label,
            "source_file": source_file,
            "requested_top_n": args.top_n,
            "classified_count": len(classifications),
            "skipped_rank_no_signal_yet": [{"rank": r, "video_id": v} for r, v in skipped_no_signal],
            "telop_measured_count": sum(1 for _r, v in top_ids_with_signal
                                        if signals[v].get("telop_measured", False)),
            "telop_unmeasured_count": len(unmeasured_here),
            "telop_status": "measured" if not unmeasured_here else "partial",
            "common_rates": aggregate_common_rates(classifications),
            "video_classifications": classifications,
            # 以下は --bottom-n 指定時のみ実体が入る（既存キーには影響しない）
            "requested_bottom_n": args.bottom_n,
            "bottom_classified_count": len(bottom_classifications),
            "bottom_skipped_rank_no_signal_yet": [
                {"rank": r, "video_id": v} for r, v in bottom_skipped],
            "bottom_common_rates": (aggregate_common_rates(bottom_classifications)
                                    if bottom_classifications else None),
            "bottom_video_classifications": bottom_classifications,
            "rank_up_deltas_by_media": (
                rank_up_deltas_by_media(classifications, bottom_classifications)
                if bottom_classifications else []),
        })

    # cross-axis comparison: self vs each competitor, on common_rate_pct per category
    self_axis = next((a for a in axes_out if a["role"] == "self"), None)
    comparison = []
    if self_axis:
        for a in axes_out:
            if a["role"] != "competitor":
                continue
            diffs = []
            for key, label in CATEGORY_KEYS:
                self_info = self_axis["common_rates"][key]
                comp_info = a["common_rates"][key]
                self_rate = self_info.get("common_rate_pct")
                comp_rate = comp_info.get("common_rate_pct")
                if self_rate is None or comp_rate is None:
                    continue
                diffs.append({
                    "category": label,
                    "self_common_rate_pct": self_rate,
                    "competitor_common_rate_pct": comp_rate,
                    "gap_pct": round(comp_rate - self_rate, 1),
                    # 資料側で「11.1pt差」が実は9本中1本の差だと分かるように、
                    # 母数（present件数／対象件数）も一緒に持たせる。
                    "self_n": self_info.get("present_count"),
                    "self_total": self_info.get("applicable_count"),
                    "competitor_n": comp_info.get("present_count"),
                    "competitor_total": comp_info.get("applicable_count"),
                })
            diffs.sort(key=lambda d: d["gap_pct"], reverse=True)
            comparison.append({"competitor_label": a["label"], "category_gaps": diffs})

    # どの signals から作った出力かを残す。これが無いと、古い出力が新しい出力と
    # 同じ資料に混ざっても誰も気づけない。
    _fp = {"signal_ids": sorted(signals.keys()), "signal_count": len(signals)}
    out = {
        "inputs_fingerprint": _fp,
        "note": "本結果は「検索上位群で多く確認された演出パターン」に基づく仮説であり、"
                "再生数を高めた原因の証明ではありません。",
        "top_n": args.top_n,
        "visual_reviewed_video_count": sum(
            1 for axis in axes_out for video in axis["video_classifications"]
            if video.get("visual_review_status") == "reviewed"
        ),
        "axes": axes_out,
        "self_vs_competitor_gaps": comparison,
        "bottom_n": args.bottom_n,
        # 媒体種別ごとの上位下位差分。動画と写真を混ぜないのが要点。
        "rank_up_deltas": [
            {"axis_label": a["label"], "strata": a["rank_up_deltas_by_media"]}
            for a in axes_out if a.get("rank_up_deltas_by_media")
        ],
    }

    out_dir = run_dir / "measurement"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "rank_patterns_output.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(out["note"])
    for a in axes_out:
        print(f"\n[{a['role']}] {a['label']} (上位{a['classified_count']}本を分類, "
              f"未処理でスキップ{len(a['skipped_rank_no_signal_yet'])}件)")
        for key, label in CATEGORY_KEYS:
            cr = a["common_rates"][key]
            rate_str = f"{cr['common_rate_pct']}%" if cr.get("common_rate_pct") is not None else "N/A"
            print(f"    {label}: 共通率={rate_str}")
    print(f"\n詳細: {out_path}")


if __name__ == "__main__":
    main()
