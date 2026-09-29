#!/usr/bin/env python3
"""Measure keyword communication frequency by surface and by unique event.

The script reports two complementary quantities:

* surface mentions: caption + OCR telop + ASR speech occurrences.  If a word is
  shown and spoken at the same time, both surfaces count because the viewer is
  exposed through two channels.
* unique events: caption occurrences plus one-to-one merged OCR/ASR occurrences.
  A simultaneous telop and speech occurrence counts once.  This is the primary
  value used for "1本あたり平均登場回数".

Every occurrence is retained in ``video_level_audit`` with its variant, text
offset and timestamp.  This makes repeated words in one caption/ASR segment
countable and allows an independent verifier to reconstruct every number.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import read_jsonl, normalize_text  # noqa: E402

DEFAULT_MERGE_WINDOW = 1.0


def stable_sha256(value):
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_signals(signals_dir: Path):
    out = {}
    if not signals_dir.exists():
        return out
    for fp in signals_dir.glob("*.json"):
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("status") == "ok" and data.get("video_id"):
            out[data["video_id"]] = data
    return out


def keyword_variants_from_config(cfg):
    variants = [cfg.get("keyword"), *(cfg.get("keyword_variants") or [])]
    seen = set()
    result = []
    for value in variants:
        normalized = normalize_text(value or "", kana_fold=True)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append({"display": value, "normalized": normalized})
    return result


def _latin_alnum(ch):
    return bool(ch and re.match(r"[a-z0-9]", ch, flags=re.I))


def occurrence_candidates(text, variants):
    """Return longest-first, non-overlapping keyword occurrences.

    Offsets refer to normalized matching text.  This is intentional: NFKC and
    OCR whitespace repair can change source offsets, while normalized offsets
    remain deterministic for audit and verification.
    """
    normalized = normalize_text(text or "", kana_fold=True)
    candidates = []
    for variant in variants:
        term = variant["normalized"]
        start = 0
        while term and start < len(normalized):
            idx = normalized.find(term, start)
            if idx < 0:
                break
            end = idx + len(term)
            before = normalized[idx - 1] if idx else ""
            after = normalized[end] if end < len(normalized) else ""
            if not _latin_alnum(before) and not _latin_alnum(after):
                candidates.append({
                    "match_start": idx,
                    "match_end": end,
                    "matched_variant": variant["display"],
                    "normalized_variant": term,
                })
            start = idx + 1

    # Prefer the longest variant when configured variants overlap, then choose
    # a left-to-right non-overlapping set.  Repeated non-overlapping words are
    # all retained.
    candidates.sort(key=lambda x: (x["match_start"], -(x["match_end"] - x["match_start"])))
    selected = []
    occupied_until = -1
    for item in candidates:
        if item["match_start"] >= occupied_until:
            selected.append(item)
            occupied_until = item["match_end"]
    return normalized, selected


_HASHTAG_RE = re.compile(r"[#＃]([\w一-龠々〆ヵヶぁ-んァ-ヶー]+)")


def find_caption_occurrences(caption, hashtags, variants):
    """Count caption prose and hashtags without exporter duplication.

    An export tool may expose the same hashtag both inside the caption cell and in a
    separate hashtags column.  Hashtags present in both places are counted
    once, while a prose mention plus a hashtag remains two visible placements.
    """
    caption = caption or ""
    caption_tags = _HASHTAG_RE.findall(caption)
    caption_without_tags = _HASHTAG_RE.sub(" ", caption)
    prose_norm, prose_hits = occurrence_candidates(caption_without_tags, variants)

    tag_records = []
    caption_tag_keys = set()
    seen_external_keys = set()
    tagged_inputs = [*(('caption_hashtag', t) for t in caption_tags),
                     *(('hashtags_column', t) for t in (hashtags or []))]
    for origin, raw_tag in tagged_inputs:
        raw_tag = re.sub(r"^[#＃]+", "", str(raw_tag or "")).strip()
        tag_norm, hits = occurrence_candidates(raw_tag, variants)
        for hit in hits:
            dedup_key = (tag_norm, hit["match_start"], hit["match_end"])
            if origin == "caption_hashtag":
                caption_tag_keys.add(dedup_key)
            else:
                # Skip only exporter duplication: the same visible hashtag
                # already found in the caption.  Repeated tags typed twice in
                # the caption itself remain two visible occurrences.
                if dedup_key in caption_tag_keys or dedup_key in seen_external_keys:
                    continue
                seen_external_keys.add(dedup_key)
            tag_records.append({
                **hit,
                "source": "caption",
                "caption_component": "hashtag",
                "hashtag_origin": origin,
                "text": raw_tag,
                "normalized_text": tag_norm,
            })

    prose_records = [{
        **hit,
        "mention_id": f"caption:{index}",
        "source": "caption",
        "caption_component": "prose",
        "text": caption_without_tags,
        "normalized_text": prose_norm,
    } for index, hit in enumerate(prose_hits)]
    for index, record in enumerate(tag_records):
        record["mention_id"] = f"hashtag:{index}"
        record["source"] = "hashtag"
    return {"caption": prose_records, "hashtag": tag_records}


def find_timed_occurrences(spans, variants, source):
    hits = []
    for span_index, span in enumerate(spans or []):
        normalized, occurrences = occurrence_candidates(span.get("text", ""), variants)
        word_bounds = []
        if source == "asr" and span.get("words"):
            pieces = []
            cursor = 0
            for word in span.get("words", []):
                piece = normalize_text(word.get("text", ""), kana_fold=True).replace(" ", "")
                if not piece:
                    continue
                pieces.append(piece)
                word_bounds.append({
                    "char_start": cursor, "char_end": cursor + len(piece),
                    "start": word.get("start"), "end": word.get("end"),
                    "probability": word.get("probability"),
                })
                cursor += len(piece)
            word_text = "".join(pieces)
            word_normalized, word_occurrences = occurrence_candidates(word_text, variants)
            if word_occurrences:
                normalized, occurrences = word_normalized, word_occurrences
        for occurrence_index, occurrence in enumerate(occurrences):
            occurrence_start = span.get("start")
            occurrence_end = span.get("end")
            occurrence_confidence = span.get("confidence", span.get("avg_confidence", span.get("avg_logprob")))
            time_quality = span.get("time_quality", "span_estimate")
            overlapping_words = [
                word for word in word_bounds
                if word["char_end"] > occurrence["match_start"] and word["char_start"] < occurrence["match_end"]
            ]
            if overlapping_words:
                occurrence_start = overlapping_words[0].get("start")
                occurrence_end = overlapping_words[-1].get("end")
                probabilities = [word.get("probability") for word in overlapping_words if word.get("probability") is not None]
                occurrence_confidence = sum(probabilities) / len(probabilities) if probabilities else occurrence_confidence
                time_quality = "word_timestamp"
            hits.append({
                **occurrence,
                "mention_id": f"{source}:{span_index}:{occurrence_index}",
                "source": source,
                "span_index": span_index,
                "occurrence_index": occurrence_index,
                "start": occurrence_start,
                "end": occurrence_end,
                "text": span.get("text", ""),
                "normalized_text": normalized,
                "confidence": occurrence_confidence,
                "time_quality": time_quality,
                "source_provenance": span.get("source_provenance"),
            })
    return hits


def interval_distance(left, right):
    """Distance between two timed intervals; overlapping intervals are 0."""
    try:
        ls, le = float(left["start"]), float(left.get("end", left["start"]))
        rs, re_ = float(right["start"]), float(right.get("end", right["start"]))
    except (TypeError, ValueError):
        return None
    if le < ls:
        le = ls
    if re_ < rs:
        re_ = rs
    if le < rs:
        return rs - le
    if re_ < ls:
        return ls - re_
    return 0.0


def merge_timed_occurrences(ocr_hits, asr_hits, merge_window):
    """Pair OCR and ASR occurrences one-to-one when their intervals align.

    Two occurrences from the same surface are never collapsed.  This avoids
    turning "ヒアルロン酸、ヒアルロン酸" in one ASR segment into one count.
    """
    candidates = []
    for oi, ocr in enumerate(ocr_hits):
        for ai, asr in enumerate(asr_hits):
            distance = interval_distance(ocr, asr)
            if distance is not None and distance <= merge_window:
                candidates.append((distance, oi, ai))
    candidates.sort(key=lambda x: (x[0], x[1], x[2]))

    matched_ocr = set()
    matched_asr = set()
    groups = []
    for distance, oi, ai in candidates:
        if oi in matched_ocr or ai in matched_asr:
            continue
        matched_ocr.add(oi)
        matched_asr.add(ai)
        members = [ocr_hits[oi], asr_hits[ai]]
        groups.append({
            "event_id": f"timed:{len(groups) + 1}",
            "event_start": min(float(m["start"]) for m in members if m.get("start") is not None),
            "event_end": max(float(m.get("end", m["start"])) for m in members if m.get("start") is not None),
            "merge_distance_seconds": round(distance, 3),
            "raw_hits": members,
        })

    for oi, hit in enumerate(ocr_hits):
        if oi not in matched_ocr:
            groups.append({
                "event_id": "pending",
                "event_start": hit.get("start"),
                "event_end": hit.get("end"),
                "merge_distance_seconds": None,
                "raw_hits": [hit],
            })
    for ai, hit in enumerate(asr_hits):
        if ai not in matched_asr:
            groups.append({
                "event_id": "pending",
                "event_start": hit.get("start"),
                "event_end": hit.get("end"),
                "merge_distance_seconds": None,
                "raw_hits": [hit],
            })

    groups.sort(key=lambda g: (float(g["event_start"] or 0), g["raw_hits"][0]["source"]))
    for index, group in enumerate(groups, 1):
        group["event_id"] = f"timed:{index}"
    return groups


def telop_is_measured(signal):
    """テロップが実際に計測済みかどうか。

    機械OCR廃止後、telop は import_agent_telop.py で取り込むまで存在しない。
    フラグ自体が無い signals（旧版が出力したもの）は、計測済みか判別できないため
    **未計測側に倒す**。0件として静かに集計するより、止まって気付くほうが安全。
    """
    return bool(signal.get("telop_measured", False))


def measure_video(video_record, signal, variants, merge_window):
    metadata_hits = find_caption_occurrences(
        video_record.get("caption", ""), video_record.get("hashtags", []), variants)
    # 未計測の投稿は telop を「0件」ではなく「無し」として扱う。
    # ここで空を渡すのは、下流の件数が 0 になるのを承知のうえで
    # audit に telop_measured=False を残し、資料側で未計測と書けるようにするため。
    telop_measured = telop_is_measured(signal)
    ocr_spans = signal.get("ocr_spans", []) if telop_measured else []
    ocr_hits = find_timed_occurrences(ocr_spans, variants, "ocr")
    # 写真投稿の音声は BGM のみで投稿者の発話が無いため、音声経路は「対象外」。
    # 分母に入れると音声到達率が実態より低く出る。歌詞を発話として拾う誤計上も防ぐ。
    # 3値：not_applicable（音声なし）／unmeasured（ASR未完了）／measured
    voice_channel = signal.get("voice_channel")
    voice_applicable = voice_channel != "not_applicable"
    voice_measured = voice_channel == "measured"
    asr_hits = find_timed_occurrences(signal.get("asr_segments", []), variants, "asr") if voice_applicable else []
    timed_events = merge_timed_occurrences(ocr_hits, asr_hits, merge_window)

    channel_counts = {
        "caption": len(metadata_hits["caption"]),
        "hashtag": len(metadata_hits["hashtag"]),
        "ocr": len(ocr_hits),
        "asr": len(asr_hits),
    }
    surface_total = sum(channel_counts.values())
    unique_event_total = channel_counts["caption"] + channel_counts["hashtag"] + len(timed_events)
    audit = {
        "video_id": video_record["video_id"],
        "channel_occurrences": {
            "caption": metadata_hits["caption"],
            "hashtag": metadata_hits["hashtag"],
            "ocr": ocr_hits,
            "asr": asr_hits,
        },
        "channel_counts": channel_counts,
        # telop は機械OCR廃止後、import_agent_telop.py で取り込むまで存在しない。
        # channel_counts["ocr"] が 0 でも「0件」とは限らないため、状態を別に持つ。
        "telop_measured": telop_measured,
        "telop_status": "measured" if telop_measured else "unmeasured",
        # 音声経路の状態。not_applicable は「0件」ではなく「構造的に存在しない」。
        # 「音声トラックがある」だけで measured にすると、ASR が失敗しても
        # 0件として資料に流れる。未計測を独立した状態として残す
        "voice_status": ("not_applicable" if not voice_applicable
                         else ("measured" if voice_measured else "unmeasured")),
        "voice_status_reason": (signal.get("voice_channel_reason")
                                if not voice_measured else None),
        "surface_total": surface_total,
        "timed_mention_groups": timed_events,
        "unique_event_total": unique_event_total,
        # Backward-compatible alias used by existing deck code.
        "mention_count": unique_event_total,
        "input_sha256": stable_sha256({
            "caption": video_record.get("caption", ""),
            "hashtags": video_record.get("hashtags", []),
            "ocr_spans": signal.get("ocr_spans", []),
            "asr_segments": signal.get("asr_segments", []),
        }),
    }
    return audit


def compute_axis_metrics(video_ids, audits_by_video, valid_ids):
    pool = list(dict.fromkeys(vid for vid in video_ids if vid in valid_ids))
    denominator = len(pool)
    if denominator == 0:
        return None

    def route_status(vid, channel):
        audit = audits_by_video.get(vid, {})
        if channel == "asr":
            return audit.get("voice_status")
        if channel == "ocr":
            return audit.get("telop_status")
        return "measured"

    channels = {}
    for channel in ("caption", "hashtag", "ocr", "asr"):
        # 経路ごとに分母を持つ。3状態原則をここで実際に適用する:
        #   measured       → 分子・分母に入れる
        #   unmeasured     → 分母に入れない（0件にしない）。excluded_unmeasured に数える
        #   not_applicable → 分母から外す。excluded_not_applicable に数える
        # 音声は写真投稿（BGMのみ）が not_applicable、ASR未完了が unmeasured。
        # テロップは import_agent_telop で取り込むまで unmeasured。旧実装は OCR 経路の
        # 分母に未計測の投稿をそのまま入れ、全件未計測でも「テロップ登場率 0.0%」を出していた。
        statuses = {vid: route_status(vid, channel) for vid in pool}
        ch_pool = [vid for vid in pool if statuses[vid] == "measured"]
        excluded_na = sum(1 for vid in pool if statuses[vid] == "not_applicable")
        excluded_um = len(pool) - len(ch_pool) - excluded_na
        ch_den = len(ch_pool)
        counts = [audits_by_video.get(vid, {}).get("channel_counts", {}).get(channel, 0)
                  for vid in ch_pool]
        videos_with = sum(1 for count in counts if count > 0)
        total = sum(counts)
        channels[channel] = {
            "valid_videos": ch_den,
            # 「構造的に存在しない」だけを数える（資料側はこれを『対象外』と印字する）。
            "excluded_not_applicable": excluded_na,
            # 「まだ計測していない」。対象外と混ぜると『音声が無い』と誤読される。
            "excluded_unmeasured": excluded_um,
            "videos_with_keyword": videos_with,
            "appearance_rate_pct": round(videos_with / ch_den * 100, 1) if ch_den else None,
            "total_mentions": total,
            "avg_mentions_per_video": round(total / ch_den, 2) if ch_den else None,
        }

    surface_counts = [audits_by_video.get(vid, {}).get("surface_total", 0) for vid in pool]
    unique_counts = [audits_by_video.get(vid, {}).get("unique_event_total", 0) for vid in pool]
    videos_with_keyword = sum(1 for count in unique_counts if count > 0)
    surface_total = sum(surface_counts)
    unique_total = sum(unique_counts)
    # 統合の登場率・平均回数は4経路の合算。テロップ／音声が未計測の投稿は
    # その経路のぶんを数えていないので、ここの値は「下限値」になる。黙って確定値に見せない。
    unmeasured_routes = {
        "ocr": channels["ocr"]["excluded_unmeasured"],
        "asr": channels["asr"]["excluded_unmeasured"],
    }
    return {
        "valid_videos": denominator,
        "videos_with_keyword": videos_with_keyword,
        "appearance_rate_pct": round(videos_with_keyword / denominator * 100, 1),
        "total_mentions": unique_total,
        "avg_mentions_per_video": round(unique_total / denominator, 2),
        "surface_total_mentions": surface_total,
        "avg_surface_mentions_per_video": round(surface_total / denominator, 2),
        "unmeasured_route_videos": unmeasured_routes,
        "is_lower_bound": any(unmeasured_routes.values()),
        "channels": channels,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--confirmed-config", required=True)
    parser.add_argument("--merge-window-seconds", type=float, default=DEFAULT_MERGE_WINDOW)
    parser.add_argument(
        "--allow-unmeasured-telop", action="store_true",
        help="telop 未計測の投稿があっても集計する（telop からは除外し、警告を出す）")
    args = parser.parse_args()

    run_dir = Path(args.run_dir)
    cfg = json.loads(Path(args.confirmed_config).read_text(encoding="utf-8"))
    variants = keyword_variants_from_config(cfg)
    if not variants:
        print("ERROR: no keyword configured", file=sys.stderr)
        raise SystemExit(1)

    videos = {v["video_id"]: v for v in read_jsonl(run_dir / "normalized" / "videos.jsonl")}
    signals = load_signals(run_dir / "signals")
    processed_ids = set(signals)
    relevant_ids = {
        vid for vid, signal in signals.items()
        if signal.get("relevance_final") in ("relevant", "uncertain")
    }

    # ── telop 未計測ガード ───────────────────────────────────
    # 機械OCRを廃止したため、telop は import_agent_telop.py で取り込むまで空。
    # 取り込み前に集計すると telop の登場回数が「0件」として資料へ流れ、
    # 客先資料の数字が事実と食い違う。既定では止める。
    measurable_ids = [vid for vid in sorted(processed_ids) if vid in videos]
    unmeasured_ids = [vid for vid in measurable_ids if not telop_is_measured(signals[vid])]
    if unmeasured_ids and not args.allow_unmeasured_telop:
        sample = ", ".join(unmeasured_ids[:5])
        more = f" ほか{len(unmeasured_ids) - 5}件" if len(unmeasured_ids) > 5 else ""
        print(
            "ERROR: telop が未計測の投稿が "
            f"{len(unmeasured_ids)}/{len(measurable_ids)} 件あります。このまま集計すると "
            "telop の登場回数が 0 件として資料に流れます。\n"
            f"  未計測: {sample}{more}\n"
            "  対応1: 抽出フレームを読み、import_agent_telop.py で取り込んでから再実行する\n"
            f"          python import_agent_telop.py --run-dir {run_dir} --manifest {run_dir}/telop.json\n"
            "  対応2: telop 抜きで集計してよい場合のみ --allow-unmeasured-telop を付ける\n"
            "          （その場合、資料には telop を『未計測（0件ではない）』と明記すること）",
            file=sys.stderr,
        )
        raise SystemExit(2)
    if unmeasured_ids:
        print(
            f"WARNING: --allow-unmeasured-telop により、telop 未計測 {len(unmeasured_ids)}/"
            f"{len(measurable_ids)} 件をテロップ経路（ocr）の分母から除外しました"
            "（channels.ocr.excluded_unmeasured）。統合の登場率・平均回数はテロップ未計測分を"
            "含まない下限値です（overall.is_lower_bound）。"
            "資料には『未計測（0件ではない）』と明記してください。",
            file=sys.stderr,
        )

    audits = []
    audits_by_video = {}
    for vid in sorted(processed_ids):
        if vid not in videos:
            continue
        audit = measure_video(videos[vid], signals[vid], variants, args.merge_window_seconds)
        audits.append(audit)
        audits_by_video[vid] = audit

    axes = []
    for file_cfg in cfg["files"]:
        source_file = Path(file_cfg["path"]).name
        member_ids = [
            vid for vid, video in videos.items()
            if any(a.get("source_file") == source_file for a in video.get("source_appearances", []))
        ]
        # 広告（pr）群の定義は「#PR 表記（caption・hashtags・取り込み済みテロップ）」または
        # 「TikTok 側の広告フラグ（isAd）」（2026-09-03 決定。SKILL.md・tiktok-deck と同じ）。
        # #PR だけで割ると、同じ資料に別定義の PR 比率が併存する。内訳は pr_breakdown に残す。
        def pr_tag(vid):
            return signals[vid].get("pr_status_final", videos[vid].get("pr_status_prelim")) == "pr"

        def platform_ad(vid):
            return videos[vid].get("is_ad_platform_flag") is True

        processed_members = [vid for vid in member_ids if vid in signals]
        pr_ids = [vid for vid in processed_members if pr_tag(vid) or platform_ad(vid)]
        no_pr_ids = [vid for vid in processed_members if not (pr_tag(vid) or platform_ad(vid))]
        pr_breakdown = {
            "pr_tag_only": sum(1 for vid in processed_members if pr_tag(vid) and not platform_ad(vid)),
            "platform_ad_flag_only": sum(1 for vid in processed_members
                                         if platform_ad(vid) and not pr_tag(vid)),
            "both": sum(1 for vid in processed_members if pr_tag(vid) and platform_ad(vid)),
        }
        axes.append({
            "role": file_cfg["role"],
            "label": file_cfg["label"],
            "source_file": source_file,
            # search.mjs が「API応答はあるが該当0件（TIKTOK_TRULY_EMPTY）」と診断した軸。
            # 取得失敗ではなく計測した0件（build_dataset が confirmed_config に記録）。
            "zero_result": bool(file_cfg.get("zero_result")),
            "total_videos_in_file": len(set(member_ids)),
            "processed_videos_in_file": len(set(member_ids) & processed_ids),
            "overall": compute_axis_metrics(member_ids, audits_by_video, relevant_ids),
            "pr": compute_axis_metrics(pr_ids, audits_by_video, relevant_ids),
            "no_pr": compute_axis_metrics(no_pr_ids, audits_by_video, relevant_ids),
            "pr_breakdown": pr_breakdown,
        })

    total_normalized = len(videos)
    total_processed = len(processed_ids)
    telop_done = len(measurable_ids) - len(unmeasured_ids)
    if total_processed == 0:
        coverage_note = (
            f"媒体解析（フレーム抽出・音声抽出）が1件も完了していません"
            f"（対象 {total_normalized} 件）。ここに出る数値は計測値ではなく未計測です。"
        )
    else:
        coverage_note = (
            f"{total_processed} / {total_normalized} 件で媒体解析（フレーム抽出・音声抽出）が完了しています。"
            "指標は処理済みかつ関連/要確認の動画を分母にしています。"
        )
    # telop は機械OCR廃止後、取り込み済みの投稿だけが計測対象。
    # 「OCR完了」と書くと未計測分を 0 と読まれるため、実数で明示する。
    # 写真投稿はBGMのみで発話が無いため音声の分母から外す（計算上の除外は維持する）。
    # ただし「対象外」の注記は資料に不要との判断のため、coverage_note には足さない。
    # 除外実数は audit の voice_status と channels.asr.excluded_not_applicable に機械可読で残す。
    # 一方「未計測（ASR未完了・faster-whisper 未導入）」は0件と区別して必ず開示する。
    voice_unmeasured = [vid for vid in measurable_ids
                        if audits_by_video.get(vid, {}).get("voice_status") == "unmeasured"]
    if unmeasured_ids:
        coverage_note += (
            f" テロップは {telop_done} / {len(measurable_ids)} 件のみ計測済みで、"
            f"残り {len(unmeasured_ids)} 件は未計測（0件ではない）です。"
            "テロップ経路の率は計測済みの投稿だけを分母にし、"
            "統合の登場率・平均回数はテロップ未計測分を含まない下限値です。"
        )
    else:
        # 「件」で全件と書くと、1枚だけ読んだ投稿も計測済みに見える。
        # 実際に読んだ枚数を出す（未読フレームは0ではなく未計測）。
        read = sum((signals[v].get("telop_frames_read") or 0) for v in measurable_ids)
        tot = sum((signals[v].get("telop_frames_total") or 0) for v in measurable_ids)
        # 枚数を全動画で合算すると、枚数を持たない動画が混ざったとき
        # read < tot が成立せず「すべて計測済み」に落ちる。
        # 1本でも枚数不明があれば、それは「全部読んだ」とは言えない
        unknown_frames = [v for v in measurable_ids
                          if not signals[v].get("telop_frames_total")]
        if unknown_frames:
            coverage_note += (
                f" ただし {len(unknown_frames)} 件はテロップの総枚数が記録されておらず、"
                "読み切ったかどうか判断できません。全部読んだとは言えません。")
        if tot and read < tot:
            coverage_note += (
                f" テロップは {telop_done} / {len(measurable_ids)} 件で取り込み済みですが、"
                f"読み取ったのは {read} / {tot} 枚（{round(read / tot * 100, 1)}%）です。"
                "未読の枚は0件ではなく未計測として扱ってください。"
            )
        elif not measurable_ids or not telop_done or not tot:
            # 1件も・1枚も読んでいない状態が「すべて計測済み」に落ちていた。
            # 未計測が0件と読まれるだけでなく、「全部測った」という積極的な嘘になる
            coverage_note += (
                f" テロップは1件も計測していません"
                f"（対象 {len(measurable_ids)} 件／取り込み済み {telop_done} 件／読み取り {read} 枚）。"
                "0件ではなく未計測です。この資料でテロップの有無を語ることはできません。")
        else:
            coverage_note += (f" テロップは {telop_done} / {len(measurable_ids)} 件"
                              f"（{read} / {tot} 枚）すべて計測済みです。")
    if voice_unmeasured:
        coverage_note += (
            f" 音声は {len(voice_unmeasured)} 件が未計測（文字起こし未完了。0件ではない）のため"
            "音声経路の分母から外しています。統合の登場率・平均回数はその分を含まない下限値です。"
        )
    if total_processed < total_normalized:
        coverage_note += " 未処理動画は0回として扱わず、追加処理後に再集計します。"
    if 0 < total_processed < 30:
        coverage_note += " 処理件数が30件未満のため方向性確認用の暫定値です。"

    # どの signals から作った出力かを残す。これが無いと、古い出力が新しい出力と
    # 同じ資料に混ざっても誰も気づけない。
    _fp = {"signal_ids": sorted(signals.keys()), "signal_count": len(signals)}
    output = {
        "inputs_fingerprint": _fp,
        "metric_version": "2.0",
        "config_sha256": stable_sha256(cfg),
        "keyword": cfg.get("keyword"),
        "keyword_variants": [v["display"] for v in variants],
        "merge_window_seconds": args.merge_window_seconds,
        "primary_count_definition": "unique_event_total",
        # axes[].pr / no_pr の群分け定義。内訳は axes[].pr_breakdown。
        "pr_definition": "pr = #PR表記（caption・hashtags・取り込み済みテロップ）または TikTok の広告フラグ（isAd）",
        "coverage_note": coverage_note,
        "total_videos_normalized": total_normalized,
        "total_videos_processed": total_processed,
        "axes": axes,
        "video_level_audit": audits,
    }
    output_dir = run_dir / "measurement"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "measure_output.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")

    print(coverage_note)
    for axis in axes:
        overall = axis["overall"]
        if overall:
            print(
                f"  {axis['label']}: 登場率={overall['appearance_rate_pct']}% / "
                f"統合平均={overall['avg_mentions_per_video']}回/本 / "
                f"接点平均={overall['avg_surface_mentions_per_video']}回/本"
            )
        else:
            print(f"  {axis['label']}: N/A（有効動画0件）")
    print(f"詳細: {output_path}")


if __name__ == "__main__":
    main()
