#!/usr/bin/env python3
"""Describe what the market-keyword search results are actually about.

The default taxonomy separates cosmetic products from medical/aesthetic
services and everything else.  Projects can replace the rules through
``confirmed_config.json.market_category_rules`` without changing code.
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import normalize_text, read_jsonl  # noqa: E402

_HASHTAG_RE = re.compile(r"[#＃]([\w一-龠々〆ヵヶぁ-んァ-ヶー]+)")

# 案件の語彙が無いまま既定語彙を当てると、無関係な分類が資料に出る。
# 実測: コンビニの「クリームたっぷりダブルシュー」が「化粧品・スキンケア商品」に
# 分類され、資料に 35.7% と載った。既定語彙は化粧品案件専用のサンプルであり、
# 他業種に当てるものではない。
DEFAULT_RULES_ARE_SAMPLES_FOR = "化粧品・美容案件"
DEFAULT_RULES = [
    {
        "key": "cosmetics_product",
        "label": "化粧品・スキンケア商品",
        "terms": ["化粧水", "美容液", "クリーム", "乳液", "コスメ", "スキンケア", "保湿", "導入美容液", "パック", "セラム"],
    },
    {
        "key": "medical_aesthetic",
        "label": "医療・美容施術",
        "terms": ["美容医療", "クリニック", "医師", "注射", "注入", "施術", "整形", "フィラー", "ダーマ", "症例"],
    },
]


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def count_term(text, term):
    normalized_term = normalize_text(term, kana_fold=True)
    return normalize_text(text, kana_fold=True).count(normalized_term) if normalized_term else 0


def telop_available(signal):
    """テロップが取り込まれているか。分類の根拠範囲を出力に残すために使う。

    ここは「登場回数」ではなく話題分類なので、telop が無くても
    caption + hashtags で分類は成立する（0件を捏造しない）。
    ただし根拠が狭くなるため、どこまで見て分類したかを必ず記録する。
    """
    return bool(signal.get("telop_measured", False))


def usable_asr(signal):
    """分類に使える音声。写真投稿はBGMのみなので使わない。"""
    # 3値。未計測(unmeasured/pending)を空配列として渡すと「発話なし」と扱われる
    if (signal or {}).get("voice_channel") != "measured":
        return []
    return (signal or {}).get("asr_segments") or []


def combined_text(video, signal):
    # TikTok の desc（caption）にはタグ文字列（#スイーツ）がそのまま入っており、
    # hashtags 列にも同じタグがある。両方を連結すると同じタグを2回数え、タグ由来の分類に
    # 偏る（実測: 『コンビニ飯 #スイーツ』が同点ではなくスイーツ判定）。
    # measure_keywords.find_caption_occurrences と同じく、caption に既にあるタグは列側で足さない。
    caption = video.get("caption", "") or ""
    caption_tags = {normalize_text(t, kana_fold=True) for t in _HASHTAG_RE.findall(caption)}
    column_tags = []
    for tag in video.get("hashtags", []) or []:
        tag = re.sub(r"^[#＃]+", "", str(tag or "")).strip()
        key = normalize_text(tag, kana_fold=True)
        if tag and key not in caption_tags:
            caption_tags.add(key)
            column_tags.append(tag)
    fields = [caption, " ".join(column_tags)]
    fields.extend(span.get("text", "") for span in signal.get("ocr_spans", []) or [])
    fields.extend(span.get("text", "") for span in usable_asr(signal))
    return " ".join(fields)


def classify(text, rules):
    scores = {rule["key"]: sum(count_term(text, term) for term in rule.get("terms", [])) for rule in rules}
    best = max(scores.values(), default=0)
    winners = [key for key, score in scores.items() if score == best and score > 0]
    if len(winners) == 1:
        return winners[0], scores, "rule_match"
    if len(winners) > 1:
        return "mixed_or_uncertain", scores, "score_tie"
    return "other", scores, "no_rule_match"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--confirmed-config", required=True)
    parser.add_argument("--allow-default-rules", action="store_true",
                        help="案件語彙が未設定でもサンプル語彙（化粧品）で分類する。"
                             "他業種では誤分類するので通常は使わない")
    args = parser.parse_args()
    run_dir = Path(args.run_dir)
    cfg = json.loads(Path(args.confirmed_config).read_text(encoding="utf-8"))
    rules = cfg.get("market_category_rules")
    if not rules:
        if not args.allow_default_rules:
            fail("この案件の話題分類語彙が設定されていません。\n"
                 f"  既定語彙は{DEFAULT_RULES_ARE_SAMPLES_FOR}のサンプルで、他業種に当てると誤分類します"
                 "（実測: コンビニの『クリームたっぷりダブルシュー』が『化粧品・スキンケア商品』に分類された）。\n"
                 "  対応1: suggest_vocab.py --run-dir <run-dir> で候補を出し、確認して --apply する\n"
                 "  対応2: confirmed_config.json に market_category_rules を直接書く\n"
                 "  対応3: サンプル語彙で構わない場合のみ --allow-default-rules を付ける")
        rules = DEFAULT_RULES
    rule_labels = {rule["key"]: rule["label"] for rule in rules}
    rule_labels.update({"mixed_or_uncertain": "複数分野・要確認", "other": "その他"})

    videos = {v["video_id"]: v for v in read_jsonl(run_dir / "normalized" / "videos.jsonl")}
    signals = {}
    for path in (run_dir / "signals").glob("*.json") if (run_dir / "signals").exists() else []:
        try:
            signal = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if signal.get("status") == "ok" and signal.get("relevance_final") in ("relevant", "uncertain"):
            signals[signal["video_id"]] = signal

    axes = []
    for file_cfg in cfg.get("files", []):
        if file_cfg.get("role") != "market_keyword":
            continue
        source_file = Path(file_cfg["path"]).name
        members = []
        # 分母は「解析済み（signals あり）かつ関連/要確認」の投稿だけ。上位だけ取得した場合、
        # その構成比が検索面全体の話題構成のように読まれるため、軸の全件数と
        # 分類できなかった件数を必ず並べて出す。
        in_file = [video_id for video_id, video in videos.items()
                   if any(item.get("source_file") == source_file
                          for item in video.get("source_appearances", []))]
        for video_id, video in videos.items():
            if video_id not in signals:
                continue
            appearance = next((item for item in video.get("source_appearances", [])
                               if item.get("source_file") == source_file), None)
            if not appearance:
                continue
            category, scores, basis = classify(combined_text(video, signals[video_id]), rules)
            members.append({
                "video_id": video_id,
                "rank": appearance.get("rank"),
                "category": category,
                "category_label": rule_labels[category],
                "scores": scores,
                "basis": basis,
            })
        members.sort(key=lambda item: item.get("rank") or 10 ** 9)
        counts = Counter(item["category"] for item in members)
        denominator = len(members)
        composition = [
            {
                "category": key,
                "label": rule_labels[key],
                "count": count,
                "rate_pct": round(count / denominator * 100, 1) if denominator else None,
            }
            for key, count in counts.most_common()
        ]
        axes.append({
            "label": file_cfg.get("label"),
            "source_file": source_file,
            "total_videos_in_file": len(in_file),
            # 解析未完了・関連性で除外などで分類しなかった件数（0件の話題ではない）。
            "unclassified_videos": len(in_file) - denominator,
            "coverage_note": (
                f"この軸の {len(in_file)} 件中 {denominator} 件（解析済み・関連/要確認）の構成比。"
                + ("残りは未分類で、検索面全体の構成を表すものではない。"
                   if denominator < len(in_file) else "")),
            "valid_videos": denominator,
            "composition": composition,
            "video_classifications": members,
        })

    # 分類の根拠がどこまで揃っていたかを記録する。
    # telop 未取り込みなら caption + hashtag + ASR のみで分類しているため、
    # 「OCRも見て分類した」と書くと嘘になる。
    telop_n = sum(1 for sg in signals.values() if telop_available(sg))
    # 分類対象が1件も無いのに出力を書くと、build_deck が「章は出せる」と判断して
    # 「分類結果が空」のスライドが資料に流れる。空は成果物ではないので止める。
    total_classified = sum(ax.get("valid_videos") or 0 for ax in axes)
    if total_classified == 0:
        fail("分類できた動画が0件です。媒体解析（extract_signals.py）が済んでいない可能性があります。\n"
             f"  signals: {len(signals)} 件\n"
             "  先に `search.mjs --mode fetch --run-dir <run-dir>` と `extract_signals.py` を実行してください")
    basis = ["caption", "hashtag"]
    if telop_n:
        basis.append(f"telop({telop_n}/{len(signals)}件)")
    asr_used = sum(1 for sg in signals.values() if usable_asr(sg))
    if asr_used:
        # 写真投稿は対象外なので、何件で使ったかを併記する
        basis.append(f"ASR({asr_used}/{len(signals)}件・写真は対象外)")
    # どの signals から作った出力かを残す。これが無いと、古い出力が新しい出力と
    # 同じ資料に混ざっても誰も気づけない。
    _fp = {"signal_ids": sorted(signals.keys()), "signal_count": len(signals)}
    output = {
        "version": "1.0",
        "inputs_fingerprint": _fp,
        "classification_basis": " + ".join(basis) + " のルール一致",
        "telop_measured_count": telop_n,
        "telop_unmeasured_count": len(signals) - telop_n,
        "basis_note": (
            "テロップを1件も読み取っていない状態で分類している（caption + hashtag のみ）。"
            "根拠が狭いことに注意。" if telop_n == 0 else
            "テロップ未取り込みの投稿は caption + hashtag（+ASR）だけで分類している。"
            "分類が『無い』のではなく根拠が狭い状態であることに注意。"
            if len(signals) - telop_n else "全件でテロップまで見て分類している"
        ),
        "rules": rules,
        "axes": axes,
        "caveat": "分野分類は検索結果の構成把握用のAI補助分類。重要な判断では上位動画を目視確認する。",
    }
    output_dir = run_dir / "measurement"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "market_categories_output.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {output_path}")


if __name__ == "__main__":
    main()
