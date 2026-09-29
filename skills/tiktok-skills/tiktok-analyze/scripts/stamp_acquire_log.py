#!/usr/bin/env python3
"""取得台帳に媒体のフィンガープリント（SHA-256）を付ける。

`search.mjs --mode fetch` が書く acquire_log.jsonl には媒体のハッシュが無く、
下流（signals / rank_patterns / 検証）が読む `acquisition_sha256` が常に None に
なっていた。結果として「資料に載せた証拠画像が、記録された媒体と同一か」を
確かめる経路が丸ごと無効化されていた。

本スクリプトは acquire_log を読み、status=ok の各行に既存の正規形実装
（acquire_media.attach_acquisition_fingerprint）をそのまま適用して書き戻す。
ハッシュの作り方を2箇所に持たない（JS 側で再実装すると静かにズレる）。

    python3 stamp_acquire_log.py --run-dir <run-dir>
    python3 stamp_acquire_log.py --run-dir <run-dir> --check   # 付け直さず差分だけ見る

`build_dataset.py` の直後、**`extract_signals.py` より前**に実行する。

**順番を守る理由**: `extract_signals.py` は解析済みかどうかを
`acquisition_sha256` で判定する。解析の後にこのスクリプトを走らせると
指紋が None から実値に変わり、**解析済みの投稿がすべて未解析と判定されて
やり直しになる**（媒体を追加取得したときに実際に起きた）。
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from acquire_media import attach_acquisition_fingerprint  # noqa: E402


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def main():
    ap = argparse.ArgumentParser(description="取得台帳に媒体ハッシュを付ける")
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--check", action="store_true",
                    help="書き戻さず、付いていない件数と不一致だけを報告する")
    args = ap.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    log_path = run_dir / "media" / "acquire_log.jsonl"
    if not log_path.exists():
        fail(f"acquire_log.jsonl がありません: {log_path}\n"
             "  先に `search.mjs --mode fetch --run-dir <run-dir>` を実行してください")

    # 解析済みの signals があるのに未スタンプの台帳を後から書き換えると、
    # 完了判定（acquisition_sha256）が崩れて全件やり直しになる。先に知らせる。
    signals_dir = run_dir / "signals"
    n_signals = len([f for f in signals_dir.glob("*.json")
                     if f.stem.isdigit()]) if signals_dir.exists() else 0

    lines, stamped, already, skipped, changed, failed = [], 0, 0, 0, [], []
    for raw in log_path.read_text(encoding="utf-8").split("\n"):
        if not raw.strip():
            continue
        try:
            rec = json.loads(raw)
        except json.JSONDecodeError:
            # 壊れた行は黙って捨てない。そのまま残して件数に出す。
            lines.append(raw)
            failed.append("JSON として読めない行")
            continue
        if rec.get("status") != "ok":
            lines.append(json.dumps(rec, ensure_ascii=False))
            skipped += 1
            continue

        prev = rec.get("acquisition_sha256")
        updated = attach_acquisition_fingerprint(rec)
        if updated.get("status") != "ok":
            # 媒体ファイルが消えている等。取得できなかったことを残す。
            failed.append(f"{rec.get('video_id')}: {updated.get('error')}")
            lines.append(json.dumps(rec, ensure_ascii=False))
            continue
        now = updated.get("acquisition_sha256")
        if prev and prev != now:
            # 取得後に媒体が差し替わった＝資料の証拠と台帳が食い違う状態
            changed.append({"video_id": rec.get("video_id"), "before": prev, "after": now})
        if prev == now:
            already += 1
        else:
            stamped += 1
        lines.append(json.dumps(updated, ensure_ascii=False))

    if n_signals and stamped and not args.check:
        print(f"WARNING: 解析済みの signals が {n_signals} 件ある状態で、"
              f"未スタンプの取得 {stamped} 件にハッシュを付けました。\n"
              "  extract_signals.py の完了判定が変わるため、既存の解析がやり直しになります。\n"
              "  次回からは build_dataset.py の直後（extract_signals.py より前）に"
              "実行してください。", file=sys.stderr)

    if not args.check:
        log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    report = {
        "ok": not failed,
        "checked_only": args.check,
        "log": str(log_path),
        "newly_stamped": stamped,
        "already_stamped": already,
        "skipped_not_ok": skipped,
        # 台帳のハッシュと現物が食い違った件数。0 以外は要調査。
        "fingerprint_changed": changed,
        "errors": failed,
        "note": ("status=ok の取得だけにハッシュを付ける。"
                 "取得失敗は 0 件として扱わず skipped_not_ok に出す"),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failed:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
