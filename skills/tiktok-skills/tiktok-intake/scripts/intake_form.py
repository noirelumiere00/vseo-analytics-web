#!/usr/bin/env python3
"""営業が会話の前に情報を先出しするための受け皿（ターン0）。

営業が既に分かっている場合、会話で1つずつ聞くのは遅い。
このスクリプトは**貼り付けた自由文**から必要項目を拾い、
「先出しで埋まったもの」と「まだ聞くもの」に分ける。

    python3 intake_form.py --template                 # 貼り付け用テンプレを出す
    python3 intake_form.py --text "$(cat memo.txt)"   # 自由文から拾う
    python3 intake_form.py --file memo.txt --run-dir <run-dir>

**先出しは必須ではない。** 空でも会話（ターン1〜3）で埋められる。
埋まった項目はターン3で聞き返さない。埋まっていない項目だけ聞く。
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 項目名の表記ゆれを1つに寄せる。営業が書きそうな言い方を全部受ける。
FIELDS = {
    "company": ["会社", "会社名", "クライアント", "client", "訪問先", "企業", "企業名",
                "対象ブランド", "ブランド", "brand"],
    "purpose": ["目的", "用途", "なにをしたい", "何をしたい", "背景", "商談", "シーン", "purpose"],
    "product": ["対象商品", "商材", "商品", "サービス", "product", "取扱"],
    "status": ["作りたい資料／章", "作りたい資料/章", "作りたい資料", "作る資料",
               "ステータス", "資料", "章", "種類", "type", "status"],
    "keywords": ["一般検索キーワード", "一般キーワード", "検索キーワード",
                 "キーワード", "検索kw", "kw", "検索語", "keyword", "keywords"],
    "competitors": ["競合", "競合他社", "比較対象", "競合社", "competitor", "competitors"],
    "official_tiktok": ["公式tiktokアカウントurl", "公式tiktokアカウント", "公式tiktok",
                        "公式アカウント", "公式ティックトック", "tiktok", "official"],
    "official_site": ["公式サイトurl", "公式サイト", "hp", "ホームページ", "サイト", "site"],
    "campaign_start": ["施策開始", "施策開始日", "開始日", "実施日", "配信開始"],
    "period": ["期間", "対象期間", "レポート期間"],
    "deadline": ["納期", "提出日", "訪問日", "商談日", "いつまで"],
    "output_format": ["希望形式", "形式", "出力形式", "フォーマット", "format"],
    "instruction": ["指示", "備考", "その他", "要望"],
}
# ステータスの表記ゆれ → modules.json のキー
STATUS_ALIASES = {
    "初訪": ["初訪", "初回", "初回訪問", "はじめて", "初アポ", "1", "①"],
    "具体提案": ["具体提案", "具体", "打ち手", "提案", "2", "②"],
    "構成提案": ["構成提案", "構成", "企画", "台本", "3", "③"],
    "レポート": ["レポート", "効果検証", "振り返り", "報告", "4", "④"],
    "競合差再提案": ["競合差再提案", "競合差", "再提案", "5", "⑤"],
}
MULTI = {"keywords", "competitors"}          # 複数値を取る項目
# 依頼票フォームは空欄を「AIに任せる」と書き出す。これは値ではなく委任の意思表示なので、
# 埋まっていない扱いにして自動導出へ回す。ここを値として扱うと検索語が「AIに任せる」になる。
DELEGATED = {"aiに任せる", "ai に任せる", "任せる", "おまかせ", "お任せ",
             "未定", "わからない", "分からない", "不明", "なし", "-", "ー", "—"}
SPLIT_RE = re.compile(r"[、,／/\n・]|\s{2,}")

# 型ごとに必要な入力。ただし「必要」と「営業に聞くしかない」は別物なので分けて持つ。
NEEDED_BY_STATUS = {
    "初訪": ["keywords", "competitors", "official_tiktok"],
    "具体提案": ["keywords"],
    "構成提案": ["keywords"],
    "レポート": ["keywords", "campaign_start", "period", "baseline"],
    "競合差再提案": ["keywords", "competitors"],
}
# AIが公式サイト・Web検索・取得データから候補を出せる項目。営業に質問を投げない。
DERIVABLE = {"keywords", "competitors", "official_tiktok", "official_site"}
# 社内の実施情報でTikTok側に存在しない＝聞くしか手段が無い項目（④レポートのみ）。
MUST_ASK = {"campaign_start", "period", "baseline"}
LABEL_JA = {
    "company": "対象ブランド", "purpose": "目的", "product": "対象商品", "status": "作る資料",
    "keywords": "一般検索キーワード", "competitors": "競合", "official_tiktok": "公式TikTokアカウントURL",
    "official_site": "公式サイトURL", "campaign_start": "施策開始日", "period": "対象期間",
    "deadline": "納期", "baseline": "施策前スナップショット",
    "output_format": "希望形式", "instruction": "指示",
}

TEMPLATE = """対象ブランド：
対象商品：
公式サイトURL：
公式TikTokアカウントURL：（無ければ「無し」）
一般検索キーワード：
作りたい資料／章：
希望形式：PPTX＋PDF
指示：この内容で資料を作成してください
"""

def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def canon_key(raw: str):
    """行頭のラベルを正規化キーに寄せる。長いエイリアスから当てる（部分一致の取り違え防止）。"""
    k = re.sub(r"[\s　*\-–—•・#>]+", "", raw).strip().lower().rstrip(":：=")
    best = None
    for field, aliases in FIELDS.items():
        for a in aliases:
            if k == a or (len(a) >= 2 and a in k):
                # より長いエイリアスに当たったほうを採用する
                if best is None or len(a) > best[1]:
                    best = (field, len(a))
    return best[0] if best else None


def canon_status(v: str):
    t = re.sub(r"\s+", "", v)
    for status, aliases in STATUS_ALIASES.items():
        for a in aliases:
            if a in t:
                return status
    return None


def infer_status(text: str):
    """散文から資料の型を推定する。02-analyze の推定エンジンがあればそれを使う。

    自前の `canon_status` は「初訪:」のようにラベルが付いた行しか拾えないため、
    「TOTOに初回訪問で行くけど資料作れる？」のような一文では未確定に落ちていた。
    """
    import subprocess
    for cand in [HERE.parent.parent / "02-analyze/scripts/route_sales_request.py",
                 Path.home() / ".claude/skills/tiktok-analyze/scripts/route_sales_request.py"]:
        if not cand.exists():
            continue
        try:
            proc = subprocess.run([sys.executable, str(cand), "--request", text],
                                  capture_output=True, text=True, timeout=30)
            d = json.loads(proc.stdout)
            if d.get("status_name"):
                return d["status_name"], d.get("confidence"), bool(d.get("needs_clarification"))
        except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
            pass
        break
    # 推定エンジンが使えない場合は別名表で最低限拾う
    s = canon_status(text)
    return (s, None, True) if s else (None, None, True)


def parse(text: str):
    """自由文から項目を拾う。ラベル: 値 の形を基本に、コメント(#)は落とす。"""
    got, unknown = {}, []
    for line in text.splitlines():
        line = re.sub(r"\s+#.*$", "", line).strip()   # 行末コメントを落とす
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(.{1,20}?)\s*[:：=]\s*(.*)$", line)
        if not m:
            unknown.append(line)
            continue
        key, val = canon_key(m.group(1)), m.group(2).strip()
        val = re.sub(r"^[（(].*?[）)]\s*", "", val).strip()   # 「（無ければ「無し」）」等の注記を落とす
        low = val.strip().strip("「」\"'").lower()
        if key == "official_tiktok" and low in ("無し", "なし", "無い", "ない", "存在しない", "none"):
            # 公式アカウントが存在しないこと自体が訴求材料になる。事実として保持する。
            got["official_tiktok_absent"] = True
            val = ""
        elif low in DELEGATED:
            val = ""          # 委任＝未入力として自動導出に回す
        if not key or not val:
            if not key and val:
                unknown.append(line)
            continue
        if key in MULTI:
            vals = [v.strip() for v in SPLIT_RE.split(val) if v.strip()]
            got.setdefault(key, [])
            got[key] += [v for v in vals if v not in got[key]]
        elif key == "status":
            s = canon_status(val)
            got["status"] = s or val
            if not s:
                got["status_unrecognized"] = val
        else:
            got.setdefault(key, val)
    return got, unknown


def notes_for(got):
    """先出しの内容から、そのまま提案材料になる事実を拾う。"""
    n = []
    if got.get("official_tiktok_absent"):
        n.append("公式TikTokアカウントが無いと確定しています。"
                 "『検索面に公式が1本も出ていない』は初回訪問で最も効く訴求材料になります")
    if (got.get("output_format") or "").upper().find("PDF") >= 0:
        n.append("PDFも希望。PPTXを出したあと変換を試み、できない環境なら"
                 "PowerPoint の「ファイル→エクスポート」手順を案内します（既定はPPTXのみ）")
    return n


def warnings_for(got):
    """先出しされていても危ないものを指摘する。埋まっている＝正しいとは限らない。"""
    w = []
    kws = got.get("keywords") or []
    company = got.get("company") or ""
    if kws and company:
        base = re.sub(r"(株式会社|\(株\)|㈱|会社|Inc\.?|Corp\.?)", "", company).strip()
        if base and all(base.lower() in k.lower() or k.lower() in base.lower() for k in kws):
            w.append("検索キーワードがブランド名だけです。まだ知らない人が検索する"
                     "**一般名詞**（例: トイレリフォーム）を足すと提案の材料が増えます")
    if got.get("status") == "レポート" and not got.get("campaign_start"):
        w.append("レポートは施策開始日が要ります。**施策前のデータは後から遡れません**。"
                 "施策が未開始なら今日のうちにスナップショットを取ってください")
    if got.get("status_unrecognized"):
        w.append(f"『{got['status_unrecognized']}』はどの型か判別できませんでした。"
                 "ターン2で5つの型から選び直してください")
    if len(got.get("competitors") or []) == 1:
        w.append("競合が1社です。露出シェアは2社以上あると読みやすくなります")
    return w


def main():
    ap = argparse.ArgumentParser(description="会話の前に情報を先出しする（ターン0）")
    ap.add_argument("--text", help="自由文をそのまま渡す")
    ap.add_argument("--file", help="自由文の入ったファイル")
    ap.add_argument("--template", action="store_true", help="貼り付け用テンプレを出す")
    ap.add_argument("--run-dir", help="intake.json を書き出す先")
    ap.add_argument("--json", action="store_true", help="JSON で出す")
    args = ap.parse_args()

    if args.template:
        print(TEMPLATE)
        return
    if not args.text and not args.file:
        fail("--text か --file か --template を指定してください")

    text = args.text or Path(args.file).expanduser().read_text(encoding="utf-8")
    got, unknown = parse(text)

    status = got.get("status") if got.get("status") in NEEDED_BY_STATUS else None
    inferred = None
    if not status:
        # 依頼票で「わからない」が選ばれた場合も含め、依頼文の全体から推定する
        cand, conf, needs_q = infer_status(text)
        if cand in NEEDED_BY_STATUS:
            status, inferred = cand, {"status": cand, "confidence": conf,
                                      "needs_confirmation": needs_q}
    needed = NEEDED_BY_STATUS.get(status) if status else None
    # ステータス未確定なら、どの型でも要る keywords だけを共通の不足として見る
    check = needed if needed else ["keywords"]
    filled = [k for k in check if got.get(k)]
    gap = [k for k in check if not got.get(k)]
    derive = [k for k in gap if k in DERIVABLE]        # AIが候補を出す
    if got.get("official_tiktok_absent") and "official_tiktok" in derive:
        derive.remove("official_tiktok")               # 無いと確定＝探さない
    missing = [k for k in gap if k in MUST_ASK]        # 営業に聞くしかない

    result = {
        "fields": {k: v for k, v in got.items()
                   if k not in ("status_unrecognized", "official_tiktok_absent")},
        "official_tiktok_absent": bool(got.get("official_tiktok_absent")),
        "status": status,
        "status_confirmed": bool(status) and not inferred,
        "status_inferred": inferred,
        "inputs": {"filled": filled, "ai_derives": derive, "must_ask": missing},
        "warnings": warnings_for(got),
        "notes": notes_for(got),
        "unparsed_lines": unknown,
        "note": "先出しは任意。missing はターン3で会話で聞く。filled は聞き返さない",
    }
    if args.run_dir:
        rd = Path(args.run_dir).expanduser()
        rd.mkdir(parents=True, exist_ok=True)
        (rd / "intake.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        result["saved"] = str(rd / "intake.json")

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print("■ 先出しで受け取ったもの")
    for k, v in result["fields"].items():
        print(f"  ・{LABEL_JA.get(k, k)}: {', '.join(v) if isinstance(v, list) else v}")
    if not result["fields"]:
        print("  （なし。ターン1から会話で聞きます）")
    print()
    if inferred:
        c = inferred.get("confidence")
        q = "（確認が必要）" if inferred.get("needs_confirmation") else "（確認だけ取れば進めます）"
        print(f"■ 作る資料: {status} ← 依頼文から推定 confidence={c} {q}")
    else:
        print(f"■ 作る資料: {status or '未確定 → 5つの型から選ばせる'}")
    print()
    if derive:
        print("■ AIが調べて候補を出す（営業には聞かない）")
        for k in derive:
            print(f"  🤖 {LABEL_JA.get(k, k)}")
    if missing:
        print("\n■ 営業に聞くしかない（TikTok側に存在しない情報）")
        for k in missing:
            print(f"  ⛔ {LABEL_JA.get(k, k)}")
    if not derive and not missing:
        print("■ 追加で必要なものはありません。そのまま取得に進めます")
    if filled:
        print(f"\n  ✅ 先出し済みなので聞き返さない: "
              f"{', '.join(LABEL_JA.get(k, k) for k in filled)}")
    if result["notes"]:
        print("\n■ 先出しから分かったこと")
        for n in result["notes"]:
            print(f"  ・{n}")
    if result["warnings"]:
        print("\n■ 先出しされていても確認したいこと")
        for w in result["warnings"]:
            print(f"  ⚠️ {w}")
    if unknown:
        print(f"\n■ 拾えなかった行（{len(unknown)}件）— 会話で確認する")
        for u in unknown[:5]:
            print(f"  ? {u}")


if __name__ == "__main__":
    main()
