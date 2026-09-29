#!/usr/bin/env python3
"""営業が会話の前に情報を先出しするための受け皿（ターン0）。

営業が既に分かっている場合、会話で1つずつ聞くのは遅い。
このスクリプトは**貼り付けた依頼票（自由文でも可）**から必要項目を拾い、
「先出しで埋まったもの」と「まだ聞くもの」に分ける。

    python3 intake_form.py --template                 # 貼り付け用テンプレを出す
    python3 intake_form.py --template 初訪            # 初訪（選択式）のテンプレ
    python3 intake_form.py --file memo.txt --run-dir <run-dir>
    python3 intake_form.py --file - --run-dir <run-dir> < memo.txt   # 標準入力から読む
    python3 intake_form.py --file memo.txt --case-json <案件ディレクトリ>   # case.json の下書きを書く
    python3 intake_form.py --selftest                 # 項目名の取り違えが無いかの自己検査

貼られた依頼票は**ファイル（または標準入力）で渡す**。`--text "<貼った文>"` でシェルに埋め込むと、
依頼票の中の `"` `$` バッククォートでクォートが壊れたり、`$5000` が `000` に化けたりする（2026-09 監査で再現）。

**先出しは必須ではない。** 空でも会話（ターン1〜3）で埋められる。
埋まった項目はターン3で聞き返さない。埋まっていない項目だけ聞く。

初訪は選択式（2026-09 上長FB: 担当者が変わっても出力品質を揃える）。
case.json に流すのは**選択肢と事実（社名・ID・日付）だけ**で、自由記述（目的・指示）は流さない。
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 項目名の表記ゆれを1つに寄せる。営業が書きそうな言い方を全部受ける。
# 当て方は「ラベルに含まれる最長のエイリアス」。だから「競合」を含む別項目
# （競合の検索のしかた 等）には「競合」より長いエイリアスを必ず持たせる（--selftest で検査）。
FIELDS = {
    "company": ["会社", "会社名", "クライアント", "client", "訪問先", "企業", "企業名",
                "対象ブランド", "ブランド", "brand"],
    "company_short": ["対象ブランド略称", "ブランド略称", "クライアント略称", "自社略称"],
    "recipient": ["宛名", "宛先", "recipient"],
    "purpose": ["目的", "用途", "なにをしたい", "何をしたい", "背景", "商談", "シーン", "purpose"],
    "product": ["対象商品", "商材", "商品", "サービス", "product", "取扱"],
    "focus_products": ["注力商品", "重点商品", "focus_products"],
    # 「資料」「章」だけの別名は持たない。「参考資料」「過去の提案資料」「資料の形式」まで
    # 型の欄として読み、URL 中の 2024 の「2」で明示した初訪が具体提案に上書きされていた（2026-09 監査）
    "status": ["作りたい資料／章", "作りたい資料/章", "作りたい資料", "作る資料", "資料の種類",
               "資料の型", "資料種別", "ステータス", "種類", "型", "type", "status"],
    "vocab": ["業種", "業種プリセット", "語彙プリセット", "vocab"],
    "category": ["カテゴリ名", "カテゴリー名", "カテゴリ", "カテゴリー", "category"],
    "keywords": ["一般検索キーワード", "一般キーワード", "検索キーワード",
                 "キーワード", "検索kw", "kw", "検索語", "keyword", "keywords"],
    "competitors": ["競合", "競合他社", "比較対象", "競合社", "競合ブランド", "competitor", "competitors"],
    "brand_query": ["競合の検索のしかた", "競合の検索方法", "競合検索のしかた", "競合の検索", "brand_query"],
    "own_search": ["自社の検索", "自社検索", "own_search"],
    # 「公式アカウント」「tiktok」「official」だけの別名は持たない。「Instagram公式アカウント」
    # 「競合の公式アカウント」「TikTok上の狙い」が自社の公式TikTokとして取り込まれ、
    # 他社のアカウントで自社の公式露出を数えかねなかった（2026-09 監査）。TikTok と書いてある欄だけ受ける
    "official_tiktok": ["公式tiktokアカウントurl", "公式tiktokアカウント", "公式tiktok", "tiktok公式",
                        "tiktokアカウント", "tiktokurl", "公式ティックトック", "official_tiktok"],
    "official_site": ["公式サイトurl", "公式サイト", "ブランドサイト", "hp", "ホームページ", "サイト", "site"],
    "campaign_start": ["施策開始", "施策開始日", "開始日", "実施日", "配信開始"],
    "period": ["期間", "対象期間", "レポート期間"],
    # フォームは「施策前スナップショット：ある／ない」を書き出すが、受け皿が無く
    # 「拾えなかった行」に落ちて、書いたのに毎回聞き返していた（2026-09 監査）
    "baseline": ["施策前スナップショット", "施策前のデータ", "施策前データ", "施策前の記録",
                 "基準データ", "baseline"],
    # 構成提案・競合差再提案で「社内でしか分からない」入力（status-output-spec の必須入力）
    "campaign_goal": ["目的とcta", "施策目的", "投稿目的", "cta", "campaign_goal"],
    "creative_constraints": ["制作条件", "表現条件", "尺本数", "尺と本数", "必須表現", "禁止表現",
                             "ngワード", "ブランドトーン", "トンマナ", "レギュレーション",
                             "creative_constraints"],
    "reproposal_context": ["再提案の背景", "再提案背景", "再提案の理由", "失注理由", "前回提案",
                           "前回の提案", "reproposal_context"],
    "deadline": ["納期", "提出日", "いつまで"],
    "visit_date": ["訪問日", "商談日", "アポ日", "visit_date"],
    "reviewer": ["前日レビュー担当", "レビュー担当", "前日チェック担当", "reviewer"],
    "output_format": ["希望形式", "形式", "出力形式", "フォーマット", "format"],
    "instruction": ["指示", "備考", "その他", "要望"],
}
# 「競合」「他社」を冠したラベルは、競合の欄（と競合の検索のしかた）にしか入れない。
# 最長一致だけだと「競合商品」が対象商品に、「競合の公式アカウント」が自社の公式に入っていた
COMPETITOR_LABEL_RE = re.compile(r"競合|他社")
COMPETITOR_LABELS = {"競合", "競合他社", "他社", "比較対象", "競合社", "競合ブランド", "競合企業",
                     "競合会社", "競合名", "競合一覧", "競合候補", "competitor", "competitors"}
# TikTok 以外の媒体の欄。公式サイト・公式TikTok のどちらにも入れない（会話で確認する）
OTHER_PLATFORM_RE = re.compile(r"instagram|インスタ|youtube|ユーチューブ|twitter|ツイッター|"
                               r"facebook|フェイスブック|threads|pinterest|ピンタレスト")

# ステータス（資料の型）。値の全体、または区切った1つずつと**完全一致**したときだけ当てる。
# 以前は部分一致で辞書順に当てていたため、具体提案の別名「提案」が「構成提案」「競合差再提案」の
# 中に当たり、依頼票で選んだ型が具体提案にすり替わったうえで「確定」扱いになっていた。
# 数字の「1」〜「5」も部分一致で、章ID（4-4）・日付（8/1）・URL の 2024 が別の型になっていた（2026-09 監査）。
# 別名は generate.js の MODES.alias と揃える（quick / deep / full / 提案 / 構成 / 競合差 / 再提案 / report / 効果測定）
STATUS_NAMES = ("初訪", "具体提案", "構成提案", "レポート", "競合差再提案")
STATUS_ALIASES = {
    "初訪": ["初訪", "初回", "初回訪問", "初回商談", "初回アポ", "初アポ", "はじめて", "quick"],
    "具体提案": ["具体提案", "具体", "提案", "deep", "full"],
    "構成提案": ["構成提案", "構成", "企画", "台本"],
    "レポート": ["レポート", "効果検証", "効果測定", "振り返り", "報告", "report"],
    "競合差再提案": ["競合差再提案", "競合差", "再提案"],
}
STATUS_BY_NUM = {str(i): s for i, s in enumerate(STATUS_NAMES, 1)}
# 型を並べるときの区切り（「初訪,競合差再提案」「①初訪と⑤競合差再提案」「1＋5」）
STATUS_LIST_SPLIT_RE = re.compile(r"[,、，+/&]|と|および|及び|ならびに")
# modules.json の章ID（1-1〜6-3）。型ではないので status には入れない
CHAPTER_ID_RE = re.compile(r"(?<![0-9])([1-6]-[1-9])(?![0-9])")
MULTI = {"keywords", "competitors", "focus_products"}          # 複数値を取る項目
# 依頼票フォームは空欄を「AIに任せる」と書き出す。これは値ではなく委任の意思表示なので、
# 埋まっていない扱いにして自動導出へ回す。ここを値として扱うと検索語が「AIに任せる」になる。
# 「無し」「特になし」も値ではない（検索語「無し」で取得が走っていた。2026-09 監査）
DELEGATED = {"aiに任せる", "ai に任せる", "任せる", "おまかせ", "お任せ",
             "未定", "わからない", "分からない", "不明", "なし", "無し", "無い", "ない",
             "特になし", "特に無し", "-", "ー", "—", "未選択"}
# そのうち「任せる」の意思表示。競合は黙って決めないが、任せると書かれたときだけ候補を出してよい
DELEGATE_WORDS = {"aiに任せる", "ai に任せる", "任せる", "おまかせ", "お任せ"}
# 検索語の区切り。中黒では割らない（「キッチン・バス リフォーム」が2語に割れていた。2026-09 監査）
SPLIT_RE = re.compile(r"[、,，／/\n]|\s{2,}")
# 社名・商品名は「コカ・コーラ」のように中黒を含むので、中黒では割らない
NAME_SPLIT_RE = re.compile(r"[、,，／/\n]|\s{2,}")
# フォームが書き出す定型文。値ではないので「拾えなかった行」に出さない
BOILERPLATE = ("TikTok分析をお願いします", "「AIに任せる」の欄は", "空欄が残っていても",
               "初訪は選択式の依頼票です", "「想定」の競合は")

# 型ごとに必要な入力。ただし「必要」と「営業に聞くしかない」は別物なので分けて持つ。
NEEDED_BY_STATUS = {
    # 初訪（2026-09 再設計）: 業種・カテゴリ名・競合（軸B）・公式TikTok。
    # 旧初訪（自社公式の露出・フォロワー帯）は廃止。一般検索キーワードはカテゴリ名で代える。
    "初訪": ["vocab", "category", "competitors", "official_tiktok"],
    "具体提案": ["keywords"],
    # status-output-spec の必須入力のうち、社内でしか分からないもの（目的とCTA・尺/本数・必須/禁止表現）
    "構成提案": ["keywords", "campaign_goal", "creative_constraints"],
    "レポート": ["keywords", "campaign_start", "period", "baseline"],
    # 競合差再提案は競合1社以上と「再提案の背景と今回決めたいこと」が必須（status-output-spec）
    "競合差再提案": ["keywords", "competitors", "reproposal_context"],
}
# AIが公式サイト・Web検索・取得データから候補を出せる項目。営業に質問を投げない。
# 競合は入れない。SKILL.md は「競合を黙ってAIが決める」を禁じているのに、ここで 🤖 に分類して
# 「AIが調べて候補を出す（営業には聞かない）」と指示していた（2026-09 監査）。競合の選定は営業の仕事
DERIVABLE = {"keywords", "official_tiktok", "official_site", "category"}
# 社内の実施情報でTikTok側に存在しない＝聞くしか手段が無い項目（④レポート）。
MUST_ASK = {"campaign_start", "period", "baseline"}
# 型ごとに「聞くしかない」扱いにする項目。初訪の業種は資料の語彙を決める選択で、
# 競合は資料の軸B。AIの推測で埋めると担当者ごとに資料がぶれるので聞く（ただし止めない）。
# 構成提案の目的・制作条件、競合差再提案の背景は社内情報で、推測で埋めると別の資料になる
MUST_ASK_BY_STATUS = {
    "初訪": {"vocab", "competitors"},
    "構成提案": {"campaign_goal", "creative_constraints"},
    "競合差再提案": {"competitors", "reproposal_context"},
}
LABEL_JA = {
    "company": "対象ブランド", "company_short": "対象ブランド略称", "recipient": "宛名",
    "purpose": "目的", "product": "対象商品", "focus_products": "注力商品", "status": "作る資料",
    "statuses": "作る資料（すべて）", "chapters_requested": "章ID（型ではない）",
    "vocab": "業種", "category": "カテゴリ名",
    "keywords": "一般検索キーワード", "competitors": "競合", "brand_query": "競合の検索のしかた",
    "own_search": "自社の検索", "official_tiktok": "公式TikTokアカウントURL",
    "official_site": "公式サイトURL", "campaign_start": "施策開始日", "period": "対象期間",
    "deadline": "納期", "visit_date": "訪問日", "reviewer": "前日レビュー担当",
    "baseline": "施策前スナップショット", "output_format": "希望形式", "instruction": "指示",
    "campaign_goal": "目的とCTA", "creative_constraints": "尺・本数・必須／禁止表現",
    "reproposal_context": "再提案の背景",
}
# ⛔ の項目に添える一言（ターン2の確認文にそのまま使える）
ASK_HINT = {
    "campaign_goal": " … 何をしてほしい投稿か（保存・来店・購入 等）と、最後に促す行動",
    "creative_constraints": " … 尺・本数・掲載先、必ず入れる／入れてはいけない表現",
    "reproposal_context": " … なぜ今もう一度提案するのか（前回の提案・失注理由）と、今回決めたいこと",
    "campaign_start": " … 社内の実施情報。TikTok側には無い",
    "period": " … どこからどこまでを報告するか",
    "baseline": " … 施策前の検索面の記録。後から遡れない。未開始なら今日取る",
}
VOCAB_PRESETS = {
    "food": {"label": "食品・飲料", "words": ["food", "食品", "飲料", "食べ物", "コンビニ", "外食"]},
    "beauty": {"label": "美容・コスメ", "words": ["beauty", "美容", "コスメ", "化粧品"]},
    "general": {"label": "汎用", "words": ["general", "汎用"]},
}
DEFAULT_BRAND_QUERY = "{社名} {カテゴリ}"
FV_WINDOW = {"category": 30, "brand": 20, "own": 20}
SHORT_MAX = 6

TEMPLATE = """対象ブランド：
対象商品：
公式サイトURL：
公式TikTokアカウントURL：（無ければ「無し」）
一般検索キーワード：
作りたい資料／章：（初訪／具体提案／構成提案／レポート／競合差再提案 から。複数なら「、」で）
希望形式：PPTX
指示：この内容で資料を作成してください
"""
# 希望形式の既定は PPTX だけ。generate.js は PDF を出さない（PDF は変換できる環境でだけ後から作る）。
# 既定を「PPTX＋PDF」にしていたため、PDF が出る前提で商談に行く事故の芽になっていた（2026-09 監査）

# 初訪は選択式。入力フォーム（form/intake-form.html）も同じ形を書き出す。
TEMPLATE_FV = """対象ブランド：
作りたい資料／章：初訪
対象ブランド略称：（6字まで。資料の見出しに入る）
宛名：（表紙。例: 株式会社ミナトマート 御中）
業種：（食品・飲料／美容・コスメ／汎用 から1つ。必須）
カテゴリ名：（1つだけ。例: 冷凍食品）
競合1：（正式名（略称）｜確認済み または 想定｜@公式ID または 無し。IDが分からなければ空欄）
競合2：
競合3：
競合4：
競合の検索のしかた：{社名} {カテゴリ}
自社の検索：する
公式TikTokアカウントURL：（@ID／無し／不明）
注力商品1：
注力商品2：
注力商品3：
訪問日：（YYYY-MM-DD）
前日レビュー担当：
希望形式：PPTX
# 例）競合1：ファミリーマート（ファミマ）｜確認済み｜@famima_official
#     競合2：セブン-イレブン（セブン）｜想定
"""


def fail(msg):
    print(f"[STOP] {msg}", file=sys.stderr)
    raise SystemExit(2)


def utf8_stdio():
    """標準出力・標準エラーを UTF-8 にする。

    日本語 Windows でパイプ経由（Claude Code がコマンドを実行する形）だと標準出力が cp932 になり、
    ✅⛔🤖⚠️ を書いた瞬間に UnicodeEncodeError で途中終了していた（2026-09 監査で再現）。
    """
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            try:
                s.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def width_units(s) -> float:
    """資料側（fvlib.width_units）と同じ数え方。全角=1 / ASCII=0.55"""
    return sum(0.55 if ord(c) < 128 else 1.0 for c in str(s))


def canon_key(raw: str):
    """行頭のラベルを正規化キーに寄せる。長いエイリアスから当てる（部分一致の取り違え防止）。"""
    k = re.sub(r"[\s　*\-–—•・#>]+", "", raw).strip().lower().rstrip(":：=")
    k = re.sub(r"[（(][^）)]*[）)]", "", k) or k      # 「競合（2〜3社）」「対象ブランド（競合ではない）」の注記は見ない
    if OTHER_PLATFORM_RE.search(k):
        return None          # Instagram 等の欄は、公式サイトにも公式TikTokにも入れない
    best = None
    for field, aliases in FIELDS.items():
        for a in aliases:
            if k == a or (len(a) >= 2 and a in k):
                # より長いエイリアスに当たったほうを採用する
                if best is None or len(a) > best[1]:
                    best = (field, len(a))
    field = best[0] if best else None
    if COMPETITOR_LABEL_RE.search(k) and field not in ("brand_query", "reproposal_context"):
        # 競合の欄として読むのは「競合」「競合ブランド」のような社名の欄だけ。
        # 「競合商品」「競合の公式アカウント」は自社の項目にも競合の社名にも入れず、会話で確認する
        return "competitors" if k in COMPETITOR_LABELS else None
    return field


def _status_token(part: str):
    """区切った1つ（「①初訪」「初訪の資料」「3」）を型に当てる。完全一致だけ"""
    p = part.strip("「」『』\"'。.()（）[]【】")
    if not p:
        return None
    m = re.fullmatch(r"0?([1-5])[.:)]?", p)
    if m:
        return STATUS_BY_NUM[m.group(1)]
    # 先頭の番号（①→1 は NFKC 済み）と、末尾の「資料」「の資料」を外して当てる
    p = re.sub(r"^0?[1-5](?:[.:)|｜]|(?=[^0-9\-]))", "", p)
    p = re.sub(r"(?:の)?(?:資料|デッキ|版)$", "", p)
    for status, aliases in STATUS_ALIASES.items():
        if p in aliases:
            return status
    return None


def canon_statuses(v: str) -> list:
    """「作りたい資料／章」の値 → 型のリスト（書かれた順・重複なし）。当たらなければ []。

    値の全体か、区切った1つずつが型名・別名・番号と完全一致したときだけ当てる。
    1つでも当たらない部分があれば [] を返し、推定（確定扱いにしない）に回す。
    「初訪,競合差再提案」を先頭の1つに縮めない（generate.js の --mode も複数を受ける）。
    """
    t = unicodedata.normalize("NFKC", v or "")
    t = re.sub(r"\([^)]*\)", "", re.sub(r"\s+", "", t)).lower()   # 「初訪（約8枚）」の注記を外す
    if not t:
        return []
    one = _status_token(t)
    if one:
        return [one]
    parts = [x for x in STATUS_LIST_SPLIT_RE.split(t) if x]
    got = [_status_token(x) for x in parts]
    if len(parts) < 2 or not all(got):
        return []
    out = []
    for s in got:
        if s not in out:
            out.append(s)
    return out


def canon_status(v: str):
    """1つだけ欲しいとき用（--template 等）。複数や曖昧なら None"""
    ss = canon_statuses(v)
    return ss[0] if len(ss) == 1 else None


def primary_status(statuses):
    """資料の中心になる型。初訪は単独の資料なので、含まれていれば初訪を先頭にする"""
    if not statuses:
        return None
    return "初訪" if "初訪" in statuses else statuses[0]


def generate_modes(statuses):
    """generate.js の --mode に渡す値（資料1本につき1つ）。初訪は単独、残りは1つの統合資料"""
    if not statuses:
        return []
    rest = [s for s in statuses if s != "初訪"]
    modes = ["初訪"] if "初訪" in statuses else []
    if rest:
        modes.append(",".join(rest))
    return modes


def canon_vocab(v: str):
    """業種の値 → food / beauty / general。独自語彙の JSON パスはそのまま通す。曖昧なら None"""
    t = (v or "").strip()
    if not t:
        return None
    if t.lower().endswith(".json"):
        return t
    m = re.search(r"\b(food|beauty|general)\b", t, re.I)
    if m:
        return m.group(1).lower()
    hits = [k for k, p in VOCAB_PRESETS.items() if any(w in t for w in p["words"])]
    return hits[0] if len(hits) == 1 else None


def is_none_word(v: str) -> bool:
    return (v or "").strip().strip("「」\"'").lower() in ("無し", "なし", "無い", "ない", "存在しない", "none")


def official_id(v: str, allow_bare=True):
    """URL / @ID から uniqueId を取り出す。読めなければ None（推測しない）"""
    t = (v or "").strip()
    m = re.search(r"tiktok\.com/@([A-Za-z0-9._]+)", t, re.I)
    if m:
        return m.group(1)
    m = re.match(r"^@([A-Za-z0-9._]{2,24})$", t)
    if m:
        return m.group(1)
    if allow_bare:
        m = re.match(r"^([A-Za-z0-9._]{2,24})$", t)
        if m:
            return m.group(1)
    return None


def parse_date(v: str):
    """年のある日付だけ YYYY-MM-DD にする。年が無い（9/10 等）は推測しないので None"""
    t = (v or "").strip()
    m = re.search(r"(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})", t)
    if not m:
        return None
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def canon_brand_query(v: str):
    """競合の検索のしかた → テンプレ（{社名} と {カテゴリ}）。読めなければ None"""
    t = (v or "").strip()
    if not t:
        return None
    t = t.replace("{name}", "{社名}").replace("{category}", "{カテゴリ}")
    if "{社名}" in t:
        return re.sub(r"\s+", " ", t)
    if re.search(r"社名.{0,3}(だけ|のみ)", t):
        return "{社名}"
    if re.search(r"社名.{0,3}[+＋と].{0,3}カテゴリ", t) or "既定" in t:
        return DEFAULT_BRAND_QUERY
    return None


def canon_yes_no(v: str):
    t = (v or "").strip().lower()
    if re.match(r"^(する|あり|有り|yes|y|true|○|◯|取る)", t):
        return True
    if re.match(r"^(しない|なし|無し|no|n|false|×|取らない)", t):
        return False
    return None


def parse_competitor(val: str):
    """`ファミリーマート（ファミマ）｜確認済み｜@famima_official` を1社分に分解する。

    区切りは ｜（| も可）。1つ目＝正式名（略称は括弧）、以降は順不同で
    確認済み／想定、@ID／URL／無し、略称:xx を受ける。確認済みと書かれていなければ
    「想定」（confirmed_by_client=false）として扱う。公式IDが空なら unknown（AIが調べる）。
    """
    parts = [p.strip() for p in re.split(r"[｜|]", val)]
    head = parts[0] if parts else ""
    name, short = head, None
    m = re.match(r"^(.*?)\s*[（(]([^（）()]+)[）)]\s*$", head)
    if m and m.group(1).strip():
        name, short = m.group(1).strip(), m.group(2).strip()
    if not name or name.strip().lower() in DELEGATED:
        return None
    c = {"name": name, "short": short, "confirmed_by_client": False,
         "official": [], "official_status": "unknown", "unparsed": []}
    for p in parts[1:]:
        if not p:
            continue
        mm = re.match(r"^略称\s*[:：=]\s*(.+)$", p)
        if mm:
            c["short"] = mm.group(1).strip()
        elif re.search(r"確認済|確定", p):
            c["confirmed_by_client"] = True
        elif re.search(r"想定|未確認|仮", p):
            c["confirmed_by_client"] = False
        elif is_none_word(re.sub(r"^公式\s*[:：]?\s*", "", p)):
            c["official_status"] = "none"
        elif official_id(p, allow_bare=False):
            c["official"] = [official_id(p, allow_bare=False)]
            c["official_status"] = "confirmed"
        elif p.strip().lower() in DELEGATED:
            continue
        else:
            c["unparsed"].append(p)
    return c


def router_path():
    """型推定エンジン（tiktok-analyze/scripts/route_sales_request.py）の場所。無ければ None。

    このスキルの隣（配布物のまま・プロジェクトの .claude/skills でも同じ並び）→ インストール先の順。
    番号付きの旧フォルダ名（02-analyze）は配布していないが、古い配置のために最後に見る。
    """
    env = os.environ.get("TIKTOK_ANALYZE_DIR")
    for cand in [Path(env) / "scripts/route_sales_request.py" if env else None,
                 HERE.parent.parent / "tiktok-analyze/scripts/route_sales_request.py",
                 Path.home() / ".claude/skills/tiktok-analyze/scripts/route_sales_request.py",
                 HERE.parent.parent / "02-analyze/scripts/route_sales_request.py"]:
        if cand and cand.exists():
            return cand
    return None


def infer_status(text: str):
    """散文から資料の型を推定する。tiktok-analyze の推定エンジンを使う。

    自前の別名表は「作りたい資料／章：初訪」のようにラベルが付いた値しか読めないため、
    「TOTOに初回訪問で行くけど資料作れる？」のような一文では未確定に落ちていた。

    返り値: {"statuses", "confidence", "needs_confirmation", "warning"}。
    エンジンが無い・動かないときは黙って簡易判定に落とさず warning に書く
    （以前は黙って落ち、置き場所によって型が変わっていた。2026-09 監査）。
    """
    cand = router_path()
    warning = None
    if cand:
        try:
            # 子プロセスの標準出力も UTF-8 に固定する（日本語 Windows の cp932 で依頼文の絵文字が落ちる）
            proc = subprocess.run([sys.executable, str(cand), "--request", text],
                                  capture_output=True, text=True, encoding="utf-8", errors="replace",
                                  env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=30)
            d = json.loads(proc.stdout)
            names = [s for s in (d.get("status_names") or []) if s in NEEDED_BY_STATUS]
            if not names and d.get("status_name") in NEEDED_BY_STATUS:
                names = [d["status_name"]]
            return {"statuses": names, "confidence": d.get("confidence"),
                    "needs_confirmation": bool(d.get("needs_clarification")) or not names,
                    "warning": None}
        except (subprocess.SubprocessError, json.JSONDecodeError, OSError, ValueError) as e:
            warning = (f"型推定エンジン（{cand}）が動きませんでした: {type(e).__name__}。"
                       "型は推定せず、ターン2で5つの型から選んでもらう")
    else:
        warning = ("型推定エンジン（tiktok-analyze/scripts/route_sales_request.py）が見つかりません。"
                   "tiktok-intake と同じフォルダに tiktok-analyze を置くか TIKTOK_ANALYZE_DIR で場所を指定する。"
                   "それまでは型の正式名が書かれているときだけ拾い、必ず確認する")
    # エンジンが使えない場合: 型の正式名が本文に書かれているときだけ拾う。
    # 番号・短い別名では当てない（「8/1」の 1 で初訪、「提案」で具体提案になっていた）
    # （正式名どうしは互いを含まないので、正式名だけなら部分一致でも取り違えない）
    t = unicodedata.normalize("NFKC", text or "")
    names = [s for _, s in sorted((t.find(s), s) for s in STATUS_NAMES if s in t)]
    return {"statuses": names, "confidence": None, "needs_confirmation": True, "warning": warning}


def _keyword_tokens(val: str):
    """一般検索キーワードの値 → 語のリスト。ハッシュタグ（#トイレリフォーム #洗面台交換）も語として受ける"""
    out = []
    for part in SPLIT_RE.split(val):
        part = part.strip()
        if not part:
            continue
        if "#" in part:
            # ハッシュタグは空白で区切られて並ぶ。先頭の # を外して1語ずつにする
            out += [t.lstrip("#＃").strip() for t in re.split(r"\s+", part) if t.lstrip("#＃").strip()]
        else:
            out.append(part)
    return out


def _put(got, key, val):
    """1つだけ取る項目。先に書かれた値を使い、違う値が後から来たら黙って捨てずに記録する"""
    if key in got and got[key] != val:
        got.setdefault("_conflicts", []).append((key, got[key], val))
        return
    got[key] = val


def parse(text: str):
    """自由文から項目を拾う。ラベル: 値 の形を基本に、# で始まる行（テンプレの例）は落とす。

    行末の「 #…」はコメントとして落とさない。「一般検索キーワード: #トイレリフォーム」が
    丸ごと消えて AI が別の語を作ったり、「指示: #PR投稿は除外」が空になっていた（2026-09 監査）。
    """
    got, unknown = {}, []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "＃")):
            continue
        if line.startswith(BOILERPLATE):
            continue
        # 競合N：… は1行1社の構造化行。「競合」を含む他の項目と取り違えないよう、汎用の当て込みより先に読む
        mc = re.match(r"^競合\s*([0-9０-９]+)\s*[:：=]\s*(.*)$", line)
        if mc:
            val = mc.group(2).strip()
            # テンプレの注記（「（正式名（略称）｜…）」）だけの行は値ではない
            c = parse_competitor(val) if val and not val.startswith(("（", "(")) else None
            if c:
                got.setdefault("competitor_entries", []).append(c)
                got.setdefault("competitors", [])
                if c["name"] not in got["competitors"]:
                    got["competitors"].append(c["name"])
            continue
        m = re.match(r"^(.{1,32}?)\s*[:：=]\s*(.*)$", line)
        if not m:
            unknown.append(line)
            continue
        key, val = canon_key(m.group(1)), m.group(2).strip()
        val = re.sub(r"^[（(].*?[）)]\s*", "", val).strip()   # 「（無ければ「無し」）」等の注記を落とす
        # SKILL.md の記入例の「← 6字まで」のような矢印の注記も値ではない（写して貼られると値に混ざる）
        val = re.sub(r"\s*←.*$", "", val).strip()
        low = val.strip().strip("「」\"'").lower()
        # ── 項目ごとの読み方（委任語の判定より先に。「しない」「無し」が値になる項目があるため）──
        if key == "official_tiktok":
            if is_none_word(val):
                # 公式アカウントが存在しないことは事実として保持する（探し直さない）
                got["official_tiktok_absent"] = True
                continue
            if low == "不明":
                got["official_tiktok_unknown"] = True
                continue
        if key == "own_search" and val:
            yn = canon_yes_no(val)
            if yn is None:
                unknown.append(line)
            else:
                got["own_search"] = yn
            continue
        if key == "baseline" and val:
            # 施策前スナップショット: ある / ない / わからない / <run-dir のパス>
            # 「ない」は不足ではなく確定した事実（前後比較は作れない＝現状値のみ）。聞き返さない
            if re.match(r"^(まだ|未)", low):
                pass          # 「まだ取っていない」は無いと確定ではない（未開始なら今日取れる）。聞く側に残す
            elif re.match(r"^(ない|無い|なし|無し|取っていない|取ってない)", low):
                got["baseline_absent"] = True
            elif re.match(r"^(ある|あり|有り|有る|取得済|取ってある|yes)", low):
                _put(got, "baseline", "ある")
            elif low not in DELEGATED:
                _put(got, "baseline", val)        # パスや取得日の記述はそのまま持つ
            continue
        if key == "competitors" and low in DELEGATE_WORDS:
            # 「任せる」と書かれたときだけ、候補を出して「想定」として確認に載せてよい（黙って決めない）
            got["competitors_delegated"] = True
        if low in DELEGATED:
            val = ""          # 委任＝未入力として自動導出に回す
        if not key or not val:
            if not key and val:
                unknown.append(line)
            continue
        if key == "vocab":
            v = canon_vocab(val)
            if v:
                _put(got, "vocab", v)
            else:
                got["vocab_unrecognized"] = val
            continue
        if key == "brand_query":
            q = canon_brand_query(val)
            if q:
                _put(got, "brand_query", q)
            else:
                unknown.append(line)
            continue
        if key == "visit_date":
            got["visit_date_raw"] = val
            d = parse_date(val)
            if d:
                _put(got, "visit_date", d)
            continue
        if key in MULTI:
            if key == "keywords":
                vals = _keyword_tokens(val)
            else:
                vals = [v.strip() for v in NAME_SPLIT_RE.split(val) if v.strip()]
            got.setdefault(key, [])
            got[key] += [v for v in vals if v not in got[key]]
        elif key == "status":
            norm = unicodedata.normalize("NFKC", val)
            chapters = CHAPTER_ID_RE.findall(norm)
            if chapters:
                # 「4-4」「2-1」は modules.json の章ID で、資料の型ではない。型は推定に回して確認する
                got.setdefault("chapters_requested", [])
                got["chapters_requested"] += [c for c in chapters if c not in got["chapters_requested"]]
            ss = canon_statuses(CHAPTER_ID_RE.sub("", norm))     # 「初訪 1-1」なら初訪は読む
            if ss:
                if got.get("statuses") and got["statuses"] != ss:
                    got.setdefault("_conflicts", []).append(("status", "、".join(got["statuses"]), "、".join(ss)))
                else:
                    got["statuses"] = ss
                    got["status"] = primary_status(ss)
            elif not chapters:
                got.setdefault("status_unrecognized", val)
        else:
            _put(got, key, val)
    # 「競合：A、B」（自由文）で来た社は、確認済みと書かれていないので想定として持つ
    entries = got.get("competitor_entries") or []
    named = {e["name"] for e in entries}
    for n in got.get("competitors") or []:
        if n not in named:
            entries.append({"name": n, "short": None, "confirmed_by_client": False,
                            "official": [], "official_status": "unknown", "unparsed": []})
    if entries:
        got["competitor_entries"] = entries
    return got, unknown


def own_official(got):
    """自社の公式アカウント → (official[], official_status)。URLで ID が読めなければ unknown"""
    if got.get("official_tiktok_absent"):
        return [], "none"
    raw = got.get("official_tiktok")
    if raw:
        oid = official_id(raw)
        return ([oid], "confirmed") if oid else ([], "unknown")
    return [], "unknown"


def first_visit_view(got):
    """初訪の入力を構造化して返す（intake.json と case.json 下書きの元）"""
    offs, ost = own_official(got)
    comps = []
    for e in (got.get("competitor_entries") or [])[:4]:
        comps.append({k: e[k] for k in ("name", "short", "confirmed_by_client", "official", "official_status")})
    return {
        "vocab": got.get("vocab"),
        "category": got.get("category"),
        "client_short": got.get("company_short"),
        "recipient": got.get("recipient"),
        "competitors": comps,
        "brand_query": got.get("brand_query") or DEFAULT_BRAND_QUERY,
        "own_search": got.get("own_search", True),
        "official": {"ids": offs, "status": ost},
        "focus_products": (got.get("focus_products") or [])[:3],
        "visit_date": got.get("visit_date"),
        "reviewer": got.get("reviewer"),
    }


def filled_value(k, got, status):
    """その型で「埋まっている」と言えるか。初訪は競合1社以上・公式は URL か「無し」で埋まり"""
    if status == "初訪":
        if k == "competitors":
            return len(got.get("competitor_entries") or []) >= 1
        if k == "official_tiktok":
            return own_official(got)[1] in ("confirmed", "none")
    if k == "baseline":
        # 「ない」も確定した答え（前後比較は作れない）。「わからない」だけが未回答
        return bool(got.get("baseline")) or bool(got.get("baseline_absent"))
    return bool(got.get(k))


def notes_for(got, statuses):
    """先出しの内容から、そのまま提案材料になる事実を拾う。"""
    n = []
    fv = "初訪" in statuses
    if got.get("official_tiktok_absent"):
        if fv:
            n.append("公式TikTokは「無し」で確定（探し直しません）。資料では対象ブランドの枠を"
                     "「まだ無し」として示し、公式露出は0本と書けます")
        else:
            n.append("公式TikTokアカウントが無いと確定しています（探し直さない）。"
                     "『検索面に公式が1本も出ていない』は強い訴求材料になります。"
                     "gaps.py は --run-dir の intake.json を見て、公式URLを聞き返さない")
    if len(statuses) > 1:
        modes = generate_modes(statuses)
        if fv:
            n.append("初訪は単独の資料で出します（約8枚のお土産）。"
                     + "、".join(m for m in modes if m != "初訪") + " は別の資料にします"
                     "（generate.js を --mode ごとに1回ずつ: " + " ／ ".join(modes) + "）")
        else:
            n.append(f"{'＋'.join(statuses)} を1つの資料にまとめます（generate.js --mode \"{modes[0]}\"）。"
                     "別々にするなら型ごとに --mode を分ける")
    if got.get("baseline_absent") and "レポート" in statuses:
        n.append("施策前のデータは「無い」で確定（聞き返さない）。前後比較は作れないので、"
                 "現状値だけの資料にするかをターン2で確認する（施策前後の比較とは書かない）")
    elif got.get("baseline") and "レポート" in statuses:
        n.append(f"施策前のデータ: {got['baseline']}。置き場所（施策前の run-dir）を確かめて "
                 "build_dataset.py --baseline に渡す")
    if (got.get("competitors_delegated") and not got.get("competitors")
            and set(statuses) != {"レポート"}):
        n.append("競合は「任せる」と書かれています。業種別の候補か Web検索から候補を出し、"
                 "「想定」としてターン2の確認に載せる（黙って決めない）")
    if (got.get("output_format") or "").upper().find("PDF") >= 0:
        n.append("PDFも希望。generate.js は PPTX だけを出すので、PPTXのあと変換を試し"
                 "（LibreOffice が要る）、PDF ができたかを必ず確かめる。できない環境なら"
                 "PowerPoint の「ファイル→エクスポート→PDF」の手順を伝える（できたフリをしない）")
    if fv and got.get("visit_date"):
        d = dt.date.fromisoformat(got["visit_date"]) - dt.timedelta(days=1)
        who = f"（レビュー: {got['reviewer']}）" if got.get("reviewer") else ""
        n.append(f"訪問日 {got['visit_date']} → 前日 {d.isoformat()} に生成して一通り見る{who}")
    return n


def warnings_for(got, statuses):
    """先出しされていても危ないものを指摘する。埋まっている＝正しいとは限らない。

    statuses は**確定か推定かにかかわらず**決まった型。以前は依頼票に書かれた型
    （got["status"]）だけを見ていたため、依頼文から推定してレポートになった場合に
    「施策前のデータは遡れない」という一番取り返しのつかない注意が抜けていた（2026-09 監査）。
    """
    w = []
    fv = "初訪" in statuses
    kws = got.get("keywords") or []
    company = got.get("company") or ""
    if kws and company and not fv:
        base = re.sub(r"(株式会社|\(株\)|㈱|会社|Inc\.?|Corp\.?)", "", company).strip()
        if base and all(base.lower() in k.lower() or k.lower() in base.lower() for k in kws):
            w.append("検索キーワードがブランド名だけです。まだ知らない人が検索する"
                     "**一般名詞**（例: トイレリフォーム）を足すと提案の材料が増えます")
    if "レポート" in statuses:
        if not got.get("campaign_start"):
            w.append("レポートは施策開始日が要ります。**施策前のデータは後から遡れません**。"
                     "施策が未開始なら今日のうちにスナップショットを取ってください")
        if got.get("baseline_absent"):
            w.append("施策前のデータが無いので、レポート（施策前後の比較）の資料は作れません"
                     "（generate.js --mode レポート は施策前後を比べられる状態でないと止まる）。"
                     "現状値だけの資料にするかを確認してください")
    if got.get("status_unrecognized"):
        w.append(f"『{got['status_unrecognized']}』はどの型か判別できませんでした。"
                 "ターン2で5つの型から選び直してください")
    if got.get("chapters_requested"):
        ch = "、".join(got["chapters_requested"])
        w.append(f"『{ch}』は章の番号で、資料の型ではありません。型は依頼文から推定してターン2で確認します"
                 f"（章ごとの可否は gaps.py --run-dir <run-dir> --modules {','.join(got['chapters_requested'])}。"
                 "章の番号は資料のページ番号とは別）")
    for key, first, later in got.get("_conflicts") or []:
        w.append(f"{LABEL_JA.get(key, key)}が2回、違う値で書かれています（『{first}』と『{later}』）。"
                 f"先に書かれた『{first}』で進めます。違えばターン2で直してもらう")
    if got.get("vocab_unrecognized"):
        w.append(f"業種『{got['vocab_unrecognized']}』を 食品・飲料／美容・コスメ／汎用 のどれにも当てられませんでした")
    entries = got.get("competitor_entries") or []
    if fv:
        if len(entries) == 1:
            w.append("競合が1社です。2〜4社あると「競合はこう発信している」が比べやすくなります")
        if len(entries) > 4:
            w.append(f"競合が{len(entries)}社あります。初訪で使うのは先頭4社です（"
                     + "、".join(e["name"] for e in entries[4:]) + " は外します）")
        cat = got.get("category") or ""
        if re.search(r"[、,，／/]", cat):
            w.append("カテゴリ名は1つだけにしてください（初訪は1カテゴリで作ります）")
        if got.get("company_short") and width_units(got["company_short"]) > SHORT_MAX:
            w.append(f"対象ブランドの略称『{got['company_short']}』が6字を超えています（資料生成で止まります）")
        for e in entries[:4]:
            if e.get("short") and width_units(e["short"]) > SHORT_MAX:
                w.append(f"競合『{e['name']}』の略称『{e['short']}』が6字を超えています（資料生成で止まります）")
            if not e.get("short") and width_units(e["name"]) > SHORT_MAX:
                w.append(f"競合『{e['name']}』は6字を超えるので略称が要ります（見出しに入らない）")
            if company and e["name"].replace(" ", "") == company.replace(" ", ""):
                w.append(f"『{e['name']}』は対象ブランドと同じです。競合から外してください")
            if e.get("unparsed"):
                w.append(f"競合『{e['name']}』の『{'｜'.join(e['unparsed'])}』を読めませんでした"
                         "（確認済み／想定、@ID／無し のどれか）")
        if got.get("official_tiktok") and own_official(got)[1] == "unknown":
            w.append("公式TikTokのIDを読み取れませんでした（短縮URL等）。@ID の形で書いてください。"
                     "読めるまで公式露出は判定しません")
        if got.get("visit_date_raw") and not got.get("visit_date"):
            w.append(f"訪問日『{got['visit_date_raw']}』に年がありません。YYYY-MM-DD で書いてください"
                     "（年は推測しないので case.json には入れません）")
        if not got.get("category") and kws:
            w.append(f"カテゴリ名がありません。一般検索キーワードの先頭『{kws[0]}』で検索し、"
                     "表示名はカテゴリ名が決まってから入れます")
    elif len(entries) == 1:
        w.append("競合が1社です。競合との比較は2社以上あると読みやすくなります")
    return w


# ─────────────────────────────── case.json の下書き

def _safe(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\s]+', "_", name).strip("_") or "x"


def _match(*names) -> str:
    """ブランドの一致パターン（正式名｜略称｜空白・記号を抜いた形）。正規表現の記号は逃がす"""
    out = []
    for n in names:
        if not n:
            continue
        for v in (n, re.sub(r"[\s　・\-－‐]", "", n)):
            e = re.sub(r"([.^$*+?()\[\]{}|\\])", r"\\\1", v)
            if e and e not in out:
                out.append(e)
    return "|".join(out)


def build_case_draft(got, status):
    """依頼票から case.json の下書きを組む。選択肢と事実（社名・ID・日付）だけを入れ、
    分からない値は書かない（推測で埋めない）。数値は書かない（機械が数える）。"""
    fv = first_visit_view(got)
    category = fv["category"]
    kws = list(got.get("keywords") or [])
    tmpl = fv["brand_query"]

    def query(name):
        if "{カテゴリ}" in tmpl and not category:
            return None             # カテゴリが決まるまで検索語を作らない
        return tmpl.replace("{社名}", name).replace("{カテゴリ}", category or "").strip()

    case = {"_comment": "intake_form.py が依頼票から作った下書き。選択肢と事実（社名・ID・日付）だけを入れている。"
                        "取得したら acquired_on（YYYY-MM-DD）を入れ、raw/ の file が揃っているか確かめてから使う"}
    if fv["recipient"]:
        case["project"] = {"recipient": fv["recipient"]}
    company = got.get("company")
    client = {}
    if company:
        client["client_name"] = company
    if fv["client_short"]:
        client["short"] = fv["client_short"]
    if client:
        case["client"] = client
    if category:
        case["category"] = category
    if fv["vocab"]:
        case["vocab"] = fv["vocab"]

    brands = []
    if company:
        own = {"name": company, "own": True}
        if fv["client_short"]:
            own["short"] = fv["client_short"]
        q = query(company) if fv["own_search"] else None
        if q:
            own["query"] = q
            own["file"] = f"raw/brand_{_safe(company)}.json"
        own["match"] = _match(company, fv["client_short"])
        if fv["official"]["ids"]:
            own["official"] = fv["official"]["ids"]
        own["official_status"] = fv["official"]["status"]
        brands.append(own)
    for c in fv["competitors"]:
        b = {"name": c["name"]}
        if c.get("short"):
            b["short"] = c["short"]
        q = query(c["name"])
        if q:
            b["query"] = q
            b["file"] = f"raw/brand_{_safe(c['name'])}.json"
        b["match"] = _match(c["name"], c.get("short"))
        if c.get("official"):
            b["official"] = c["official"]
        b["official_status"] = c.get("official_status") or "unknown"
        b["confirmed_by_client"] = bool(c.get("confirmed_by_client"))
        brands.append(b)
    if brands:
        case["brands"] = brands

    keywords = []
    if category:
        keywords.append({"name": category, "query": category, "primary": True,
                         "file": f"raw/kw_{_safe(category)}.json"})
    for k in kws:
        if k == category:
            continue
        e = {"name": k, "query": k, "file": f"raw/kw_{_safe(k)}.json"}
        if not keywords:
            e["primary"] = True
        keywords.append(e)
    if keywords:
        case["keywords"] = keywords
    if fv["focus_products"]:
        case["focus_products"] = fv["focus_products"]
    if fv["visit_date"]:
        case["visit_date"] = fv["visit_date"]
    first_visit = {"window": dict(FV_WINDOW)}
    if fv["reviewer"]:
        first_visit["reviewer"] = fv["reviewer"]
    case["first_visit"] = first_visit
    case["media_accounts"] = []
    return case


def write_case_draft(case, target: str, force=False):
    p = Path(target).expanduser()
    if p.is_dir() or target.endswith(("/", "\\")) or p.suffix.lower() != ".json":
        p = p / "case.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    note = None
    if p.exists() and not force:
        # 既存の case.json（取得後に手で直したもの）を黙って潰さない
        alt = p.with_name(p.stem + ".draft.json")
        note = f"{p.name} が既にあるので上書きせず {alt.name} に書きました。差分を見て反映してください"
        p = alt
    p.write_text(json.dumps(case, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return str(p), note


def acquire_plan(case):
    """search.mjs に渡す検索語と保存先（case.json の file と同じ）"""
    plan = []
    for k in case.get("keywords") or []:
        plan.append({"axis": "カテゴリ" if k.get("primary") else "追加KW", "query": k["query"], "out": k["file"]})
    for b in case.get("brands") or []:
        if b.get("query"):
            plan.append({"axis": "自社（任意）" if b.get("own") else "競合", "query": b["query"], "out": b["file"]})
    return plan


# ─────────────────────────────── 判定

def analyse(text: str):
    got, unknown = parse(text)
    statuses = [x for x in (got.get("statuses") or []) if x in NEEDED_BY_STATUS]
    inferred, engine_warning = None, None
    if not statuses:
        # 依頼票で「わからない」が選ばれた場合も含め、依頼文の全体から推定する（確定扱いにはしない）
        inf = infer_status(text)
        engine_warning = inf["warning"]
        if inf["statuses"]:
            statuses = inf["statuses"]
            inferred = {"status": primary_status(statuses), "statuses": statuses,
                        "confidence": inf["confidence"],
                        "needs_confirmation": inf["needs_confirmation"]}
    status = primary_status(statuses)
    # 必要な入力は、選ばれた型すべての和集合（初訪＋競合差再提案なら両方の資料の分）
    check, owner = [], {}
    for s in statuses or [None]:
        # ステータス未確定なら、どの型でも要る keywords だけを共通の不足として見る
        for k in (NEEDED_BY_STATUS.get(s) if s else ["keywords"]):
            if k not in owner:
                owner[k] = s
                check.append(k)
    filled = [k for k in check if filled_value(k, got, owner[k])]
    gap = [k for k in check if not filled_value(k, got, owner[k])]
    ask_here = set(MUST_ASK)
    for s in statuses:
        ask_here |= MUST_ASK_BY_STATUS.get(s, set())
    derive = [k for k in gap if k in DERIVABLE and k not in ask_here]   # AIが候補を出す
    # 営業に聞くしかない。どちらにも分類されない不足は黙って落とさず、聞く側に入れる
    missing = [k for k in gap if k not in derive]

    warnings = warnings_for(got, statuses)
    if engine_warning:
        warnings.insert(0, engine_warning)
    result = {
        "fields": {k: v for k, v in got.items()
                   if k not in ("status_unrecognized", "official_tiktok_absent", "official_tiktok_unknown",
                                "competitor_entries", "vocab_unrecognized", "visit_date_raw",
                                "baseline_absent", "competitors_delegated", "_conflicts", "statuses")},
        "official_tiktok_absent": bool(got.get("official_tiktok_absent")),
        "baseline_absent": bool(got.get("baseline_absent")),
        "competitors_delegated": bool(got.get("competitors_delegated")),
        "status": status,
        "statuses": statuses,
        # generate.js の --mode に渡す値（資料1本につき1つ）。初訪は必ず単独
        "generate_modes": generate_modes(statuses),
        "status_confirmed": bool(status) and not inferred,
        "status_inferred": inferred,
        "inputs": {"filled": filled, "ai_derives": derive, "must_ask": missing},
        "warnings": warnings,
        "notes": notes_for(got, statuses),
        "unparsed_lines": unknown,
        "note": "先出しは任意。must_ask はターン2の1回の確認で聞く（返事が無くても止めない）。filled は聞き返さない",
    }
    if "初訪" in statuses:
        result["first_visit"] = first_visit_view(got)
    return got, result


def print_human(result, case_note=None):
    print("■ 先出しで受け取ったもの")
    for k, v in result["fields"].items():
        if isinstance(v, bool):
            v = "する" if v else "しない"
        print(f"  ・{LABEL_JA.get(k, k)}: {', '.join(v) if isinstance(v, list) else v}")
    if not result["fields"]:
        print("  （なし。ターン1から会話で聞きます）")
    print()
    status = result["status"]
    inferred = result["status_inferred"]
    label = "、".join(result.get("statuses") or []) or status
    if inferred:
        c = inferred.get("confidence")
        q = "（確認が必要）" if inferred.get("needs_confirmation") else "（確認だけ取れば進めます）"
        print(f"■ 作る資料: {label} ← 依頼文から推定 confidence={c} {q}")
    else:
        print(f"■ 作る資料: {label or '未確定 → 5つの型から選ばせる'}")
    modes = result.get("generate_modes") or []
    if len(modes) > 1 or (modes and "," in modes[0]):
        print(f"  資料{len(modes)}本: " + " ／ ".join(f"--mode \"{m}\"" for m in modes))
    print()
    fv = result.get("first_visit")
    if fv:
        print("■ 初訪の入力（選択式）")
        vl = VOCAB_PRESETS.get(fv["vocab"], {}).get("label", fv["vocab"]) if fv["vocab"] else None
        print(f"  業種       : {vl + '（' + fv['vocab'] + '）' if vl else '未選択 ⛔'}")
        print(f"  カテゴリ名 : {fv['category'] or '未定 🤖'}")
        if fv["competitors"]:
            for i, c in enumerate(fv["competitors"], 1):
                sh = f"（{c['short']}）" if c.get("short") else ""
                st = "確認済み" if c["confirmed_by_client"] else "想定"
                off = {"confirmed": "@" + (c["official"] or ["?"])[0], "none": "公式無し",
                       "unknown": "公式ID不明 🤖"}[c["official_status"]]
                print(f"  競合{i}      : {c['name']}{sh}｜{st}｜{off}")
        else:
            print("  競合       : 未定 ⛔")
        print(f"  検索のしかた: {fv['brand_query']}（自社の検索: {'する' if fv['own_search'] else 'しない'}）")
        ost = fv["official"]["status"]
        print(f"  公式TikTok : "
              + {"confirmed": "@" + ", @".join(fv["official"]["ids"]), "none": "無し（確定）",
                 "unknown": "不明 🤖（見つかるまで0本とは書かない）"}[ost])
        if fv["focus_products"]:
            print(f"  注力商品   : {'、'.join(fv['focus_products'])}")
        if fv["visit_date"]:
            print(f"  訪問日     : {fv['visit_date']}" + (f"（前日レビュー: {fv['reviewer']}）" if fv["reviewer"] else ""))
        print()
    derive, missing, filled = (result["inputs"]["ai_derives"], result["inputs"]["must_ask"],
                               result["inputs"]["filled"])
    if derive:
        print("■ AIが調べて候補を出す（営業には聞かない）")
        for k in derive:
            print(f"  🤖 {LABEL_JA.get(k, k)}")
    if missing:
        print("\n■ 営業に聞くしかない（ターン2の1回の確認にまとめる。返事を待たずに進める）")
        for k in missing:
            extra = ASK_HINT.get(k, "")
            if k == "competitors":
                extra = (" … 1社以上（2〜4社推奨）。未確認なら「想定」で進め、資料に「※競合は弊社の想定です」と入れる"
                         if status == "初訪" else " … 競合の選定は営業の仕事。AIが黙って決めない")
                if result.get("competitors_delegated"):
                    extra += "（「任せる」とあるので、候補を出して「想定」として確認に載せる）"
            if status == "初訪" and k == "vocab":
                extra = " … 3つから選ぶだけ。これで切り口・訴求の語彙が決まる"
            print(f"  ⛔ {LABEL_JA.get(k, k)}{extra}")
    if not derive and not missing:
        if status:
            print("■ 追加で必要なものはありません。そのまま取得に進めます")
        else:
            # 型が決まらないと、型ごとの必須入力（レポートの施策前データ等）を判定できない
            print("■ 型が決まるまで、型ごとの不足は判定していません（ターン2で5つの型から選んでもらう）")
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
    if result.get("case_json"):
        print(f"\n■ case.json の下書き: {result['case_json']}")
        if case_note:
            print(f"  ⚠️ {case_note}")
        plan = result.get("acquire_plan") or []
        if plan:
            print("  取得する検索語（tiktok-acquire の search.mjs --query … --out <案件>/<保存先>）")
            for p in plan:
                print(f"    {p['axis']:<6} 「{p['query']}」 → {p['out']}")
    unknown = result["unparsed_lines"]
    if unknown:
        print(f"\n■ 拾えなかった行（{len(unknown)}件）— 会話で確認する")
        for u in unknown[:5]:
            print(f"  ? {u}")


# ─────────────────────────────── 自己検査

def selftest() -> int:
    """項目名の取り違え（「競合」を含む別項目など）と、初訪の依頼票の読み取りを確かめる"""
    ok = True

    def check(label, got, want):
        nonlocal ok
        mark = "OK " if got == want else "NG "
        if got != want:
            ok = False
        print(f"  {mark}{label}: {got!r}" + ("" if got == want else f"  (期待 {want!r})"))

    print("■ ラベル → 項目")
    for lab, want in [
        ("競合", "competitors"), ("競合ブランド", "competitors"), ("競合他社", "competitors"),
        ("競合の検索のしかた", "brand_query"), ("競合の検索方法", "brand_query"),
        ("自社の検索", "own_search"), ("対象ブランド", "company"), ("対象ブランド略称", "company_short"),
        ("宛名", "recipient"), ("業種", "vocab"), ("業種プリセット", "vocab"), ("カテゴリ名", "category"),
        ("注力商品1", "focus_products"), ("対象商品", "product"), ("訪問日", "visit_date"),
        ("納期", "deadline"), ("前日レビュー担当", "reviewer"), ("公式TikTokアカウントURL", "official_tiktok"),
        ("公式サイトURL", "official_site"), ("一般検索キーワード", "keywords"),
        ("作りたい資料／章", "status"), ("希望形式", "output_format"), ("指示", "instruction"),
    ]:
        check(lab, canon_key(lab), want)

    print("■ 競合の行")
    g, _ = parse("競合1：ファミリーマート（ファミマ）｜確認済み｜@famima_official\n"
                 "競合2: セブン-イレブン（セブン）｜想定\n"
                 "競合3：ローソン｜想定｜無し\n"
                 "競合4：コカ・コーラ\n"
                 "競合の検索のしかた：{社名} {カテゴリ}\n")
    e = g.get("competitor_entries") or []
    check("社数", len(e), 4)
    if len(e) == 4:
        check("1 名前/略称", (e[0]["name"], e[0]["short"]), ("ファミリーマート", "ファミマ"))
        check("1 確認/公式", (e[0]["confirmed_by_client"], e[0]["official"], e[0]["official_status"]),
              (True, ["famima_official"], "confirmed"))
        check("2 想定/公式不明", (e[1]["confirmed_by_client"], e[1]["official_status"]), (False, "unknown"))
        check("3 公式無し", e[2]["official_status"], "none")
        check("4 中黒で割らない", e[3]["name"], "コカ・コーラ")
    check("検索のしかたは競合に入らない", g.get("brand_query"), "{社名} {カテゴリ}")
    g2, _ = parse("競合：LIXIL、Panasonic\n")
    check("自由文の競合", [x["name"] for x in g2.get("competitor_entries") or []], ["LIXIL", "Panasonic"])
    check("自由文の競合は想定扱い", [x["confirmed_by_client"] for x in g2.get("competitor_entries") or []],
          [False, False])

    print("■ 業種・公式・日付")
    for v, want in [("食品・飲料（food）", "food"), ("美容・コスメ", "beauty"), ("汎用", "general"),
                    ("general", "general"), ("よくわからない", None)]:
        check(f"業種 {v}", canon_vocab(v), want)
    check("公式URL", official_id("https://www.tiktok.com/@toto_official?lang=ja"), "toto_official")
    check("短縮URLは読まない", official_id("https://vt.tiktok.com/ZSabc/"), None)
    check("日付", parse_date("2026/10/6"), "2026-10-06")
    check("年なしは入れない", parse_date("10/6"), None)

    print("■ 初訪の依頼票 → 判定と case.json")
    sample = """対象ブランド：ミナトマート
作りたい資料／章：初訪
対象ブランド略称：ミナト
宛名：株式会社ミナトマート 御中
業種：食品・飲料（food）
カテゴリ名：冷凍食品
競合1：ヒカリストア（ヒカリ）｜確認済み｜@hikaristore_official
競合2：ソラマート｜想定
競合の検索のしかた：{社名} {カテゴリ}
自社の検索：する
公式TikTokアカウントURL：無し
注力商品1：冷凍餃子
訪問日：2026-10-06
前日レビュー担当：山田
目的：来週初回訪問
"""
    g3, r3 = analyse(sample)
    check("型", r3["status"], "初訪")
    check("聞くもの", r3["inputs"]["must_ask"], [])
    case = build_case_draft(g3, r3["status"])
    br = {b["name"]: b for b in case.get("brands", [])}
    check("競合の検索語", br.get("ヒカリストア", {}).get("query"), "ヒカリストア 冷凍食品")
    check("想定は false", br.get("ソラマート", {}).get("confirmed_by_client"), False)
    check("自社 公式無し", br.get("ミナトマート", {}).get("official_status"), "none")
    check("主KW", [(k["query"], k.get("primary")) for k in case.get("keywords", [])], [("冷凍食品", True)])
    check("窓", case.get("first_visit", {}).get("window"), FV_WINDOW)
    check("media_accounts", case.get("media_accounts"), [])
    check("自由記述は流さない", "目的" in json.dumps(case, ensure_ascii=False) or "来週" in json.dumps(case, ensure_ascii=False), False)
    _, r4 = analyse("対象ブランド：ミナトマート\n作りたい資料／章：初訪\n業種：未選択\n競合：未定\n")
    check("業種・競合が無ければ聞く", sorted(r4["inputs"]["must_ask"]), ["competitors", "vocab"])
    g5, r5 = analyse("対象ブランド：A社\n作りたい資料／章：初訪\n業種：汎用\nカテゴリ名：転職\n"
                     "競合1：B社｜想定\n自社の検索：しない\n")
    own = [b for b in build_case_draft(g5, r5["status"])["brands"] if b.get("own")][0]
    check("自社の検索しない → file なし", ("file" in own, "query" in own), (False, False))

    # ── 2026-09 監査で見つかった取り違えの再発防止 ──
    print("■ 型（作りたい資料／章）は完全一致だけ")
    for v, want in [("構成提案", ["構成提案"]), ("競合差再提案", ["競合差再提案"]),
                    ("③構成提案", ["構成提案"]), ("⑤競合差再提案", ["競合差再提案"]),
                    ("初訪,競合差再提案", ["初訪", "競合差再提案"]), ("①初訪と⑤競合差再提案", ["初訪", "競合差再提案"]),
                    ("1", ["初訪"]), ("4-4 広告とオーガニックの成果比較", []), ("2-1 キーワード登場率だけ", []),
                    ("わからない", []), ("quick", ["初訪"])]:
        check(f"型 {v}", canon_statuses(v), want)
    for lab, want in [("参考資料", None), ("過去の提案資料", None), ("Instagram公式アカウント", None),
                      ("競合の公式アカウント", None), ("競合商品", None), ("TikTok上の狙い", None),
                      ("施策前スナップショット", "baseline"), ("目的とCTA", "campaign_goal"),
                      ("再提案の背景", "reproposal_context"), ("ブランドサイト", "official_site")]:
        check(f"ラベル {lab}", canon_key(lab), want)
    g6, u6 = parse("作りたい資料／章：初訪\n参考資料: https://example.com/2024/deck.pdf\n")
    check("URL の数字で型が上書きされない", (g6.get("status"), len(u6)), ("初訪", 1))
    g7, _ = parse("Instagram公式アカウント: https://www.instagram.com/toto_jp\n"
                  "公式TikTokアカウントURL: https://www.tiktok.com/@toto_official\n")
    check("他媒体の公式は公式TikTokに入らない", g7.get("official_tiktok"), "https://www.tiktok.com/@toto_official")
    g8, _ = parse("一般検索キーワード: #トイレリフォーム #洗面台交換\n指示: #PR投稿は除外\n")
    check("ハッシュタグのキーワード", g8.get("keywords"), ["トイレリフォーム", "洗面台交換"])
    check("行中の # を消さない", g8.get("instruction"), "#PR投稿は除外")
    g9, _ = parse("一般検索キーワード: キッチン・バス リフォーム、洗面台 交換\n競合: 無し\n")
    check("中黒でキーワードを割らない", g9.get("keywords"), ["キッチン・バス リフォーム", "洗面台 交換"])
    check("「無し」は競合名にしない", g9.get("competitors"), None)
    _, r10 = analyse("対象ブランド：TOTO\n作りたい資料／章：競合差再提案\n一般検索キーワード：トイレリフォーム\n")
    check("競合は AI に回さない", ("competitors" in r10["inputs"]["ai_derives"],
                                  sorted(r10["inputs"]["must_ask"])), (False, ["competitors", "reproposal_context"]))
    _, r11 = analyse("対象ブランド：TOTO\n作りたい資料／章：レポート\n施策開始日：2026-08-01\n"
                     "対象期間：8/1〜8/31\n施策前スナップショット：ない\n")
    check("施策前「ない」は聞き返さない", ("baseline" in r11["inputs"]["must_ask"], r11["baseline_absent"]),
          (False, True))
    check("推定のレポートでも施策開始日の注意が出る",
          any("遡れません" in x for x in warnings_for({}, ["レポート"])), True)
    _, r12 = analyse("対象ブランド：TOTO\n作りたい資料／章：初訪,競合差再提案\n")
    check("複数の型を縮めない", (r12["statuses"], r12["generate_modes"], r12["status_confirmed"]),
          (["初訪", "競合差再提案"], ["初訪", "競合差再提案"], True))
    _, r13 = analyse("対象ブランド：TOTO\n作りたい資料／章：構成提案\n一般検索キーワード：トイレリフォーム\n")
    check("構成提案は目的と制作条件を聞く", sorted(r13["inputs"]["must_ask"]),
          ["campaign_goal", "creative_constraints"])
    print("\n" + ("✅ 自己検査 OK" if ok else "❌ 自己検査 NG"))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="会話の前に情報を先出しする（ターン0）")
    ap.add_argument("--text", help="自由文をそのまま渡す（貼られた依頼票は --file で渡す。シェルのクォートが壊れる）")
    ap.add_argument("--file", help="自由文の入ったファイル（- で標準入力）")
    ap.add_argument("--template", nargs="?", const="", metavar="型",
                    help="貼り付け用テンプレを出す（--template 初訪 で選択式の初訪テンプレ）")
    ap.add_argument("--run-dir", help="intake.json を書き出す先")
    ap.add_argument("--case-json", metavar="PATH",
                    help="case.json の下書きを書く（案件ディレクトリか .json のパス。既存は上書きせず *.draft.json に書く）")
    ap.add_argument("--force", action="store_true", help="--case-json で既存の case.json を上書きする")
    ap.add_argument("--json", action="store_true", help="JSON で出す")
    ap.add_argument("--selftest", action="store_true", help="項目名の取り違えが無いかを検査する")
    args = ap.parse_args()
    utf8_stdio()

    if args.selftest:
        raise SystemExit(selftest())
    if args.template is not None:
        print(TEMPLATE_FV if canon_status(args.template or "") == "初訪" else TEMPLATE)
        return
    if not args.text and not args.file:
        fail("--text か --file か --template を指定してください")

    if args.text:
        text = args.text
    elif args.file == "-":
        try:
            text = (sys.stdin.buffer.read().decode("utf-8-sig") if hasattr(sys.stdin, "buffer")
                    else sys.stdin.read())
        except UnicodeDecodeError:
            fail("標準入力を UTF-8 として読めません（Shift_JIS は推測で読まない）")
    else:
        fp = Path(args.file).expanduser()
        if not fp.is_file():
            fail(f"依頼票のファイルがありません: {fp}")
        try:
            # メモ帳の「UTF-8（BOM付き）」も読む。BOM が1行目のラベルに付くと「対象ブランド」を読み落とす
            text = fp.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            fail(f"{fp} を UTF-8 として読めません。UTF-8 で保存し直してください（Shift_JIS は推測で読まない）")
    got, result = analyse(text)

    case_note = None
    if args.case_json:
        case = build_case_draft(got, result["status"])
        result["case_json"], case_note = write_case_draft(case, args.case_json, args.force)
        result["acquire_plan"] = acquire_plan(case)
        if case_note:
            result["case_json_note"] = case_note
    if args.run_dir:
        rd = Path(args.run_dir).expanduser()
        rd.mkdir(parents=True, exist_ok=True)
        (rd / "intake.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        result["saved"] = str(rd / "intake.json")

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    print_human(result, case_note)


if __name__ == "__main__":
    main()
