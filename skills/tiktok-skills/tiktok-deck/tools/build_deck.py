#!/usr/bin/env python3
"""モジュールを選んで資料の中身を組み立てる（FMT）。

※ 今の位置づけ（2026-09）: tiktok-intake の gaps.py が「不足入力の検出」に呼ぶ道具。
  出力の deck_spec.json は PPTX の生成には使われない。資料にどの章が載るかの正本は
  src/generate.js の MODES と SKILL.md「ステータスと章」の表で、modules.json の章割り
  （例: 初訪に 2-1・3-3 が入る）とは一致しない。初訪は tools/build_first_visit.py で作る。
  章の有無をここで判断して資料を語らないこと。

従来は「初回版／詳細版／統合版」の固定3種しか出せなかった。
本スクリプトは modules.json のモジュール定義（①〜⑥ / 1-1〜6-3）を読み、
**必要な章だけ**を選んで資料仕様（deck_spec.json）を組み立てる。

    python3 build_deck.py --run-dir <run-dir> --status 初訪
    python3 build_deck.py --run-dir <run-dir> --status "初訪,競合差再提案"
    python3 build_deck.py --run-dir <run-dir> --modules 1-1,1-2,3-2
    python3 build_deck.py --list                      # モジュール一覧を表示

設計の要点:
  * ⑥透明性（6-1/6-2/6-3）は **常に自動付与**する。信頼担保なので外せない。
  * 各モジュールの必要入力を run-dir で実測し、**足りないものは章を落とさず
    `blocked` として残す**。黙って空の章を出さない。
  * 章順の指定がなければ ① 現状 → ⑤ 競合差 → ② 方向性 → ③ 実行案 → ④ 結果 の順。
  * ⑤ は社内で内容整理中のため `pending` フラグを立て、枠だけ用意する。
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

JST = timezone(timedelta(hours=9))
HERE = Path(__file__).resolve().parent


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def load_modules():
    p = HERE / "modules.json"
    if not p.exists():
        fail(f"modules.json が見つかりません: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def detect_inputs(run_dir: Path):
    """run-dir を実測して、どの入力が揃っているかを返す。推測しない。"""
    n = run_dir / "normalized"
    videos = n / "videos.jsonl"
    recs = []
    broken = 0
    if videos.exists():
        # splitlines() は U+2028/U+2029/U+0085 でも改行するため、
        # 本文にそれを含む投稿が複数行に割れ、断片が JSON エラーで消えていた。
        # 分割は "\n" のみ。壊れた行は黙って捨てず件数を残す。
        for line in videos.read_text(encoding="utf-8").split("\n"):
            if line.strip():
                try:
                    recs.append(json.loads(line))
                except json.JSONDecodeError:
                    broken += 1

    if broken:
        print(f"WARNING: videos.jsonl に読めない行が {broken} 行あります。"
              "件数が計測側とずれます。取得側の出力を確認してください。", file=sys.stderr)

    cfg_path = run_dir / "confirmed_config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}

    signals_dir = run_dir / "signals"
    signals, signals_skipped = [], []
    if signals_dir.exists():
        for fp in signals_dir.glob("*.json"):
            if fp.name.startswith("_"):
                continue
            try:
                sg = json.loads(fp.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            # status!=ok は「解析対象外」。未計測と混ぜると分母が食い違う
            # （tiktok-analyze は ok だけを数え、こちらが全件を数えていた）。
            if sg.get("status") == "ok":
                signals.append(sg)
            else:
                signals_skipped.append(sg)

    # [9] 取得台帳を読む。取得失敗が資料に一度も出ないのを止める。
    acq_ok, acq_failed, acq_failed_ids = 0, 0, []
    acq_log = run_dir / "media" / "acquire_log.jsonl"
    if acq_log.exists():
        for line in acq_log.read_text(encoding="utf-8").split("\n"):
            if not line.strip():
                continue
            try:
                a = json.loads(line)
            except json.JSONDecodeError:
                continue
            if a.get("status") == "ok":
                acq_ok += 1
            else:
                acq_failed += 1
                if a.get("video_id"):
                    acq_failed_ids.append(a["video_id"])

    roles = {a.get("role") for r in recs for a in (r.get("source_appearances") or [])}
    roles |= {r.get("role") for r in recs if r.get("role")}
    roles.discard(None)

    media_dir = run_dir / "media"
    media_files = list(media_dir.glob("*.mp4")) if media_dir.exists() else []
    media_dirs = [d for d in media_dir.iterdir() if d.is_dir()] if media_dir.exists() else []

    telop_measured = sum(1 for s in signals if s.get("telop_measured"))
    asr_present = sum(1 for s in signals if s.get("asr_segments"))

    avail = {
        "videos": bool(recs),
        # 1-1 が実際に描くのは _by_axis のグループなので、可否も同じ定義で測る。
        "axes": len(_by_axis(recs)) >= 2,
        # 3-5 / 4-3 が要求するのは「自社と競合の対」。市場KW×2では成立しない。
        "self_vs_competitor": ("self" in roles and "competitor" in roles),
        "official_tiktok_account": bool(cfg.get("official_tiktok_account")),
        "measurement": (run_dir / "measurement" / "measure_output.json").exists(),
        "telop": telop_measured > 0,
        "asr": asr_present > 0,
        "market_categories": any(run_dir.glob("**/market_categor*.json")),
        "rank_patterns": any(run_dir.glob("**/rank_pattern*.json")),
        "media": bool(media_files or media_dirs),
        # フレームは frames/<video_id>/f_*.jpg の階層に置かれる。
        # frames/*.jpg だけ見ていると常に「無い」判定になっていた。
        "frames": any((run_dir / "frames").glob("*/*.jpg")) if (run_dir / "frames").exists()
                  else any(run_dir.glob("**/frame_*.jpg")),
        "baseline": bool(cfg.get("baseline")) or (run_dir / "baseline").exists(),
    }

    stats = {
        "videos": len(recs),
        "video_posts": sum(1 for r in recs if r.get("media_type") != "photo"),
        "photo_posts": sum(1 for r in recs if r.get("media_type") == "photo"),
        "roles": sorted(roles),
        # 表紙に出すのは役割名（self/competitor）ではなく実際の検索軸名。
        # 内部の識別子を客先資料に出さない。
        "axis_labels": [f.get("label") for f in (cfg.get("files") or []) if f.get("label")],
        "signals": len(signals),
        "signal_ids": [g.get("video_id") for g in signals],
        # 解析対象外（尺超過など）は未計測と別枠。混ぜると分母が食い違う。
        "signals_skipped": len(signals_skipped),
        "signals_skipped_ids": [g.get("video_id") for g in signals_skipped],
        "telop_measured": telop_measured,
        "telop_unmeasured": len(signals) - telop_measured,
        "acquired_ok": acq_ok,
        "acquired_failed": acq_failed,
        "acquired_failed_ids": acq_failed_ids,
        "asr_present": asr_present,
        "media_video_files": len(media_files),
        "media_photo_dirs": len(media_dirs),
        "keyword": cfg.get("keyword"),
        "brand": cfg.get("brand"),
        "provenance": (cfg.get("dataset_provenance") or {}).get("method"),
    }
    return avail, stats, cfg, recs


# ============================================================================
# モジュールの中身を実データから計算する
# ----------------------------------------------------------------------------
# videos.jsonl だけで出せるモジュールは、ここで実数まで計算する。
# 外部スクリプト（measure_keywords 等）が必要なものは compute しない＝blocked のまま。
# ============================================================================

def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return 0
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


# 企業公式アカウントを示す語。
# ラテン文字の語は **部分一致にしない**。"skincare" が "inc" を含むため、
# 個人アカウントが企業公式に化ける（実測で3名が誤判定された）。
_ORG_WORDS_LATIN = ("official", "inc", "corp", "corporation", "company",
                    "ltd", "co", "japan", "jp")
# 日本語は語境界が無いので部分一致で判定する（誤検出しにくい語だけに絞る）
_ORG_WORDS_JA = ("公式", "株式会社", "有限会社", "合同会社")
# 個人の発信者を示す語（プロフィール文に多い）
_PERSON_MARKERS = ("歳", "才", "主婦", "ol", "会社員", "ママ", "美容好き", "コスメ好き",
                   "垢抜け", "紹介", "レビュー", "案件", "pr依頼", "dm", "お仕事")


def classify_creator(rec, cfg):
    """投稿者を 企業公式 / インフルエンサー / 一般人(UGC) に分ける。

    TikTok 側に「インフルエンサー」という定義は存在しないので、
    観測できる材料（公式アカウント一致・ハンドル/表示名/プロフィール文の語・
    認証バッジ・フォロワー数）から推定する。**推定であることを必ず併記する。**
    """
    handle = (rec.get("creator_id") or "").lower()
    name = (rec.get("creator_name") or "").lower()
    bio = (rec.get("creator_signature") or "").lower()
    fol = rec.get("follower_count") or 0
    verified = bool(rec.get("creator_verified"))

    # ① 確定: confirmed_config の公式アカウントと一致
    official = (cfg.get("official_tiktok_account") or "").lower()
    official_handle = official.rstrip("/").split("/")[-1].lstrip("@") if official else ""
    if official_handle and handle == official_handle:
        return "企業公式", "公式アカウントURLと一致（確定）"

    # ② 推定: 企業・ブランドを示す語がハンドル/表示名/プロフィールにある。
    #    ラテン文字は区切り（_ . - 空白）で切った**トークン一致**にする。
    blob = f"{handle} {name} {bio}"
    tokens = set(re.split(r"[^a-z0-9]+", blob))
    hit = next((w for w in _ORG_WORDS_LATIN if w in tokens), None)
    if hit:
        return "企業公式", f"『{hit}』が独立した語として含まれる（推定）"
    hit_ja = next((w for w in _ORG_WORDS_JA if w in blob), None)
    if hit_ja:
        return "企業公式", f"『{hit_ja}』を含む（推定）"

    # ③ 推定: 発信を仕事にしている規模。認証バッジか一定以上のフォロワー
    if verified:
        return "インフルエンサー", "認証バッジあり（推定）"
    if fol >= 10000:
        return "インフルエンサー", "フォロワー1万以上（推定）"

    # ④ それ以外は一般の投稿者として扱う
    if any(m in bio for m in _PERSON_MARKERS):
        return "一般人(UGC)", "個人のプロフィール表現（推定）"
    return "一般人(UGC)", "企業・規模のいずれの手がかりも無い（推定）"


def _by_axis(recs):
    """検索軸（source_file）ごとにレコードを分ける。同一動画が複数軸に出る場合は各軸で計上。"""
    out = {}
    for r in recs:
        for a in (r.get("source_appearances") or [{"label": r.get("label"), "source_file": r.get("source_file")}]):
            key = a.get("label") or a.get("source_file") or "(不明)"
            out.setdefault(key, []).append(r)
    return out


def load_external(run_dir: Path, current_signal_ids=None):
    """外部スクリプトの出力を読む。②③の章はこれを参照して数値を載せる。

    いまの signals より古い入力で作られた出力は読み込まない。
    9件時点の話題分類と18件時点の計測が同じ資料に混ざる事故を防ぐ。
    """
    out, stale = {}, []
    for key, rel in (
        ("measurement", "measurement/measure_output.json"),
        ("market_categories", "measurement/market_categories_output.json"),
        ("rank_patterns", "measurement/rank_patterns_output.json"),
    ):
        fp = run_dir / rel
        if not fp.exists():
            # 命名ゆれに対応（*_output.json を探す）
            cands = sorted(run_dir.glob(f"**/{Path(rel).stem}*.json"))
            fp = cands[0] if cands else None
        if fp and fp.exists():
            try:
                payload = json.loads(fp.read_text(encoding="utf-8"))
                if current_signal_ids is not None and external_is_stale(payload, current_signal_ids):
                    fpc = (payload.get("inputs_fingerprint") or {}).get("signal_count")
                    stale.append(f"{Path(rel).name}（{fpc}件時点／現在{len(current_signal_ids)}件）")
                    continue
                out[key] = payload
            except json.JSONDecodeError:
                pass
    if stale:
        # 古い出力を黙って混ぜない。読まなかったことを必ず伝える。
        print("WARNING: 入力より古い外部出力を読み飛ばしました: "
              + " / ".join(stale)
              + "。該当の章は入力不足になります。再実行してください。", file=sys.stderr)
    return out


def external_is_stale(payload, current_ids):
    """外部出力が、いまの signals より古い入力で作られていないかを見る。

    実際に、9件時点の話題分類と18件時点の計測が同じ資料に混ざる状態が起きていた。
    出力側が入力の指紋を持っていない場合は判定できないので None を返す（嘘をつかない）。
    """
    fp = (payload or {}).get("inputs_fingerprint")
    if not fp or not isinstance(fp, dict):
        return None
    known = set(fp.get("signal_ids") or [])
    if not known:
        return None
    return sorted(known) != sorted(current_ids)


def compute_from_external(mid, ext, cfg=None, recs=None):
    from collections import Counter
    """外部出力から章の中身を作る。無ければ None。"""
    m = ext.get("measurement")
    if mid in ("2-1", "2-2") and m:
        rows, ch_rows = [], []
        for ax in m.get("axes", []):
            ov = ax.get("overall") or {}
            rows.append({
                "軸": ax.get("label"), "本数": ov.get("valid_videos"),
                "登場率%": ov.get("appearance_rate_pct"),
                "統合平均(回/本)": ov.get("avg_mentions_per_video"),
                "接点平均(回/本)": ov.get("avg_surface_mentions_per_video"),
            })
            for cname, c in (ov.get("channels") or {}).items():
                label = {"caption": "投稿文", "hashtag": "ハッシュタグ",
                         "ocr": "テロップ", "asr": "音声"}.get(cname, cname)
                ch_rows.append({
                    "軸": ax.get("label"), "経路": label,
                    "登場率%": c.get("appearance_rate_pct"),
                    "平均(回/本)": c.get("avg_mentions_per_video"),
                    "本数": c.get("videos_with_keyword"),
                    # 経路ごとに分母が違う（音声は発話のある投稿だけ）。
                    # 分母を出さないと読み手が全件だと思い込む。
                    "分母": c.get("valid_videos"),
                    "対象外": c.get("excluded_not_applicable") or 0,
                })
        # 有効動画が1本も無いと全項目が null になる。null 並びの表を「出せた」ことにすると
        # 資料に空欄の章が流れるので、不足として返す（媒体解析が済んでいない状態）。
        if not any((r.get("本数") or 0) > 0 for r in rows):
            return None
        if mid == "2-1":
            # primary_count_definition は内部の識別子（unique_event_total 等）。
            # そのまま資料に出すと客先で意味が通らないので表示用の言葉に直す。
            DEF_LABEL = {
                "unique_event_total": "同じ言葉が1本の中で何度出ても1回として数える",
                "event_total": "言及のたびに1回として数える",
            }
            _d = m.get("primary_count_definition")
            return {"軸別": rows,
                    "数え方": DEF_LABEL.get(_d, _d),
                    "note": m.get("coverage_note")}
        # 固定文で「除外している」と書くと、実装が除外していないときに嘘になる。
        # 実際の分母と除外件数を出力から取って書く。
        asr = next((c for c in ch_rows if c.get("経路") == "音声"), {})
        den = asr.get("分母")
        exc = asr.get("対象外")
        voice_note = (f"音声の分母は発話のある動画 {den}本"
                      + (f"（写真 {exc}本は構造的に対象外）" if exc else "") + "。"
                      if den is not None else "")
        return {"4経路": ch_rows,
                "note": "同時刻の telop+voice は1回に統合。" + voice_note
                        + (m.get("coverage_note") or "")}

    mc = ext.get("market_categories")
    if mid == "2-4" and mc:
        # 出力の実キーは composition（category_counts ではない）。
        # 取り違えるとデータがあっても永久に空の章になる。
        rows = []
        for ax in mc.get("axes", []):
            for item in (ax.get("composition") or []):
                rows.append({"軸": ax.get("label"), "話題": item.get("label"),
                             "本数": item.get("count"), "構成比%": item.get("rate_pct")})
        if not rows:
            # 空を「出せた」ことにしない。分類できていない事実を不足として返す。
            return None
        return {"話題構成": rows,
                # 外部スクリプトの出力は内部の英語フィールド名のまま
                # （"caption + hashtag + telop(...)..."）。客先資料に出す前に
                # 日本語へ置き換える。
                "分類の根拠": _jp_basis(mc.get("classification_basis")),
                "note": mc.get("basis_note") or mc.get("caveat")}

    rp = ext.get("rank_patterns")

    # ── ⑤ 次のアクション（5-1/5-2/5-3）──
    # カタログの仕様（0〜2秒／3〜20秒／最後＋投稿文1行目、3案、同曜日2案）に沿って
    # rank_patterns の実測から組み立てる。observed でないことは書かない。
    if mid in ("5-1", "5-2", "5-3") and rp:
        axes = rp.get("axes") or []
        if not axes:
            return None
        ax = axes[0]
        tops = ax.get("video_classifications") or []
        if not tops:
            return None
        rates = ax.get("common_rates") or {}

        def tag_counts(key):
            c = Counter()
            for t in tops:
                blk = t.get(key) or {}
                if blk.get("present"):
                    for tag in (blk.get("tags") or []):
                        c[tag] += 1
            return c

        def evidence_in(key, lo, hi, limit=3, telop_only=False):
            """区間内の文言を集める。出所（テロップ／音声）を明記する。

            音声の書き起こしは誤認識を含むので、テロップと同じ顔で資料に
            出すと事故になる。telop_only=True ならテロップだけに絞る。
            """
            out = []
            for t in tops:
                for e in ((t.get(key) or {}).get("evidence") or []):
                    st = e.get("start")
                    if st is None or not (lo <= st <= hi):
                        continue
                    src = e.get("source")
                    if telop_only and src != "telop":
                        continue
                    txt = (e.get("text") or "").strip()
                    if not txt:
                        continue
                    tagged = txt if src == "telop" else f"{txt}〔音声〕"
                    if tagged not in out:
                        out.append(tagged)
                    if len(out) >= limit:
                        return out
            return out

        hook_tags = tag_counts("A_opening_hook")
        proof_tags = tag_counts("B_proof")
        n_top = len(tops)

        def pct(key):
            v = rates.get(key) or {}
            return v.get("common_rate_pct"), v.get("present_count"), v.get("applicable_count")

        if mid == "5-1":
            hr, hp, ha = pct("A_opening_hook")
            br, bp, ba = pct("B_proof")
            fr, fp, fa = pct("F_cta")
            phases = [
                {"区間": "0〜2秒", "上位で観測された作り":
                    "、".join(f"{k}（{v}/{n_top}本）" for k, v in hook_tags.most_common(3)) or "特徴なし",
                 "実際の文言例": " ／ ".join(evidence_in("A_opening_hook", 0, 2.5)) or "（該当なし）",
                 "上位での実施率": f"{hr}%（{hp}/{ha}本）" if hr is not None else "判定不可"},
                {"区間": "3〜20秒", "上位で観測された作り":
                    "、".join(f"{k}（{v}/{n_top}本）" for k, v in proof_tags.most_common(3)) or "特徴なし",
                 "実際の文言例": " ／ ".join(evidence_in("B_proof", 3, 20)) or "（該当なし）",
                 "上位での実施率": f"{br}%（{bp}/{ba}本）" if br is not None else "判定不可"},
                {"区間": "最後", "上位で観測された作り":
                    "行動喚起（CTA）は上位でも確認できていない" if (fr == 0) else
                    "、".join(k for k, _ in tag_counts("F_cta").most_common(3)) or "特徴なし",
                 "実際の文言例": " ／ ".join(evidence_in("F_cta", 20, 10 ** 6)) or "（該当なし）",
                 "上位での実施率": f"{fr}%（{fp}/{fa}本）" if fr is not None else "判定不可"},
            ]
            first_line = [t for t in (hook_tags.most_common(1) or [(None, 0)])][0][0]
            return {
                "構成": phases,
                "投稿文1行目案": (f"上位で最も多い冒頭の型は『{first_line}』。"
                             "1行目にこれを置き、検索語を同じ行に入れる")
                             if first_line else "上位に共通する冒頭の型は確認できていない",
                "空いている枠": (f"CTAは上位 {fp}/{fa} 本でしか確認できていない。"
                            "最後に一言足すだけで差別化余地がある") if fr == 0 else None,
                "note": "上位群で実際に観測された要素と文言から組み立てた案。"
                        "文言例にはテロップと音声の書き起こしが混ざり、"
                        "音声側は誤認識を含みうる（そのまま台本に写さない）。"
                        "順位や再生を上げる保証ではない",
            }

        if mid == "5-2":
            # 上位で実際に観測された冒頭の型を、多い順に最大3案として提示する
            # 1本の投稿が複数の型のタグを同時に持つことがある。実例を使い回すと
            # 別の案なのに一語一句同じ文言が2件並び、誤って見える（実測で発生）。
            # 一度使った実例は次の案では避け、その型に固有の投稿を優先する。
            used_ex = set()
            plans = []
            for i, (tag, n) in enumerate(hook_tags.most_common(3), 1):
                ex = None
                for t in tops:
                    blk = t.get("A_opening_hook") or {}
                    if not (blk.get("present") and tag in (blk.get("tags") or [])):
                        continue
                    for e in (blk.get("evidence") or []):
                        st = e.get("start")
                        # 1枚目の案は画面に出ている文字（テロップ）だけを使う。
                        # 音声の書き起こしは誤認識を含み、そのまま台本にできない。
                        if st is None or st > 2.5 or not e.get("text"):
                            continue
                        if e.get("source") != "telop":
                            continue
                        txt = e["text"].strip()
                        if txt in used_ex:
                            continue      # 他の案で既に使っている実例
                        ex = txt
                        break
                    if ex:
                        break
                if ex:
                    used_ex.add(ex)
                plans.append({
                    "案": f"案{i}: {tag}型",
                    "1枚目/冒頭": ex or "（この型に固有の実例なし。上位では他の型と併用されている）",
                    "上位での出現": f"{n}/{n_top}本",
                    "組み合わせる要素": "、".join(k for k, _ in proof_tags.most_common(2)) or "証明要素なし",
                })
            if not plans:
                return None
            return {"投稿案": plans,
                    "note": "上位群で実際に使われていた冒頭の型を出現数の多い順に並べたもの。"
                            "冒頭2.5秒以内の文言だけを引用している。"
                            "1本の投稿が複数の型の特徴を持つことがあり、実例は案ごとに重複させていない。"
                            "商品要素は案件側で差し替える前提"}

        if mid == "5-3":
            # 差が最も大きかった要素を検証対象にする（媒体種別ごと）
            arms = []
            for axd in (rp.get("rank_up_deltas") or []):
                for st in (axd.get("strata") or []):
                    if not st.get("comparable"):
                        continue
                    cands = [c for c in (st.get("category_deltas") or [])
                             if c.get("delta_pt") is not None and c["delta_pt"] > 0]
                    if not cands:
                        continue
                    best = max(cands, key=lambda c: c["delta_pt"])
                    media = {"video": "動画", "photo": "写真"}.get(st.get("media_type"))
                    arms.append({
                        "媒体": media,
                        "検証する要素": best["category"],
                        "根拠": (f"上位{best['top_common_rate_pct']}% vs "
                               f"下位{best['bottom_common_rate_pct']}%（差 {best['delta_pt']:+.1f}pt）"),
                        "A案": f"{best['category']}を入れる",
                        "B案": f"{best['category']}を入れない",
                        "母数": f"{best.get('top_n')} vs {best.get('bottom_n')}",
                    })
            if not arms:
                return None
            return {
                "テスト設計": arms,
                "実施条件": "同じ曜日・近い投稿時間で2案を出す。それ以外の条件は揃える",
                "比較指標": "キーワード登場率／再生数／保存数（保存率を主指標にする）",
                "note": "差分は相関であり因果ではない。ABテストはその因果を確かめるための手順",
            }

    if mid in ("3-1", "3-2", "3-5") and rp:
        if mid == "3-1":
            rows = []
            for ax in rp.get("axes", []):
                for cat, v in (ax.get("common_rates") or {}).items():
                    if not isinstance(v, dict):
                        rows.append({"軸": ax.get("label"), "見せ方": cat,
                                     "割合%": v, "母数": None})
                        continue
                    rate = v.get("common_rate_pct")
                    rows.append({
                        "軸": ax.get("label"),
                        # rank_patterns 側が日本語 label を持っている。内部キーを
                        # そのまま出すと客先資料に識別子（A_opening_hook 等）が載る。
                        "見せ方": v.get("label") or cat,
                        # 判定不可を 0% と書くと「無い」と読まれる。文字で区別する。
                        "割合%": rate if rate is not None else "判定不可",
                        "母数": (f"{v.get('present_count')}/{v.get('applicable_count')}"
                                 if rate is not None else (v.get("note") or "対象0件")),
                    })
            if not rows:
                return None
            # 「上位10本」と書いて実際は9本、では読み手が母数を誤る。
            ax0 = (rp.get("axes") or [{}])[0]
            req = ax0.get("requested_top_n")
            got = ax0.get("classified_count")
            skipped = ax0.get("skipped_rank_no_signal_yet") or []
            head = (f"上位{req}本のうち分類できた{got}本が対象。" if req and got is not None else "")
            if skipped:
                ranks = ", ".join(str(x.get("rank")) for x in skipped)
                head += f"順位 {ranks} は媒体解析が済んでいないため除外（0件ではない）。"
            return {"冒頭の文言": hook_lines((cfg or {}).get("_run_dir"),
                                          recs or []),
                    "見せ方の割合": rows,
                    "note": head + "順位や再生の因果は断定しない。"
                            "母数は判定できた本数（未計測は分母から除外している）"}
        if mid == "3-2":
            # 空配列を「算出済み」として資料に流していた（★最重要章）。
            # 下位群の分類が無い間は不足として正直に落とす。
            # 差分は媒体種別ごと（動画は動画・写真は写真）に出す。
            # 混ぜると「演出の差」ではなく「動画か写真か」を測ってしまう。
            rows, skipped = [], []
            for ax in (rp.get("rank_up_deltas") or []):
                for st in (ax.get("strata") or []):
                    media = {"video": "動画", "photo": "写真"}.get(
                        st.get("media_type"), st.get("media_type"))
                    if not st.get("comparable"):
                        skipped.append(f"{media}: {st.get('block_reason')}")
                        continue
                    for cd in (st.get("category_deltas") or []):
                        if cd.get("delta_pt") is None:
                            # 判定不可を 0pt と書くと「差が無い」と読まれる
                            rows.append({"媒体": media, "軸": ax.get("axis_label"),
                                         "見せ方": cd.get("category"),
                                         "上位%": "判定不可", "下位%": "判定不可",
                                         "差分pt": "判定不可",
                                         "母数": f"{st.get('top_n')} vs {st.get('bottom_n')}"})
                            continue
                        rows.append({"媒体": media, "軸": ax.get("axis_label"),
                                     "見せ方": cd.get("category"),
                                     "上位%": cd.get("top_common_rate_pct"),
                                     "下位%": cd.get("bottom_common_rate_pct"),
                                     "差分pt": cd.get("delta_pt"),
                                     "母数": f"{cd.get('top_n')} vs {cd.get('bottom_n')}"})
            if not rows:
                return None
            note = ("差分＝相関であり因果ではない。動画と写真は別々に比較している"
                    "（混ぜると媒体種別の差を測ってしまうため）")
            if skipped:
                note += "。差分を出せなかった層: " + " / ".join(skipped)
            return {"上位下位差分": rows, "note": note}
        # 3-5: 実キーは self_vs_competitor_gaps。comparison は存在しない。
        # さらに入れ子のままセルに入れるとリスト literal が印字されるので平坦化する。
        gaps = rp.get("self_vs_competitor_gaps") or []
        axes = rp.get("axes") or []
        # category_gaps の "見せ方" は日本語ラベル（"証明の見せ方"）。
        # video_classifications の中身は内部キー（"B_proof"）で持っているので、
        # common_rates の label から逆引きする。
        label_to_key = {}
        for ax in axes:
            for key, v in (ax.get("common_rates") or {}).items():
                if isinstance(v, dict) and v.get("label"):
                    label_to_key[v["label"]] = key

        def _find_example(competitor_label, category_label):
            """「差だけ」ではなく、実際にその見せ方をしている競合の投稿を1本探す。

            数値だけでは何を真似ればいいのか伝わらない、という指摘を受けて、
            差分の根拠になった実例（サムネイル・ハンドル・URL）を添える。
            """
            key = label_to_key.get(category_label)
            ax = next((a for a in axes if a.get("label") == competitor_label), None)
            if not key or not ax:
                return None
            for vc in (ax.get("video_classifications") or []):
                blk = vc.get(key) or {}
                if not blk.get("present"):
                    continue
                vid = vc.get("video_id")
                r = next((rr for rr in (recs or []) if rr["video_id"] == vid), None)
                if not r:
                    continue
                img = thumb_for(cfg, vid) if cfg else None
                if not img:
                    continue      # 実画面が無い投稿は実例に出さない
                h = handle(r.get("creator_id"))
                # @user1740252675402 のような自動採番IDは、根拠として
                # 指させないアカウントなので実例候補から外す（客先目線
                # レビューで「これは誰ですか」に答えられないと指摘された）。
                if re.fullmatch(r"@user\d{8,}", h):
                    continue
                return {"投稿者": h,
                        "URL": r.get("video_url"), "_image": img}
            return None

        rows = []
        for g in gaps:
            comp = g.get("competitor_label")
            for cg in (g.get("category_gaps") or []):
                row = {"競合": comp, "見せ方": cg.get("category"),
                       "自社%": cg.get("self_common_rate_pct"),
                       "競合%": cg.get("competitor_common_rate_pct"),
                       "差分pt": cg.get("gap_pct"),
                       # 「11.1pt差」だけでは統計的な差に見えるが、実際は
                       # 9本中1本の違いということもある。母数を必ず添える。
                       "自社母数": (f"{cg['self_n']}/{cg['self_total']}"
                                  if cg.get("self_n") is not None else None),
                       "競合母数": (f"{cg['competitor_n']}/{cg['competitor_total']}"
                                  if cg.get("competitor_n") is not None else None)}
                ex = _find_example(comp, cg.get("category"))
                if ex:
                    row["_例"] = ex
                rows.append(row)
        if not rows:
            return None
        return {"競合比較": rows,
                "note": "再生増の原因を断定しない。実例は、その見せ方が使われていたと"
                        "判定された競合の投稿から実画面のあるものを1本選んでいる"}
    return None


def _has_content(path, min_stddev=22.0):
    """そのコマに中身が写っているか。

    動画の1コマ目は白や黒のフェードのことがある（実測で37本中4本）。
    そのまま代表画像にすると、資料に真っ白なカードが並ぶ。
    明暗のばらつきが小さいコマは避けて、次のコマを使う。
    """
    try:
        from PIL import Image, ImageStat
        with Image.open(path) as im:
            return ImageStat.Stat(im.convert("L")).stddev[0] >= min_stddev
    except Exception:
        return True     # 判定できないときは弾かない


def is_ad(r):
    """この投稿を広告として数えるか。

    **#PR 表記と TikTok 側の広告フラグは、どちらも広告として扱う**
    （2026-09-03 決定。それ以前は #PR 表記のみを基準にしていた）。
    片方だけを基準にすると、資料の中に 2.8% と 19.8% の二重帳簿ができる。
    """
    if r.get("pr_status_prelim") == "pr":
        return True
    v = r.get("is_ad_platform_flag")
    return v is True or str(v).strip().lower() == "true"


_BASIS_WORDS = [
    ("caption", "投稿本文"), ("hashtag", "ハッシュタグ"),
    ("telop", "テロップ"), ("ASR", "音声書き起こし"),
    ("のルール一致", "を照合"),
]


def _jp_basis(text):
    """分類根拠の内部フィールド名（caption/hashtag/telop/ASR）を日本語にする。"""
    t = str(text or "")
    for en, jp in _BASIS_WORDS:
        t = t.replace(en, jp)
    return t or None


def handle(x):
    """TikTok のハンドルを表示用にする。@ は1つだけ付ける。

    付け忘れると内部の識別子と見分けがつかず、付けすぎると @@ になる。
    付ける場所を1つに決める。
    """
    t = str(x or "").strip()
    return ("@" + t.lstrip("@")) if t else ""


def _own_brand_terms(cfg):
    """自社ブランドの表記ゆれ一覧（正規化済み）。"""
    al = cfg.get("brand_aliases")
    names = [cfg.get("brand")]
    if isinstance(al, dict):
        names += list(al.get(cfg.get("brand"), []) or [])
    elif al:
        names += list(al or [])
    return {re.sub(r"[\s　]+", "", str(x)).lower() for x in names if x}


def _cap(text, limit):
    """投稿文を固定長で切る。末尾が孤立した「#」で終わらないようにする

    （実測で「#lawson  #」のようにハッシュタグの途中で切れていた）。
    """
    t = str(text or "")
    if len(t) <= limit:
        return t
    cut = t[:limit].rstrip()
    while cut and cut[-1] == "#":
        cut = cut[:-1].rstrip()
    return cut + "…"


def is_own_brand_post(r, cfg):
    """この投稿が自社ブランドの投稿か。

    「勝ちパターン」の実例に自社が1本も出ず、競合の投稿ばかりが
    並んでいる状態を客先目線レビューで指摘された。実例選定で
    自社を優先するために、まず自社かどうかを判定できるようにする。
    """
    terms = _own_brand_terms(cfg)
    if not terms:
        return False

    def norm(x):
        return re.sub(r"[\s　]+", "", str(x)).lower()

    hay = (norm(r.get("caption") or "") + norm(r.get("creator_name") or "")
           + norm(r.get("creator_id") or "")
           + "".join(norm(h) for h in (r.get("hashtags") or [])))
    return any(t in hay for t in terms)


def hook_text(cfg, vid, within=1.0):
    """冒頭（0秒付近）のテロップ。**signals から読む。**

    manifest（telop_videos.json 等）は取り込みの入力で、正は signals 側。
    manifest を読むと、あとから取り込んだ分が反映されない（実測で
    取り込み済みの3本が「未読」と出ていた）。
    読み取っていなければ None を返す。推測で埋めない。
    """
    sig = _signal_of(cfg, vid)
    for sp in (sig.get("ocr_spans") or []):
        try:
            if float(sp.get("start", 9e9)) <= within:
                t = str(sp.get("text") or "").strip()
                if t:
                    return t
        except (TypeError, ValueError):
            continue
    return None


def hook_lines(run_dir, recs, limit=8):
    """冒頭で実際に何と言っているか。

    「見せ方＝冒頭フック 57%」は分類名であって中身が無い。
    フックが大事なのは既に分かっているので、**実際の文言**を出す。
    出典は import_agent_telop.py で取り込んだ読み取り結果だけ。推測で書かない。
    """
    out = []
    by_vid = {}
    for r in recs:
        by_vid.setdefault(r["video_id"], r)
    cfg = {"_run_dir": str(run_dir)}
    for vid, r in by_vid.items():
        t = hook_text(cfg, vid)
        if t:
            out.append({
                "_video_id": vid,
                "冒頭の文言": t[:34],
                "投稿者": handle(r.get("creator_id")),
                "検索面": r.get("label") or "",
                "表示順": _to_i(r.get("rank")) or None,
                "再生": _to_i(r.get("views")),
                "保存率%": _to_f(r.get("save_rate_pct")),
                "URL": r.get("video_url"),
            })
    out.sort(key=lambda x: -(x.get("再生") or 0))
    return out[:limit]


def _thumbprint(path, size=16):
    """コマの見た目を小さな数列にする。似たコマを見分けるためだけのもの。"""
    try:
        from PIL import Image
        with Image.open(path) as im:
            return list(im.convert("L").resize((size, size),
                                               Image.LANCZOS).getdata())
    except Exception:
        return None


def _pick_distinct(items, n, key=lambda x: x, min_diff=9.0):
    """見た目が似ているコマを飛ばして n 個選ぶ。

    経過秒で等間隔に選ぶと、同じテロップが出ている区間で
    ほぼ同じ絵が2枚並ぶ（実測で4コマ目と5コマ目が同一に見えた）。
    構成を見せるページなので、絵が変わらないコマは選ばない。
    """
    out, prints = [], []
    for it in items:
        tp = _thumbprint(key(it))
        if tp and prints:
            d = min(sum(abs(a - b) for a, b in zip(tp, q)) / len(tp) for q in prints)
            if d < min_diff:
                continue
        out.append(it)
        if tp:
            prints.append(tp)
        if len(out) >= n:
            break
    # 似ているものを飛ばして足りなくなったら、順番どおりで埋める
    for it in items:
        if len(out) >= n:
            break
        if it not in out:
            out.append(it)
    return out


def _signal_of(cfg, vid):
    """実画面の解析結果を1本ぶん読む。無ければ空。"""
    p = Path(cfg.get("_run_dir") or ".") / "signals" / f"{vid}.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def thumb_for(cfg, vid):
    """この投稿の代表サムネイル1枚。無ければ None。

    数字だけの章にも実物を1枚添えると、商談で「どの投稿の話か」がすぐ伝わる。
    取得していない投稿には出さない（無い画像を作らない）。
    """
    run_dir = Path(cfg.get("_run_dir") or ".")
    fd = run_dir / "frames" / str(vid)
    if fd.exists():
        cands = (sorted(fd.glob("hook_00.00s.jpg")) + sorted(fd.glob("f_*.jpg"))
                 + sorted(fd.glob("hook_*.jpg")))
        for c in cands:
            if _has_content(c):
                return str(c)
        if cands:
            return str(cands[0])
    p1 = run_dir / "media" / f"{vid}_photos" / "01.jpg"
    return str(p1) if p1.exists() else None


def build_showcase(recs, cfg, limit=12):
    """実画面まで確認できた投稿の一覧を1か所で作る。

    資料の各章が「実物のカード」を出したいとき、毎回 videos.jsonl を
    読み直すと章ごとに選び方がぶれる。ここで一度だけ選んで spec に載せる。

    **媒体を取得していない投稿は入れない。** 画像の無いカードを作らないため。
    """
    # 投稿直後やスパムが表示順1位に紛れることがある（実測で再生3回の投稿が1位）。
    # 資料に「この面の代表」として出すと誤解を招くので下限を置く。
    MIN_VIEWS = 1000
    out = []
    for r in recs:
        vid = r.get("video_id")
        img = thumb_for(cfg, vid)
        if not img or _to_i(r.get("views")) < MIN_VIEWS:
            continue
        out.append({
            "video_id": vid,
            "投稿者": r.get("creator_name") or r.get("creator_id") or "",
            "handle": r.get("creator_id") or "",
            "軸": r.get("label") or "",
            "役割": r.get("role") or "",
            "表示順": _to_i(r.get("rank")),
            "再生": _to_i(r.get("views")),
            "いいね": _to_i(r.get("likes")),
            "保存": _to_i(r.get("saves")),
            "保存率%": _to_f(r.get("save_rate_pct")),
            "本文": _cap(r.get("caption") or "", 80),
            "形式": "写真" if r.get("media_type") == "photo" else "動画",
            "認証": str(r.get("creator_verified")).lower() == "true",
            "URL": r.get("video_url") or "",
            "_image": img,
        })
    # 表示順が上のものから。検索面で実際に上に出ていた投稿を優先する。
    out.sort(key=lambda x: (x["表示順"] if x["表示順"] else 9999))
    return out[:limit]


def _to_i(v):
    try:
        return int(float(str(v).replace(",", "")))
    except Exception:
        return 0


def _to_f(v):
    try:
        return float(str(v).replace(",", "").replace("%", ""))
    except Exception:
        return 0.0


def compute_module(mid, recs, cfg):
    """mid の中身を計算して返す。計算対象外なら None。"""
    from collections import Counter

    total = len(recs)
    if not total:
        return None

    if mid == "1-1":
        # カタログの定義は「一般キーワード検索で、どのブランドが上位にどれだけ出ているか」。
        # 軸（検索）ごとの取得件数を並べても、それは各検索が何件返したかであって
        # 露出シェアではない。市場キーワードの検索面の中でブランドを数える。
        files = cfg.get("files") or []
        market = [f["label"] for f in files if f.get("role") == "market_keyword"]
        # ブランドは「表示名 → 表記ゆれの集合」で持つ。略称と正式名を別行にすると
        # 同じブランドが2つに割れてシェアが実際より小さく見える。
        brands = {}
        for f in files:
            if f.get("role") == "self":
                key = cfg.get("brand") or f["label"]
                brands.setdefault(key, set()).update({key, f["label"]})
            elif f.get("role") == "competitor":
                brands.setdefault(f["label"], set()).add(f["label"])
        # 表記のゆれは confirmed_config.json の brand_aliases で確定させる。
        #   {"brand_aliases": {"セブンイレブン": ["セブン"], "ファミリーマート": ["ファミマ"]}}
        # 旧形式（自社のエイリアスだけの配列）も受ける。
        al = cfg.get("brand_aliases")
        if isinstance(al, dict):
            for k, vs in al.items():
                if k in brands:
                    brands[k].update(v for v in vs if v)
        elif al:
            k = cfg.get("brand")
            if k:
                brands.setdefault(k, set()).update(a for a in al if a)
        if not market or len(brands) < 2:
            return None

        def norm(x):
            return re.sub(r"[\s　]+", "", str(x)).lower()

        pool = [r for r in recs if r.get("label") in market]
        if not pool:
            return None
        rows, matched = [], set()
        for label, aliases in brands.items():
            terms = [norm(a) for a in aliases if a]
            hits = [r for r in pool if any(
                t in norm(r.get("caption") or "")
                or any(t in norm(h) for h in (r.get("hashtags") or []))
                or t in norm(r.get("creator_name") or "")
                or t in norm(r.get("creator_id") or "")
                for t in terms)]
            matched |= {r["video_id"] for r in hits}
            rows.append({"ブランド": label, "本数": len(hits),
                         "シェア%": round(len(hits) / len(pool) * 100, 1),
                         "数えた表記": "／".join(sorted(aliases))})
        # 数えていない表記が無いかを見る。「セブンイレブン」だけを数えて
        # 「セブン」表記を落としていた（実測18本＝シェアで11ポイント）。
        # 気づかないまま出すのが最も悪いので、検出して資料に書く。
        missed = []
        for label, aliases in brands.items():
            terms = [norm(a) for a in aliases if a]
            for cut in (4, 3):
                short = norm(label)[:cut]
                if not short or any(short == t for t in terms):
                    continue
                extra = [r for r in pool
                         if (short in norm(r.get("caption") or "")
                             or any(short in norm(h) for h in (r.get("hashtags") or []))
                             or short in norm(r.get("creator_id") or ""))
                         and not any(t in norm(r.get("caption") or "")
                                     or any(t in norm(h) for h in (r.get("hashtags") or []))
                                     or t in norm(r.get("creator_name") or "")
                                     or t in norm(r.get("creator_id") or "")
                                     for t in terms)]
                if len(extra) >= max(3, len(pool) * 0.02):
                    missed.append(f"「{norm(label)[:cut]}」表記のみ {len(extra)}本")
                    break
        rows.sort(key=lambda x: -x["本数"])
        rows.append({"ブランド": "どのブランドも出てこない投稿",
                     "本数": len(pool) - len(matched),
                     "シェア%": round((len(pool) - len(matched)) / len(pool) * 100, 1)})
        return {"露出シェア": rows,
                # 本数の合計は母集団を超える（1投稿に複数ブランドが出るため）。
                # 分母は必ずこちらを使う。合計を分母にすると割合がずれる。
                "_母集団本数": len(pool),
                "_残余ラベル": "どのブランドも出てこない投稿",
                "母集団": f"市場キーワード（{'／'.join(market)}）の検索面 {len(pool)}本",
                "note": ("本文・ハッシュタグ・投稿者名にブランド名が出た投稿を数えている。"
                         "1投稿に複数ブランドが出る場合は各ブランドで1本として計上するため、"
                         "合計は100%を超えることがある"
                         + ("。なお " + "／".join(missed)
                            + " は数えていない（confirmed_config.json の "
                              "brand_aliases に追加すると数に入る）" if missed else ""))}

    if mid == "1-2":
        acct = (cfg.get("official_tiktok_account") or "").rstrip("/").split("/")[-1].lstrip("@").lower()
        if not acct:
            return None
        hit = [r for r in recs if (r.get("creator_id") or "").lower() == acct]
        # 内部キー名を客先資料に出さない。列名は日本語で揃える。
        return {"公式アカウント": f"@{acct}",
                "検索面に出ている本数": len(hit),
                "取得した全本数": total,
                "露出シェア%": round(len(hit) / total * 100, 2),
                # ここは客先に出る文。営業向けの言い回し（「危機感の提示に使える」等）は
                # 資料ではなく gaps.py の「次の一手」に置く。
                "note": "公式アカウントの投稿が検索結果に出てきた本数。"
                        "取得した全件を分母にしており、表示順の上位だけに絞っていない"}

    if mid == "1-3":
        c = Counter(r.get("creator_id") or "(不明)" for r in recs)
        multi = {k: v for k, v in c.items() if v > 1}
        verified = sum(1 for r in recs if r.get("creator_verified"))

        # 投稿者を種別に分ける。判定根拠も一緒に持ち、確定と推定を混ぜない。
        kinds, reasons, confirmed = Counter(), {}, 0
        by_creator = {}
        for r in recs:
            kind, why = classify_creator(r, cfg)
            kinds[kind] += 1
            reasons.setdefault(kind, Counter())[why] += 1
            if "確定" in why:
                confirmed += 1
            by_creator.setdefault(r.get("creator_id"), kind)

        total_n = len(recs)
        rows = [{"種別": k, "本数": v, "構成比%": round(v / total_n * 100, 1),
                 "主な判定根拠": reasons[k].most_common(1)[0][0]}
                for k, v in kinds.most_common()]
        return {
            "投稿者タイプ": rows,
            "ユニーク投稿者数": len(c),
            "複数入賞した投稿者": len(multi),
            "複数入賞の上位": [{"投稿者": handle(k), "枠数": v}
                          for k, v in sorted(multi.items(), key=lambda x: -x[1])[:8]],
            "認証済みアカウント": verified,
            "note": "種別はハンドル・表示名・プロフィール文・認証バッジ・フォロワー数からの"
                    f"推定（公式アカウントURLとの一致で確定できたのは {confirmed} 本）。"
                    "TikTok側に『インフルエンサー』の定義は無いため、"
                    "発信規模による分類であることを前提に読むこと",
        }

    if mid == "1-4":
        _vids = [r for r in recs if (r.get("media_type") or "video") != "photo"]
        _phs = [r for r in recs if (r.get("media_type") or "video") == "photo"]
        from collections import Counter as C
        months = C((r.get("posted_at") or "")[:7] for r in recs if r.get("posted_at"))
        def dur_band(d):
            d = d or 0
            return "0-15s" if d <= 15 else "16-30s" if d <= 30 else "31-60s" if d <= 60 else "61-120s" if d <= 120 else "121s+"
        def fol_band(f):
            f = f or 0
            return "1万未満" if f < 10000 else "1-10万" if f < 100000 else "10-100万" if f < 1000000 else "100万以上"
        return {
            "月別本数": dict(sorted(months.items())),
            # 写真投稿の duration は音源クリップ長なので「尺」ではない。
            # 分母に混ぜると尺分布が写真比率ぶん（この案件で62%）まちがう。
            "尺帯（動画投稿のみ n=%d）" % len(_vids): dict(C(
                dur_band(r.get("video_duration_seconds")
                         if r.get("duration_source") == "video"
                         else r.get("duration_seconds"))
                for r in _vids)),
            "枚数帯（写真投稿のみ n=%d）" % len(_phs): dict(C(
                ("1-3枚" if (r.get("image_count") or 0) <= 3 else
                 "4-6枚" if (r.get("image_count") or 0) <= 6 else
                 "7-10枚" if (r.get("image_count") or 0) <= 10 else "11枚+")
                for r in _phs)) if _phs else {},
            "フォロワー帯": dict(C(fol_band(r.get("follower_count")) for r in recs)),
            "note": "取得時点のスナップショット。写真投稿に尺は存在しない"
                    "（取得値は音源クリップ長）ため尺帯の分母から外し、枚数分布を出している",
        }

    if mid == "1-5":
        pr = sum(1 for r in recs if r.get("pr_status_prelim") == "pr")
        flag = sum(1 for r in recs
                   if str(r.get("is_ad_platform_flag")).strip().lower() == "true")
        ads = sum(1 for r in recs if is_ad(r))
        both = pr + flag - ads
        return {
            "広告（#PR表記かTikTokの広告フラグ）": ads,
            "オーガニック": total - ads,
            "広告比率%": round(ads / total * 100, 1),
            "_内訳": {"#PR表記あり": pr, "TikTokの広告フラグあり": flag,
                      "両方": both},
            "note": ("広告は「#PR 表記」と「TikTok 側の広告フラグ」の"
                     f"どちらかが立っているものを数えている（#PR表記 {pr}件／"
                     f"広告フラグ {flag}件／両方 {both}件）。"
                     "表記と配信面の記録の双方を見ており、"
                     "景表法適合そのものを判定したものではない"),
        }

    if mid == "1-6":
        # 再生数は「露出した」事実として載せる。表示順と並べることで
        # 「再生を積めば上位に出る」わけではないことが対比で見える。
        #
        # 比較は**同じ検索軸の中**で行う。全軸をまたいだ再生順位と、
        # 単一の軸での表示順位を並べても、単位が違うので意味が無い
        # （旧実装はそれをやっていて、中央値が 99位 と出ていた。
        #   軸ごとに揃えると 36位 になる）。
        # 母集団も上位12本ではなく、順位が取れた全件にする。
        per_axis = _by_axis(recs)
        rows, gaps = [], []
        for axis, group in per_axis.items():
            seen, uniq = set(), []
            for r in group:
                if r["video_id"] not in seen:
                    seen.add(r["video_id"])
                    uniq.append(r)
            ordered = sorted(uniq, key=lambda r: -(r.get("views") or 0))
            pos = {r["video_id"]: i for i, r in enumerate(ordered, 1)}
            for r in uniq:
                disp = next((a.get("rank") for a in (r.get("source_appearances") or [])
                             if a.get("label") == axis and a.get("rank")), None)
                if disp is None and r.get("label") == axis:
                    disp = r.get("rank")
                if not disp:
                    continue
                vi = pos[r["video_id"]]
                gaps.append(abs(int(disp) - vi))
                rows.append({
                    "検索面": axis, "再生順": vi, "表示順": int(disp),
                    "乖離": int(disp) - vi,
                    "投稿者": handle(r.get("creator_id")),
                    "再生": r.get("views"), "保存": r.get("saves"),
                    "保存率%": round((r["saves"] / r["views"] * 100)
                                   if r.get("views") else 0, 2),
                    "URL": r.get("video_url"),
                })
        # 乖離が大きい順に並べ、上位を代表として見せる
        rows.sort(key=lambda x: -abs(x["乖離"]))
        gaps = [abs(x["乖離"]) for x in rows if x["乖離"] is not None]
        out = {
            "再生順TOP10": rows[:10],
            "乖離の中央値(順位差)": _median(gaps),
            "_乖離の母数": len(gaps),
            "note": ("同じ検索面の中で、再生数の順位と実際の表示順を比べている"
                     f"（順位が取れた延べ{len(gaps)}件。同じ動画が複数の検索面に"
                     "出るため、件数の合計は取得本数を超える）。"
                     "再生数は露出の実績であり、表示順とは別軸。"
                     "再生を積めば上位に出るという意味ではない"),
        }
        # 乖離が大きい投稿を実物で見せる。数字の対比より画像のほうが早い。
        # ただし**媒体を取得している投稿に限る**（取得していない投稿の画像は無い）。
        # 再生が極端に少ない投稿は、乖離が大きく見えても代表例にならない
        # （実測で「再生1回が表示順1位」が最上位に来た。投稿直後かスパム）。
        MIN_VIEWS_FOR_EXAMPLE = 1000
        by_vid = {}
        for r in recs:
            by_vid.setdefault(r["video_id"], r)
        # rows は同じ検索面の中で並べ直したもので、乖離の大きい順。
        # そこから媒体を取得している投稿だけを代表例にする。
        picked = []
        for row in rows:
            r = next((v for v in by_vid.values()
                      if handle(v.get("creator_id")) == row["投稿者"]
                      and (v.get("views") or 0) == (row.get("再生") or 0)), None)
            if not r or (r.get("views") or 0) < MIN_VIEWS_FOR_EXAMPLE:
                continue
            t = thumb_for(cfg, r["video_id"])
            if not t:
                continue
            picked.append((row, t))
            if len(picked) >= 4:
                break
        if picked:
            out["_images"] = [t for _row, t in picked]
            out["_image_labels"] = [
                f"「{row['検索面']}」で\n再生{row['再生順']}位 → 表示{row['表示順']}位"
                for row, _t in picked]
            out["_images_note"] = (f"再生 {MIN_VIEWS_FOR_EXAMPLE:,}回未満の投稿は"
                                   "代表例から除いている（投稿直後などで乖離が誇張されるため）")
            out["乖離の大きい投稿"] = [
                {"検索面": row["検索面"], "投稿者": row["投稿者"],
                 "再生順": row["再生順"], "表示順": row["表示順"],
                 "再生": row["再生"], "保存率%": row["保存率%"],
                 "URL": row.get("URL")}
                for row, _t in picked]
        return out

    if mid == "4-3":
        # 一般キーワードの検索面に出た投稿を、ブランド別に並べて冒頭の作りを比べる。
        # 自社名や競合名で引かれた面ではなく、**ブランド名で引かれていない面**を見る。
        # そこに出ているなら、ブランドを替えれば同じ面を狙えるという読みが立つ。
        files = cfg.get("files") or []
        market = [f["label"] for f in files if f.get("role") == "market_keyword"]
        if not market:
            return None
        aliases = {}
        for f in files:
            if f.get("role") == "self":
                aliases.setdefault(cfg.get("brand") or f["label"],
                                   set()).update({cfg.get("brand"), f["label"]})
            elif f.get("role") == "competitor":
                aliases.setdefault(f["label"], set()).add(f["label"])
        for k, vs in (cfg.get("brand_aliases") or {}).items():
            if k in aliases:
                aliases[k].update(v for v in vs if v)
        if len(aliases) < 2:
            return None

        def norm(x):
            return re.sub(r"[\s　]+", "", str(x or "")).lower()

        # 一般キーワードの面に出た投稿を、その面での最上位の表示順つきで集める
        pool = {}
        for r in recs:
            aps = r.get("source_appearances") or [
                {"label": r.get("label"), "rank": r.get("rank")}]
            for a in aps:
                if a.get("label") not in market:
                    continue
                rk = a.get("rank")
                cur = pool.get(r["video_id"])
                if cur is None or (rk or 999) < (cur[1] or 999):
                    pool[r["video_id"]] = (r, rk, a.get("label"))
        if not pool:
            return None

        PER_BRAND = 5
        rows, shortfall = [], []
        for label, al in aliases.items():
            terms = [norm(a) for a in al if a]
            hits = []
            for r, rk, face in pool.values():
                blob = (norm(r.get("caption")) + norm(r.get("hashtags_raw"))
                        + norm(r.get("creator_id")) + norm(r.get("creator_name")))
                if not any(t in blob for t in terms):
                    continue
                img = thumb_for(cfg, r["video_id"])
                if not img:
                    continue      # 実画面が無い投稿は比較に出さない
                hits.append({
                    "ブランド": label,
                    "検索面": face,
                    "表示順": rk,
                    "投稿者": handle(r.get("creator_id")),
                    "冒頭の文言": hook_text(cfg, r["video_id"]) or "（テロップ未読）",
                    "再生": _to_i(r.get("views")),
                    "保存率%": _to_f(r.get("save_rate_pct")),
                    "URL": r.get("video_url"),
                    "_video_id": r["video_id"],
                    "_image": img,
                })
            hits.sort(key=lambda x: -(x["再生"] or 0))
            picked = hits[:PER_BRAND]
            rows += picked
            if len(picked) < PER_BRAND:
                shortfall.append(f"{label} {len(picked)}本")
        if not rows:
            return None
        note = ("ブランド名で引かれていない検索面（"
                + "／".join(market) + f"）に出た投稿のうち、実画面を確認できたものを"
                f"ブランドごとに最大{PER_BRAND}本。再生の多い順。"
                "冒頭の文言はテロップの読み取りで、読めなかったものは"
                "『テロップ未読』と書き、推測で補わない")
        if shortfall:
            note += f"。{PER_BRAND}本に届かなかったブランド: {'／'.join(shortfall)}"
        return {"冒頭の比較": rows, "note": note}

    if mid == "4-4":
        def grp(g):
            v = [r["views"] for r in g]
            sv = [r["saves"] for r in g]
            sr = [r["saves"] / r["views"] * 100 for r in g if (r.get("views") or 0) > 0]
            return {"本数": len(g), "再生中央値": _median(v),
                    "保存中央値": _median(sv), "保存率中央値%": round(_median(sr), 2)}
        # 広告は #PR 表記と TikTok の広告フラグの**どちらか**（2026-09-03 決定）。
        # 片方だけを基準にすると、同じ資料の中に 2.8% と 19.8% が併存する。
        pr = [r for r in recs if is_ad(r)]
        no = [r for r in recs if not is_ad(r)]
        rows = [
            {"群": "広告（#PR表記かTikTokの広告フラグ）", **grp(pr)},
            {"群": "オーガニック", **grp(no)},
        ]
        n_pr = sum(1 for r in recs if r.get("pr_status_prelim") == "pr")
        n_flag = sum(1 for r in recs
                     if str(r.get("is_ad_platform_flag")).strip().lower() == "true")
        both = n_pr + n_flag - len(pr)
        # 露出は買えているのに保存率が下回る＝クリエイティブが刺さっていない、という読み。
        p_sr = rows[0]["保存率中央値%"]
        n_sr = rows[1]["保存率中央値%"]
        p_v = rows[0]["再生中央値"] or 0
        n_v = rows[1]["再生中央値"] or 1
        reading = None
        if pr and no:
            # 読み解きは帯に入る1文。長いと見出しと同じ文字数になり、
            # 見出しと帯で同じ95文字が2回出ていた（実測）。短く言い切る。
            # 断りは note 側に回す。
            if p_v > n_v and p_sr < n_sr:
                reading = (f"広告は再生が {p_v / n_v:.1f}倍だが、保存率は"
                           f"{p_sr / max(n_sr, 0.01):.1f}倍。露出は買えているが保存は伸びていない")
            elif p_sr >= n_sr:
                reading = (f"広告の保存率がオーガニックを上回っている"
                           f"（{p_sr}% vs {n_sr}%）")
        note = ("広告は「#PR 表記」と「TikTok 側の広告フラグ」のどちらかが"
                f"立っているものを数えている（#PR表記 {n_pr}件／"
                f"広告フラグ {n_flag}件／両方 {both}件）。"
                "率の単純比較ではなく群間の中央値比較として読む。"
                "差は出稿面や配信対象の違いでも生じるため、"
                "クリエイティブの優劣は断定しない")
        return {
            "群別": rows,
            "読み解き": reading or "広告投稿が無いため比較不可",
            "note": note,
        }

    if mid == "2-3":
        c = Counter(t for r in recs for t in (r.get("hashtags") or []))

        # 分類は正規化してから行う（大文字と小文字の違いを1つに寄せる）。
        # ただし TOP15 のランキングは生の表記のまま出す（制作の参考になるため）。
        def norm(t):
            return re.sub(r"[\s　_]+", "", str(t)).lower()

        brand_terms = {norm(x) for x in [
            cfg.get("brand"), cfg.get("keyword"), cfg.get("product"),
            *(cfg.get("keyword_variants") or []),
        ] if x}
        REACH = {"fyp", "foryou", "foryoupage", "おすすめ", "おすすめにのりたい",
                 "拡散希望", "バズりたい", "繋がりたい", "tiktok", "trend", "トレンド"}
        PR = {"pr", "ad", "sponsored", "タイアップ", "提供", "広告"}
        extra = cfg.get("hashtag_class_rules") or []   # 案件語彙（任意）

        def tag_class(tag):
            t = norm(tag)
            if t in PR:
                return "PR表記"
            if any(b and (b in t or t in b) for b in brand_terms):
                return "ブランド・商品関連"
            if t in REACH:
                return "汎用リーチ語"
            for rule in extra:
                if any(norm(term) in t for term in (rule.get("terms") or [])):
                    return rule.get("label") or "案件指定"
            return "その他"

        cls = Counter()
        other_tags = []
        for tag, n in c.items():
            k = tag_class(tag)
            cls[k] += n
            if k == "その他":
                other_tags.append((tag, n))
        appear_total = sum(cls.values())
        other_tags.sort(key=lambda x: -x[1])

        rows = [{"分類": k, "延べ出現": v, "構成比%": round(v / appear_total * 100, 1)}
                for k, v in cls.most_common()]
        note = ("ランキングは生の表記のまま、分類は表記ゆれを正規化してから集計している。"
                "PRタグの有無は表記のみの判定で広告実態は判定しない")
        if cls.get("その他", 0) / max(appear_total, 1) > 0.5:
            note += ("。『その他』が半分を超えている＝案件の語彙ルールが未整備。"
                     "confirmed_config.json の hashtag_class_rules に追加すると分類が効く")
        return {
            "タグ総数(ユニーク)": len(c),
            "分類構成比": rows,
            "TOP15": [{"タグ": f"#{k}", "本数": v, "出現率%": round(v / total * 100, 1),
                       "分類": tag_class(k)} for k, v in c.most_common(15)],
            "その他の上位": [{"タグ": f"#{t}", "本数": n} for t, n in other_tags[:8]],
            "note": note,
        }

    if mid == "4-1":
        rows = []
        for k, v in sorted(_by_axis(recs).items(), key=lambda x: -len(x[1])):
            rates = [r["saves"] / r["views"] * 100 for r in v if (r.get("views") or 0) > 0]
            rows.append({
                "軸": k, "本数": len(v),
                "保存率中央値%": round(_median(rates), 2),
                "保存数中央値": _median([r.get("saves") for r in v]),
            })
        top = sorted(recs, key=lambda r: -(r.get("saves") or 0))[:5]
        low_view = sum(1 for r in recs if (r.get("views") or 0) < 5000)
        return {
            "軸別": rows,
            "保存数TOP5": [{"投稿者": handle(r.get("creator_id")), "保存": r.get("saves"),
                            "再生": r.get("views"), "保存率%": round((r["saves"] / r["views"] * 100) if r.get("views") else 0, 2),
                            "URL": r.get("video_url")} for r in top],
            "5000再生未満の本数": low_view,
            "note": "保存率＝保存÷再生。購買意向の代理指標であり購入そのものではない。"
                    "同じ動画が複数の検索面に出るため、本数の合計は取得件数を超える。"
                    "5,000再生未満の保存率は参考値として扱う",
        }

    if mid == "4-2":
        rows = []
        for k, v in sorted(_by_axis(recs).items(), key=lambda x: -len(x[1])):
            rows.append({
                "軸": k, "本数": len(v),
                "再生中央値": _median([r.get("views") for r in v]),
                "いいね中央値": _median([r.get("likes") for r in v]),
                "保存中央値": _median([r.get("saves") for r in v]),
                "コメント中央値": _median([r.get("comments") for r in v]),
            })
        return {"軸別": rows,
                "note": "同じ動画が複数の検索面に出るため、本数の合計は取得件数を超える"
                        "（各面で1本として数えている）。母集団・撮影者が異なるため参考値。"
                        "演出との因果は断定しない"}

    if mid in ("3-3", "3-4"):
        run_dir = Path(cfg.get("_run_dir", "."))
        media = run_dir / "media"
        frames = run_dir / "frames"

        def evidence_for(vid, media_type):
            """この投稿の証拠画像を探す。動画はフレーム、写真は1枚目。"""
            fd = frames / vid
            if fd.exists():
                fs = sorted(fd.glob("f_*.jpg"))
                if fs:
                    return [{"path": str(f), "label": f.stem.replace("f_", "") + "秒"} for f in fs]
            pd = media / f"{vid}_photos"
            if pd.exists():
                ps = sorted(pd.glob("*.jpg")) + sorted(pd.glob("*.png"))
                if ps:
                    return [{"path": str(f), "label": f"{i}枚目"} for i, f in enumerate(ps, 1)]
            return []

        if mid == "3-4":
            # 保存数上位から、証拠画像が実在するものだけを代表カードにする。
            # 画像が無い投稿を「代表」として出すと証拠にならない。
            cands = sorted(recs, key=lambda r: -(r.get("saves") or 0))
            cards = []
            for r in cands:
                ev = evidence_for(r["video_id"], r.get("media_type"))
                if not ev:
                    continue
                # 1コマ目が白フェードの動画がある（実測で stddev 17〜19）。
                # そのまま代表画像にすると資料に真っ白なカードが並ぶ。
                img = next((e["path"] for e in ev if _has_content(e["path"])),
                           ev[0]["path"])
                cards.append({
                    # TikTok のハンドルは @ を付けて出す。付けないと
                    # 内部の識別子と見分けがつかない（資料の点検で誤検知した）。
                    "投稿者": handle(r.get("creator_id")),
                    "再生": r.get("views"), "保存": r.get("saves"),
                    "保存率%": round((r["saves"] / r["views"] * 100) if r.get("views") else 0, 2),
                    "形式": "写真" if r.get("media_type") == "photo" else "動画",
                    "本文": _cap(r.get("caption") or "", 40),
                    "URL": r.get("video_url"),
                    "_image": img,
                    # 自社ブランドを実例に優先して出すため（客先目線レビューで、
                    # 「勝ちパターン」の実例が競合ばかりという指摘を受けた）。
                    "_own": is_own_brand_post(r, cfg),
                })
                if len(cards) >= 4:
                    break
            if not cards:
                return None
            return {"代表カード": cards,
                    "note": "保存数の上位から、実際に動画を落として画面を確認できたものだけを"
                            "載せている。画像は投稿のままで、切り抜きや加工はしていない"}

        # 3-3: 冒頭フックの解剖。先頭フレームを秒数付きで並べる
        # 「勝ちパターン」の実例が競合ばかりという客先目線レビューの指摘を
        # 受け、自社ブランドの投稿があれば優先して主役にする。
        own_pool = [r for r in recs if is_own_brand_post(r, cfg)]
        target = None
        for pool in (sorted(own_pool, key=lambda x: -(x.get("saves") or 0)),
                     sorted(recs, key=lambda x: -(x.get("saves") or 0))):
            for r in pool:
                ev = evidence_for(r["video_id"], r.get("media_type"))
                if len(ev) >= 3:
                    target = (r, ev)
                    break
            if target:
                break
        if not target:
            return None
        r, ev = target
        # 「0000.00秒」のような内部表記ではなく、経過秒として読める形にする。
        # 動画の構成（何秒で何を見せているか）が資料から読めることが目的。
        def _sec(label):
            m2 = re.search(r"([\d.]+)\s*秒", str(label))
            if not m2:
                return str(label)
            v = float(m2.group(1))
            return f"{v:.0f}秒" if v >= 1 else "冒頭"

        picked = _pick_distinct(ev, 5, key=lambda e: e["path"])

        def _at(sec):
            """そのコマで何が起きているかを1行にする。

            秒数（「6秒」）はコマ説明にならない。誰も秒数を知りたくない。
            テロップの読み取りがあればそれを、無ければ音声の書き起こしを使い、
            **どちらから取ったかを必ず添える**（推測で補わない）。
            """
            sig = _signal_of(cfg, r.get("video_id"))
            for sp in (sig.get("ocr_spans") or []):
                try:
                    if float(sp.get("start", -1)) <= sec <= float(sp.get("end", -1)) + 0.6:
                        t = str(sp.get("text") or "").strip()
                        if len(t) >= 4:
                            return f"「{_cap(t, 24)}」", "テロップ"
                except (TypeError, ValueError):
                    continue
            best, bd = None, 99
            for a in (sig.get("asr_segments") or []):
                try:
                    dd = abs(float(a.get("start", 0)) - sec)
                except (TypeError, ValueError):
                    continue
                if dd < bd:
                    best, bd = a, dd
            if best and bd <= 3.5:
                return f"「{_cap(str(best.get('text') or ''), 24)}」", "音声"
            return None, None

        labels, srcs = [], set()
        for e in picked:
            sec = 0.0
            m3 = re.search(r"([\d.]+)", str(e["label"]))
            if m3:
                sec = float(m3.group(1))
            t, src = _at(sec)
            labels.append(t or _sec(e["label"]))
            if src:
                srcs.add(src)
        src_note = ("コマの説明は" + "と".join(sorted(srcs)) + "から取っている"
                    if srcs else "読み取り済みの言葉が無いため経過秒のみ")
        _aps = r.get("source_appearances") or []
        _ap = min((a for a in _aps if a.get("rank")),
                  key=lambda a: a.get("rank"), default={})
        return {
            # 経過秒は画像のキャプションに出るので、同じ内容の表は作らない。
            # 表と画像で同じことを2回言うと、1枚に載る情報が薄まる。
            "対象": {"投稿者": handle(r.get("creator_id")),
                     # どの検索面で何位だったかが、真似る価値の根拠になる。
                     # 一般キーワードの面に出ているなら、ブランドを替えて
                     # 同じ構成を作れば同じ面に入れる可能性がある。
                     "出た検索面": _ap.get("label") or r.get("label") or "",
                     "その面での表示順": _ap.get("rank") or r.get("rank"),
                     "検索面の種類": {"self": "自社名の検索",
                                      "competitor": "競合名の検索",
                                      "market_keyword": "一般キーワードの検索"}.get(
                                          r.get("role"), r.get("role") or ""),
                     "再生": r.get("views"), "保存": r.get("saves"),
                     "確認した区間": f"冒頭〜{_sec(picked[-1]['label'])}",
                     "URL": r.get("video_url")},
            "_images": [e["path"] for e in picked],
            "_image_labels": labels,
            "_image_seconds": [_sec(e["label"]) for e in picked],
            "_own": r in own_pool,
            "note": "1本の動画を経過秒の順に並べたもの。" + src_note +
                    ("。音声は自動書き起こしのため商品名の表記が揺れることがある"
                     if "音声" in srcs else "") + "。推測では補わない" +
                    ("" if r in own_pool else
                     "。この投稿は競合の投稿。構成の型のみを参照している"),
        }

    if mid == "6-1":
        photos = sum(1 for r in recs if r.get("media_type") == "photo")
        st = cfg.get("_stats") or {}
        out = {
            "検索で取得した本数": total,
            "うち動画投稿": total - photos,
            "うち写真投稿": photos,
            # 内部の識別子（scraper-direct 等）をそのまま出さない
            "取得方式": {
                "scraper-direct": "TikTokの検索結果を直接取得",
                "apify": "外部サービス経由で取得",
                "manual": "手作業で収集",
            }.get((cfg.get("dataset_provenance") or {}).get("method"),
                  (cfg.get("dataset_provenance") or {}).get("method") or "（不明）"),
        }
        # 「後で確定する」と書いて逃げない。実測を出す。
        if st.get("acquired_ok") is not None:
            out["媒体を取得できた本数"] = st.get("acquired_ok")
            out["媒体の取得に失敗した本数"] = st.get("acquired_failed")
            if st.get("acquired_failed_ids"):
                # 生の動画IDを資料に並べても読み手には意味が無い。
                # 追跡できるようにIDは spec に残し、資料には出さない（_ 始まりで除外）。
                out["_取得失敗の動画ID"] = list(st["acquired_failed_ids"])
        if st.get("signals") is not None:
            out["実画面を解析した本数"] = st.get("signals")
            if st.get("signals_skipped"):
                out["解析対象外"] = (f"{st['signals_skipped']}件"
                                 f"（{', '.join(st.get('signals_skipped_ids') or [])}）")
        out["note"] = ("取得に失敗した本数・解析対象外の本数を0件として扱っていない。"
                       "解析していない投稿は集計の分母に入っていない")
        return out

    return None


def key_message(mid, data, cfg=None):
    """章の一番上に置く1行。**数字を含める。**

    表から読み取らせる作りは商談で止まる。開いた瞬間に何を言えばいいかが
    分かるように、その章の結論を1行にする。データが無い章は None。
    """
    if not isinstance(data, dict):
        return None
    d = data
    cfg = cfg or {}

    def top(rows, key):
        return rows[0].get(key) if rows else None

    if mid == "1-1":
        rows = [r for r in (d.get("露出シェア") or [])
                if r.get("ブランド") != "どのブランドも出てこない投稿"]
        if len(rows) >= 2:
            a, b = rows[0], rows[1]
            own = cfg.get("brand")
            mine = next((r for r in rows if r["ブランド"] == own), None)
            if mine and mine is not a:
                # 見出しは1行に収める。折り返すと結論がひと目で読めなくなる。
                # 本数と母集団はKPIカードが出すので、ここでは順位と割合だけ言う。
                return (f"{a['ブランド']} が {a['シェア%']}% で1位、"
                        f"{mine['ブランド']} は {mine['シェア%']}% で"
                        f"{rows.index(mine) + 1}番手")
            return (f"この検索面は {a['ブランド']} が {a['シェア%']}%（{a['本数']}本）で最多。"
                    f"{b['ブランド']} が {b['シェア%']}% で続く")
    if mid == "1-2":
        n, sh = d.get("検索面に出ている本数"), d.get("露出シェア%")
        if n == 0:
            return "公式アカウントは検索面に1本も出ていない。ここが最大の伸びしろ"
        if n is not None:
            return f"公式アカウントは {total_n}本中 {n}本（{sh}%）しか出ていない" if (
                total_n := d.get("取得した全本数")) else f"公式アカウントの露出は {n}本（{sh}%）"
    if mid == "1-3":
        rows = d.get("投稿者タイプ") or []
        if rows:
            r0 = rows[0]
            uniq = d.get("ユニーク投稿者数")
            multi = d.get("複数入賞した投稿者")
            tail = f"。複数枠を取る常連が {multi}人いる" if multi else ""
            return f"この面は{r0['種別']}が {r0['構成比%']}%（{r0['本数']}本）{tail}"
    if mid == "1-5":
        p = d.get("広告比率%")
        if p is not None:
            # 「しかない」は #PR のみ（2.8%）を前提にした言い方だった。
            # 広告の定義を広げた（19.8%）ので、割合の大小で言い方を変える。
            n_ad = d.get("広告（#PR表記かTikTokの広告フラグ）")
            n_og = d.get("オーガニック")
            if p is not None and p >= 10:
                return (f"この面の {p}% は広告（{n_ad}本）。"
                        f"残る {n_og}本 は出稿なしで出ている")
            return (f"広告は {p}% しかない（{n_ad}本）。"
                    f"残る {n_og}本 は出稿なしで出ている")
    if mid == "1-6":
        # 章のデータは「再生順TOP10」で持っている。旧キー名のままだと
        # 常に None になり、見出しが章名のまま出る（実測で発生）。
        g = d.get("乖離の中央値(順位差)")
        if g is not None:
            return (f"再生の順位と表示順は中央値で {g:.0f}位ぶんズレている。"
                    "再生が多い＝上に出る、ではない")
        rows = d.get("再生順TOP10") or d.get("rows") or []
        if isinstance(rows, list) and rows:
            r0 = rows[0]
            g = r0.get("乖離")
            if g is not None:
                return (f"再生1位（{r0.get('再生'):,}回）が表示順 {r0.get('表示順')}位。"
                        "再生数を積んでも上位に出るとは限らない")
    if mid == "2-1":
        rows = d.get("軸別") or []
        if rows:
            # 実測した本数を必ず添える。10本を測って「投稿の80%」と書くと
            # 全件を測ったように読める（実測で n=10 のまま出ていた）。
            r0 = max(rows, key=lambda r: r.get("登場率%") or 0)
            n = r0.get("本数")
            hit = round((r0.get("登場率%") or 0) * (n or 0) / 100)
            return (f"「{r0.get('軸')}」で実際に確認した {n}本のうち {hit}本"
                    f"（{r0.get('登場率%')}%）がキーワードに触れている")
    if mid == "2-2":
        rows = d.get("4経路") or []
        best = max((r for r in rows if r.get("登場率%") is not None),
                   key=lambda r: r["登場率%"], default=None)
        if best:
            worst = min((r for r in rows if r.get("登場率%") is not None),
                        key=lambda r: r["登場率%"], default=None)
            tail = (f"。逆に{worst['経路']}は {worst['登場率%']}% で空いている"
                    if worst and worst is not best else "")
            return f"言葉が最も届いているのは{best['経路']}（{best['登場率%']}%）{tail}"
    if mid == "2-3":
        rows = d.get("分類構成比") or []
        if rows:
            # 「その他」が最多になることがある。それは分類が粗いという事実であって、
            # 「その他が主役」は結論にならない。意味のある分類の中の最大を出し、
            # 「その他」の割合は注記で認める（隠さない）。
            named = [r for r in rows if str(r.get("分類")) != "その他"]
            r0 = max(named or rows, key=lambda r: r.get("構成比%") or 0)
            other = next((r for r in rows if str(r.get("分類")) == "その他"), None)
            tail = (f"（分類しきれない『その他』が {other.get('構成比%')}%）"
                    if other else "")
            return (f"意味のあるタグで最も多いのは「{r0.get('分類')}」"
                    f"（{r0.get('構成比%')}%）{tail}")
    if mid == "3-1":
        hooks = d.get("冒頭の文言") or []
        if hooks:
            h0 = hooks[0]
            # 「見せ方＝冒頭フック 57%」は分類名で中身が無い。
            # フックが効くことは既知なので、実際の言葉を見出しに出す。
            return (f"上位の冒頭は具体的な言葉で始まっている。例：{h0.get('投稿者')}"
                    f"「{h0.get('冒頭の文言')}」（再生 {int(h0.get('再生') or 0):,}）")
        rows = sorted((r for r in (d.get("見せ方の割合") or [])
                       if isinstance(r.get("割合%"), (int, float))),
                      key=lambda r: -r["割合%"])
        if rows:
            r0 = rows[0]
            return f"上位に共通しているのは「{r0['見せ方']}」（{r0['母数']}本）"
    if mid == "3-2":
        rows = [r for r in (d.get("上位下位差分") or [])
                if isinstance(r.get("差分pt"), (int, float))]
        rows.sort(key=lambda r: -r["差分pt"])
        if rows and rows[0]["差分pt"] > 0:
            r0 = rows[0]
            return (f"上位と下位で最も差が出たのは「{r0['見せ方']}」"
                    f"（{r0['媒体']}：上位{r0['上位%']}% に対し下位{r0['下位%']}%）。"
                    "ここが足りていない")
    if mid == "3-3":
        t = d.get("対象") or {}
        if t:
            n = len(d.get("_images") or [])
            face = t.get("出た検索面") or ""
            kind = t.get("検索面の種類") or ""
            if "一般キーワード" in kind:
                # 一般キーワードの面に出ている投稿は、ブランドを替えれば
                # そのまま真似られる。どこで何位だったかを見出しに出す。
                return (f"「{face}」の検索面で {t.get('その面での表示順')}位に出た投稿。"
                        f"この{n}コマの組み立てはブランドを替えても使える")
            return (f"再生 {int(t.get('再生') or 0):,}回の投稿を{n}コマに割ると、"
                    "冒頭で結論・そのあと商品を1つずつ")
        n = d.get("解剖した本数") or len(d.get("秒単位フック") or [])
        if n:
            return f"上位{n}本の冒頭を秒単位で分解した"
    if mid == "3-4":
        rows = d.get("代表カード") or []
        if rows:
            r0 = max(rows, key=lambda r: r.get("保存率%") or 0)
            return (f"保存率が最も高い代表投稿は {r0.get('保存率%')}%"
                    f"（再生 {r0.get('再生'):,} / 保存 {r0.get('保存'):,}）")
    if mid == "2-4":
        rows = d.get("話題構成") or []
        if rows:
            r0 = max(rows, key=lambda r: r.get("構成比%") or 0)
            return f"この検索面は「{r0.get('話題')}」の話題が {r0.get('構成比%')}% を占める"
    if mid == "4-2":
        rows = d.get("軸別") or d.get("rows") or []
        if rows:
            # 行の並びは本数順。先頭を「最も高い」と書くと、実際の最大と食い違う
            # （実測: 先頭=コンビニスイーツ 78,800 に対し最大=コンビニ 100,100）。
            r0 = max(rows, key=lambda r: r.get("再生中央値") or 0)
            return (f"再生中央値が最も高い面は「{r0.get('軸')}」の "
                    f"{int(r0.get('再生中央値') or 0):,}回")
    if mid == "5-2":
        plans = d.get("投稿案") or []
        if plans:
            return f"上位で最も多い型は「{plans[0]['案'].split(': ')[-1]}」（{plans[0]['上位での出現']}）"
    if mid == "4-1":
        vals = [r for r in (d.get("軸別") or [])
                if isinstance(r.get("保存率中央値%"), (int, float))]
        if vals:
            mx = max(v["保存率中央値%"] for v in vals)
            tied = [v for v in vals if v["保存率中央値%"] == mx]
            lo = min(vals, key=lambda v: v["保存率中央値%"])
            # 同値を「1位」と書くと、グラフを見た2秒後に見出しの誤りが分かる
            # （実測で 0.17% が3面同値だった）。横並びなら横並びと書く。
            if len(tied) > 1:
                names = "／".join(str(v.get("軸")) for v in tied[:3])
                return (f"保存率は{len(vals)}面のうち{len(tied)}面が {mx}% で横並び"
                        f"（{names}）。最下位は {lo.get('軸')} の "
                        f"{lo['保存率中央値%']}%")
            return (f"保存率が最も高いのは「{tied[0].get('軸')}」の {mx}%。"
                    f"最下位は {lo.get('軸')} の {lo['保存率中央値%']}%")
    if mid == "4-3":
        rows = d.get("冒頭の比較") or []
        if rows:
            top = max(rows, key=lambda r: r.get("再生") or 0)
            n_b = len({str(r.get("ブランド")) for r in rows})
            return (f"同じ検索面に出た {len(rows)}本を{n_b}ブランドで並べると、"
                    f"最も伸びているのは {top.get('ブランド')} の"
                    f"「{str(top.get('冒頭の文言'))[:16]}」"
                    f"（再生 {int(top.get('再生') or 0):,}）")
    if mid == "4-4":
        return d.get("読み解き")
    if mid == "5-1":
        return d.get("投稿文1行目案") or d.get("空いている枠")
    if mid == "5-3":
        arms = d.get("テスト設計") or []
        if arms:
            a0 = arms[0]
            return f"検証すべきは「{a0['検証する要素']}」（{a0['根拠']}）"
    if mid == "1-4":
        fol = d.get("フォロワー帯") or {}
        dur = next((v for k, v in d.items() if str(k).startswith("尺帯")), {})
        if fol:
            k0 = max(fol, key=lambda k: fol[k])
            tot = sum(fol.values()) or 1
            tail = ""
            if dur:
                d0 = max(dur, key=lambda k: dur[k])
                tail = f"。尺は {d0} が最多（{dur[d0]}本）"
            return (f"この面の投稿者は {k0} が {fol[k0] / tot * 100:.0f}%"
                    f"（{fol[k0]}人）{tail}")
    if mid == "3-5":
        rows = [r for r in (d.get("競合比較") or [])
                if isinstance(r.get("差分pt"), (int, float))]
        if rows:
            # 自社が 0% の項目が最も動かしやすい。差分の大きさより先に出す。
            # 差分pt = 競合% − 自社% なので、正が大きいほど競合が上。
            zero = [r for r in rows if (r.get("自社%") or 0) == 0
                    and (r.get("競合%") or 0) > 0]
            if zero:
                names = sorted({str(r.get("見せ方")) for r in zero})
                hi = max(zero, key=lambda r: r.get("競合%") or 0)
                return (f"自社が0%なのは「{'／'.join(names[:2])}」"
                        f"（{hi.get('競合')}は {hi.get('競合%')}%）。ここが空いている")
            w = max(rows, key=lambda r: r.get("差分pt") or 0)
            return (f"競合に最も差をつけられているのは「{w.get('見せ方')}」"
                    f"（{w.get('競合')} {w.get('競合%')}% に対し自社 {w.get('自社%')}%）")
    if mid == "6-1":
        n = d.get("検索で取得した本数")
        an = d.get("実画面を解析した本数")
        if n and an is not None:
            # 見出しは1行に収める。2行に折れると下の帯にぶつかる（実測）。
            # 取得失敗の断りは注記に回す（6-1 の note に入っている）。
            return f"検索{n:,}本を取得し、うち{an}本は実画面まで確認している"
    return None


def resolve_selection(defs, status_arg, modules_arg):
    """--status / --modules をモジュールIDの並びへ展開する。"""
    by_id = {m["id"]: m for m in defs["modules"]}
    chosen, origin = [], {}

    if modules_arg:
        for mid in [x.strip() for x in modules_arg.split(",") if x.strip()]:
            if mid not in by_id:
                fail(f"未知のモジュールID: {mid}（--list で一覧を確認）")
            if by_id[mid].get("excluded"):
                # 対象外の章を黙って通すと「入力不足」に見えてしまう。理由を出して止める。
                fail(f"{mid} は対象外です: {by_id[mid].get('excluded_reason')}")
            if mid not in chosen:
                chosen.append(mid)
                origin[mid] = "明示指定"

    if status_arg:
        wanted = [x.strip() for x in status_arg.split(",") if x.strip()]
        statuses = {s["name"]: s for s in defs["statuses"]}
        statuses.update({s["id"]: s for s in defs["statuses"]})
        order = defs["default_status_order"]
        # 章順は default_status_order に従う（指定順ではなく資料としての流れを優先）
        picked = []
        for sid in order:
            for w in wanted:
                st = statuses.get(w)
                if st and st["id"] == sid and st not in picked:
                    picked.append(st)
        unknown = [w for w in wanted if w not in statuses]
        if unknown:
            fail(f"未知の営業ステータス: {', '.join(unknown)}"
                 f"（有効: {', '.join(s['name'] for s in defs['statuses'])}）")
        for st in picked:
            for mid in st["modules"]:
                if mid not in chosen:
                    chosen.append(mid)
                    origin[mid] = f"{st['name']}"
                elif st["name"] not in origin[mid]:
                    origin[mid] += f" / {st['name']}"

    # ⑥ 透明性は常に付与する（信頼担保なので外させない）
    for m in defs["modules"]:
        if m.get("always") and m["id"] not in chosen:
            chosen.append(m["id"])
            origin[m["id"]] = "自動付与（透明性）"

    return chosen, origin


def main():
    ap = argparse.ArgumentParser(description="モジュールを選んで資料仕様を組み立てる")
    ap.add_argument("--run-dir")
    ap.add_argument("--status", help="営業ステータス名かID。カンマ区切りで複数可")
    ap.add_argument("--modules", help="モジュールIDをカンマ区切りで（例 1-1,3-2）")
    ap.add_argument("--list", action="store_true", help="モジュール一覧を表示して終了")
    ap.add_argument("--out", help="deck_spec.json の保存先（既定は run-dir 直下）")
    args = ap.parse_args()

    defs = load_modules()

    if args.list:
        print("── 営業ステータス → モジュール展開 ──")
        for s in defs["statuses"]:
            mark = "（単独資料）" if s.get("independent") else ""
            print(f"  {s['id']}. {s['name']:8s} {mark}  → {', '.join(s['modules'])}")
            print(f"      目的: {s['purpose']}")
        print("\n── モジュール一覧 ──")
        cur = None
        for m in defs["modules"]:
            if m["group"] != cur:
                cur = m["group"]
                g = defs["groups"][cur]
                print(f"\n  【{cur}】{g['name']}（{g['subtitle']}）")
            flags = []
            if m.get("star"):
                flags.append("★最重要")
            if m.get("always"):
                flags.append("常に付与")
            if m.get("pending"):
                flags.append("内容整理中")
            print(f"    {m['id']}  {m['name']} {' '.join(flags)}")
        return

    if not args.run_dir:
        fail("--run-dir が必要です（--list はデータ不要）")
    if not args.status and not args.modules:
        fail("--status か --modules のどちらかを指定してください")

    run_dir = Path(args.run_dir).expanduser().resolve()
    if not run_dir.exists():
        fail(f"run-dir がありません: {run_dir}")

    avail, stats, cfg, _recs_cache = detect_inputs(run_dir)
    cfg["_run_dir"] = str(run_dir)   # 証拠画像の探索に使う
    # 6-1 が取得実績を出すために stats を渡す（後で確定するとは書かない）
    cfg["_stats"] = stats
    _ext_cache = load_external(run_dir, stats.get("signal_ids"))
    chosen, origin = resolve_selection(defs, args.status, args.modules)
    by_id = {m["id"]: m for m in defs["modules"]}

    chapters, blocked, pending = [], [], []
    for mid in chosen:
        m = by_id[mid]
        missing = [k for k in (m.get("needs") or []) if not avail.get(k)]
        ch = {
            "id": mid,
            "group": m["group"],
            "group_name": defs["groups"][m["group"]]["name"],
            "name": m["name"],
            "shows": m["shows"],
            "metrics": m["metrics"],
            "output": m["output"],
            "caveat": m.get("caveat"),
            "selected_by": origin[mid],
            "status": "ready" if not missing else "blocked",
            "missing_inputs": [defs["input_labels"].get(k, k) for k in missing],
        }
        if m.get("star"):
            ch["priority"] = "★最重要"
        if m.get("pending"):
            ch["pending_note"] = m["pending"]
            pending.append(mid)
        # 入力が足りている章は、この場で実数まで計算する
        if not missing:
            data = compute_module(mid, _recs_cache, cfg)
            if data is None:
                # videos.jsonl だけでは出せない章は、外部スクリプトの出力から作る
                data = compute_from_external(mid, _ext_cache, cfg, _recs_cache)
                if data is not None:
                    ch["data_source"] = "external"
            else:
                ch["data_source"] = "videos.jsonl"
            if data is not None:
                ch["data"] = data
                ch["computed"] = True
                km = key_message(mid, data, cfg)
                if km:
                    ch["key_message"] = km
            else:
                ch["computed"] = False
                # ⑥（数え方の定義・読み取り注意）は静的文言でデータを持たないのが正しい。
                # それ以外で data が無いのは「計算できなかった」ので ready のままにしない。
                # ready で中身が空だと、空欄の章が資料に混ざって「分析済み」に見える。
                if m.get("static"):
                    ch["compute_note"] = "静的な前提説明のため数値計算は不要"
                else:
                    ch["status"] = "blocked"
                    reason = ("内容を整理中のため、この章はまだ確定していません"
                              if m.get("pending")
                              else "今回取得したデータの範囲では、この章に必要な"
                                   "情報が見つかりませんでした")
                    ch["compute_note"] = reason
                    ch["missing_inputs"] = ch["missing_inputs"] or [reason]
                    blocked.append({"id": mid, "name": m["name"],
                                    "missing": ch["missing_inputs"]})
        chapters.append(ch)
        if missing:
            blocked.append({"id": mid, "name": m["name"], "missing": ch["missing_inputs"]})

    spec = {
        "ok": True,
        "built_at": datetime.now(JST).isoformat(),
        "run_dir": str(run_dir),
        "keyword": stats["keyword"],
        "brand": stats["brand"],
        "selection": {"status": args.status, "modules": args.modules, "resolved": chosen,
                      # 本編に置く章。残りは付録に回す（章は消さない）。
                      "core": sorted({m for st in defs["statuses"]
                                      for m in (st.get("core") or [])
                                      if args.status and (st["name"] in str(args.status)
                                                          or str(st.get("id")) == str(args.status))}
                                     or chosen, key=chosen.index)},
        "dataset": stats,
        # 自社に当たる検索軸。ブランド名と検索語は表記が違う（ファミリーマート / ファミマ）ので
        # 資料側で推測させず、取得時の role からここで確定させる。
        # 検索軸ごとの役割（self / competitor / market_keyword）。
        # 資料の色分けをこれで決める。軸の名前から推測させない。
        "axis_roles": {r.get("label"): r.get("role")
                       for r in _recs_cache if r.get("label") and r.get("role")},
        "self_axis": next((r.get("label") for r in _recs_cache
                           if r.get("role") == "self" and r.get("label")), None),
        # 実画面まで確認できた投稿。資料のカードはここからだけ引く。
        "showcase": build_showcase(_recs_cache, cfg),
        "available_inputs": avail,
        "chapters": chapters,
        "summary": {
            "total": len(chapters),
            "ready": sum(1 for c in chapters if c["status"] == "ready"),
            "blocked": len(blocked),
            "pending": len(pending),
            "computed": sum(1 for c in chapters if c.get("computed")),
        },
        "blocked_detail": blocked,
        # 資料に必ず載せる注記。ここを落とすと数字の前提が失われる。
        "mandatory_notes": [
            "並び順は再生数順ではなく TikTok の検索アルゴリズム順（取得時点のスナップショット）",
            "広告は「#PR 表記」と「TikTok 側の広告フラグ」のどちらかが立っているものを"
            "数えている。表記と配信面の記録の双方を見ているが、"
            "広告実態・景表法適合そのものを判定したものではない",
            "取得できなかった投稿を0件として集計しない",
            "再生・保存と演出の因果は断定しない（上位群に多い傾向として示している）",
        ],
    }
    if stats.get("signals_skipped"):
        # 解析対象外を「未計測」と混ぜない。分母が食い違って見える原因になる。
        spec["mandatory_notes"].append(
            f"媒体が長すぎる等で解析対象外にした投稿が {stats['signals_skipped']} 件ある"
            "。集計の分母に入っていない"
        )
    if stats.get("acquired_failed"):
        spec["mandatory_notes"].append(
            f"媒体の取得に失敗した投稿が {stats['acquired_failed']} 件ある。"
            "0件として扱わず、集計の分母から外している"
        )
    if stats["telop_unmeasured"]:
        spec["mandatory_notes"].append(
            f"テロップは {stats['telop_measured']}/{stats['signals']} 件のみ計測済み。"
            f"残り {stats['telop_unmeasured']} 件は未計測（0件ではない）"
        )
    if stats["provenance"] == "scraper-direct":
        spec["mandatory_notes"].append(
            "データは TikTok の検索結果を直接取得したもの（非ログイン状態の表示順）。"
            "ログイン状態で見た検索結果とは並びが異なることがあるため、"
            "今回と同じ条件（非ログイン）で再取得すれば前後を比較できる"
        )

    out = Path(args.out).expanduser() if args.out else (run_dir / "deck_spec.json")
    out.write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── 人が読む形の要約 ──
    print(f"■ 資料仕様を組み立てました: {out}")
    print(f"  キーワード: {stats['keyword']} / ブランド: {stats['brand'] or '(未指定)'}")
    print(f"  データ: {stats['videos']}件（動画 {stats['video_posts']} / 写真 {stats['photo_posts']}）"
          f" 軸: {', '.join(stats['roles']) or '(なし)'}")
    print(f"  章: 全{spec['summary']['total']}  実行可 {spec['summary']['ready']}"
          f"  入力不足 {spec['summary']['blocked']}  内容整理中 {spec['summary']['pending']}")
    print()
    cur = None
    for c in chapters:
        if c["group"] != cur:
            cur = c["group"]
            print(f"  【{cur}】{c['group_name']}")
        mark = {"ready": "✅", "blocked": "⛔"}[c["status"]]
        extra = f"  ← 不足: {', '.join(c['missing_inputs'])}" if c["missing_inputs"] else ""
        star = " ★" if c.get("priority") else ""
        pend = " （内容整理中）" if c.get("pending_note") else ""
        print(f"    {mark} {c['id']} {c['name']}{star}{pend}")
        print(f"        選定理由: {c['selected_by']}{extra}")
    if blocked:
        print()
        print("  ⛔ 入力が足りない章は落とさず残しています。埋めてから再実行してください。")
        print("     章を黙って消すと『分析していない』ことが資料から見えなくなります。")


if __name__ == "__main__":
    main()
