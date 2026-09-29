#!/usr/bin/env python3
"""Deterministically route a sales request to one of five deliverables.

The router is a conservative guardrail. An LLM may override its status when
conversation context clearly requires it, but must document the override
reason. Explicitly requested output modules always win and are never expanded
with the default modules of a broader status.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from typing import Iterable, Sequence


STATUS = {
    # 初訪（2026-09 再設計）: 約8枚・画像＋ワンフレーズ。軸は (A) カテゴリで伸びている投稿
    # (B) 競合のコミュニケーション の2本だけ。自社公式の露出やフォロワー帯を主役にした旧初訪は廃止。
    # 初訪は単独の資料で、二次提案（具体提案など）とは別ファイルにする。
    1: {
        "name": "初訪",
        "purpose": "現状と競合の発信を見せ、伸びている型をお土産に二次提案へつなぐ",
        "modules": [
            "current_search_view",
            "competitor_communication",
            "competitor_paid_push",
            "posting_gap",
            "category_winning_types",
            "first_three_ideas",
        ],
    },
    2: {
        "name": "具体提案",
        "purpose": "検索上位の傾向から提案の方向性を合意する",
        "modules": [
            "top_video_patterns",
            "keyword_presence_comparison",
            "killer_creative_analysis",
            "creative_direction",
        ],
    },
    3: {
        "name": "構成提案",
        "purpose": "合意した方向性を投稿構成・台本・検証案へ落とす",
        "modules": [
            "video_structure_proposals",
            "script_storyboard",
            "ab_test_plan",
        ],
    },
    4: {
        "name": "レポート",
        "purpose": "施策前後と自社投稿の成果を検証し、次の改善を決める",
        "modules": [
            "pre_post_search_exposure",
            "own_post_performance",
            "improvement_actions",
        ],
    },
    5: {
        "name": "競合差再提案",
        "purpose": "競合との差と未充足領域から独立した再提案を作る",
        "modules": [
            "competitive_gap",
            "representative_post_comparison",
            "reproposal_opportunities",
            "reproposal_plan",
        ],
    },
}

# 旧初訪のモジュール。初訪の標準章からは外したが、明示されたときの項目としては残す。
# 判定の手掛かりとしては従来どおり初訪寄りに数える（明示依頼の分類を変えないため）。
LEGACY_STATUS_MODULES = {
    1: (
        "search_exposure_share", "account_search_visibility", "brand_search_visibility",
        "poster_type_breakdown", "hashtag_composition", "pr_disclosure_comparison",
    ),
}

MODULE_LABEL = {
    "current_search_view": "いま検索するとこう見える（カテゴリ検索の上位）",
    "competitor_communication": "競合はこう発信している（切り口・訴求）",
    "competitor_paid_push": "競合がお金をかけて広げている訴求（PR・公式）",
    "posting_gap": "クライアントに足りていない発信（競合・市場との差）",
    "category_winning_types": "カテゴリでいま伸びている型（お土産）",
    "first_three_ideas": "まずこの3本（最初の投稿案）",
    "search_exposure_share": "一般キーワード検索での露出シェア",
    "account_search_visibility": "一般キーワード検索での顧客公式アカウント露出",
    "brand_search_visibility": "ブランド名検索での顧客公式アカウント露出",
    "poster_type_breakdown": "公式投稿／第三者投稿の構成",
    "hashtag_composition": "上位投稿のハッシュタグ内訳",
    "pr_disclosure_comparison": "#PR表記あり／なしの比較",
    "keyword_presence_comparison": "対象キーワードの登場率・登場回数比較",
    "top_video_patterns": "検索上位動画の共通点",
    "killer_creative_analysis": "キラー演出の実画面分析",
    "creative_direction": "取り入れるべき企画方向",
    "video_structure_proposals": "動画構成案",
    "script_storyboard": "台本・絵コンテ案",
    "ab_test_plan": "ABテスト案",
    "pre_post_search_exposure": "施策前後の検索露出比較",
    "own_post_performance": "自社投稿の成果比較",
    "improvement_actions": "次回の改善案",
    "competitive_gap": "自社と競合の差分",
    "representative_post_comparison": "各社の代表投稿比較（指定された指標のみ）",
    "reproposal_opportunities": "未充足領域・再提案機会",
    "reproposal_plan": "再提案プラン",
}

MODULE_PATTERNS = {
    "current_search_view": (
        r"検索(?:する|した)と.{0,8}(?:どう|こう)(?:見え|出)", r"(?:いま|今)の検索(?:面|結果)",
    ),
    "competitor_communication": (r"競合.{0,6}発信",),
    "competitor_paid_push": (r"お金をかけ(?:て|た)", r"競合.{0,8}(?:pr|広告).{0,8}訴求"),
    "posting_gap": (r"足りていない発信", r"足りない発信"),
    "category_winning_types": (r"伸びている型", r"伸びてる型", r"お土産"),
    "first_three_ideas": (r"まず(?:この)?3本", r"最初の3本"),
    "search_exposure_share": (
        r"露出シェア", r"検索シェア", r"share\s*of\s*search", r"シェアオブサーチ",
    ),
    "account_search_visibility": (
        r"(?:顧客|自社|公式)アカウント(?:の)?(?:検索)?露出",
        r"一般キーワード.{0,12}(?:公式|顧客|自社)アカウント",
        r"一般(?:キーワード)?検索.{0,16}(?:公式|顧客|自社)(?:アカウント|投稿)?",
        r"(?:公式|顧客|自社)(?:アカウント|投稿)?.{0,16}一般(?:キーワード)?検索",
    ),
    "brand_search_visibility": (
        r"ブランド名検索.{0,12}(?:露出|公式|アカウント)",
        r"指名検索.{0,12}(?:露出|公式|アカウント)",
        r"(?:公式|顧客|自社)(?:アカウント|投稿)?.{0,16}(?:ブランド名|指名)検索",
    ),
    "poster_type_breakdown": (
        r"公式投稿.{0,12}第三者投稿", r"投稿者(?:の)?内訳", r"公式(?:と|／|/)(?:第三者|一般投稿者)",
    ),
    "hashtag_composition": (r"ハッシュタグ(?:の)?内訳", r"タグ(?:の)?内訳", r"使用タグ"),
    "pr_disclosure_comparison": (r"#\s*pr", r"pr表記", r"広告表記"),
    "keyword_presence_comparison": (
        r"キーワード(?:の)?(?:登場率|登場回数|出現率|出現回数)",
        r"(?:テロップ|音声).{0,12}(?:登場|出現|回数|頻度)",
    ),
    "top_video_patterns": (
        r"上位(?:動画|投稿).{0,12}(?:共通点|傾向|パターン)",
        r"検索上位(?:の)?(?:共通点|傾向|パターン)",
        r"勝ちパターン",
    ),
    "killer_creative_analysis": (r"キラー演出", r"勝ち演出"),
    "creative_direction": (r"企画方向", r"クリエイティブ方向", r"投稿方向"),
    "video_structure_proposals": (r"動画構成(?:案)?", r"構成案"),
    "script_storyboard": (r"台本", r"絵コンテ", r"秒(?:単位|ごと)の構成"),
    "ab_test_plan": (r"a\s*/?\s*bテスト", r"abテスト", r"比較テスト"),
    "pre_post_search_exposure": (
        r"施策前後.{0,12}(?:検索|露出|比較)", r"検索露出.{0,12}前後比較",
    ),
    "own_post_performance": (
        r"自社投稿.{0,12}(?:成果|実績|再生|保存|効果)", r"投稿実績", r"投稿成果",
    ),
    "improvement_actions": (r"改善案", r"次回改善", r"次の打ち手"),
    "competitive_gap": (
        r"競合(?:との)?(?:差|差分|ギャップ)", r"自社と競合の違い",
    ),
    "representative_post_comparison": (
        r"(?:各社|競合|ブランド).{0,16}(?:各)?[0-9]+(?:[〜~\-～][0-9]+)?本.{0,20}(?:比較|並べ)",
        r"(?:サムネ|実画面|代表投稿).{0,20}(?:保存数|保存率|構成|比較)",
        r"保存数.{0,16}(?:比較|ページ|一覧)",
    ),
    "reproposal_opportunities": (r"再提案機会", r"未充足領域", r"空白領域"),
    "reproposal_plan": (r"再提案(?:プラン|案|資料)?", r"再アプローチ(?:案|資料)?"),
}

DIRECT_MARKERS = (
    r"だけ", r"のみ", r"に絞", r"作りたい", r"作って", r"作成", r"資料",
    r"出して", r"ほしい", r"欲しい", r"まとめて", r"入れて", r"載せて",
    r"分析して", r"比較して", r"知りたい", r"見たい",
)

NEGATIVE_MARKERS = (
    r"不要", r"いらない", r"要らない", r"除外", r"省く", r"省いて",
    r"含めない", r"入れない", r"載せない", r"やらない", r"なし", r"ではなく",
)

OUTPUT_FORMAT_PATTERNS = {
    "pptx": (r"pptx", r"powerpoint", r"パワーポイント"),
    "pdf": (r"pdf",),
}

STATUS_SCORE_PATTERNS = {
    1: (
        (r"初訪|初回訪問|初回商談|初回アポ", 6),
        (r"信頼(?:を得|獲得)", 4),
        (r"現状把握|現在地|まず.{0,8}把握", 3),
        (r"一般キーワード|検索露出|露出シェア|ブランド名検索|指名検索", 2),
        (r"お土産|伸びている型|伸びてる型|競合.{0,6}発信", 2),
    ),
    2: (
        (r"具体提案", 6),
        (r"提案.{0,8}(?:方向|合意)|方向性.{0,8}合意", 4),
        (r"上位(?:動画|投稿)|検索上位|共通点|勝ちパターン|キラー演出", 3),
        (r"企画方向|クリエイティブ方向", 2),
    ),
    3: (
        (r"構成提案", 6),
        (r"動画構成|構成案|台本|絵コンテ", 4),
        (r"制作|撮影|秒(?:単位|ごと)|abテスト|a\s*/\s*bテスト", 2),
    ),
    4: (
        (r"実施後レポート|投稿後レポート|効果検証レポート", 7),
        (r"レポート", 5),
        (r"(?:来月|これから|開始前|実施前).{0,16}施策|施策.{0,16}(?:開始予定|開始前|未実施)", 5),
        (r"まだ.{0,12}(?:検索)?データ.{0,8}(?:ない|未取得|取っていない)", 3),
        (r"施策前後|前後比較|効果検証|投稿後|施策後", 4),
        # 「効果を報告」「結果を共有」は④の頻出表現だが、旧パターンのどれにも当たらず
        # status_name=null に落ちていた（実測で確認）。報告・共有系の言い回しを補う。
        (r"(?:効果|結果|数字|成果).{0,8}(?:報告|共有|まとめ|提出)|報告(?:書|資料)", 5),
        (r"(?:先月|前月|今月|先週|前回).{0,12}(?:施策|投稿|配信|やった)", 3),
        (r"振り返り|実績|成果|継続提案|改善", 2),
    ),
    5: (
        (r"再提案|再アプローチ", 7),
        (r"休眠|失注|巻き返し|掘り起こし", 5),
        (r"競合(?:との)?(?:差|差分|ギャップ)|未充足領域|空白領域", 3),
        (r"(?:各社|複数ブランド).{0,20}(?:比較|並べ)|保存数.{0,12}比較", 2),
    ),
}

INPUT_ALIASES = {
    "target_brand": ("brand", "client_brand", "対象ブランド", "ブランド"),
    "target_product": ("product", "current_product", "現行商品", "対象商品"),
    "official_site_url": (
        "site_url", "official_website", "公式サイトurl", "公式サイト",
    ),
    "official_tiktok_account": (
        "tiktok_account", "official_tiktok_url", "公式tiktok",
        "公式tiktokアカウント",
    ),
    "general_search_keywords": (
        "general_keywords", "一般キーワード", "一般検索キーワード",
    ),
    "target_keywords": ("keywords", "first_recall_keywords", "第一想起キーワード"),
    "competitor_brands": ("competitors", "競合", "競合ブランド"),
    "category_name": ("category", "カテゴリ", "カテゴリ名"),
    "vocab_preset": ("vocab", "業種", "業種プリセット"),
    "general_keyword_search_excel": (
        "general_search_excel", "market_search_excel", "一般キーワード検索excel",
    ),
    "brand_keyword_search_excel": ("brand_search_excel", "ブランド名検索excel"),
    "own_brand_search_excel": ("own_search_excel", "自社検索excel"),
    "competitor_search_excels": ("competitor_excels", "競合検索excel"),
    "search_result_excels": ("search_excels", "検索結果excel"),
    "analysis_evidence": ("analysis_source", "分析根拠", "分析用データ"),
    "campaign_goal": ("goal", "施策目的", "投稿目的"),
    "creative_constraints": ("constraints", "制作条件", "表現条件"),
    "prior_analysis_data": (
        "stage2_analysis", "previous_analysis", "②の確定資料", "前段分析", "既存分析資料",
    ),
    "campaign_start_date": ("launch_date", "施策開始日", "開始日"),
    "reproposal_context": ("reproposal_background", "再提案背景", "再提案の背景"),
    "pre_campaign_search_data": (
        "pre_data", "baseline", "施策前データ", "事前データ",
    ),
    "post_campaign_search_data": ("post_data", "施策後データ", "事後データ"),
    "own_post_results": ("post_results", "自社投稿実績", "投稿実績"),
    "post_management_sheet": ("management_sheet", "投稿管理シート", "管理シート"),
    "measurement_periods": ("periods", "comparison_periods", "比較期間", "計測期間"),
}

INPUT_LABEL = {
    "target_brand": "対象ブランド",
    "target_product": "対象商品",
    "official_site_url": "公式サイトURL",
    "official_tiktok_account": "公式TikTokアカウントURL",
    "general_search_keywords": "一般検索キーワード",
    "target_keywords": "狙うキーワード",
    "competitor_brands": "競合ブランド",
    "category_name": "カテゴリ名（1つ）",
    "vocab_preset": "業種（食品・飲料／美容・コスメ／汎用）",
    "general_keyword_search_excel": "一般キーワード検索結果Excel",
    "brand_keyword_search_excel": "ブランド名検索結果Excel",
    "own_brand_search_excel": "自社ブランド検索結果Excel",
    "competitor_search_excels": "競合各社の検索結果Excel",
    "search_result_excels": "分析対象の検索結果Excel",
    "analysis_evidence": "検索結果Excelまたは②の確定資料",
    "campaign_goal": "投稿・施策の目的",
    "creative_constraints": "制作条件・表現上の制約",
    "prior_analysis_data": "②の確定資料または既存の分析データ",
    "campaign_start_date": "施策開始日",
    "reproposal_context": "再提案の背景",
    "pre_campaign_search_data": "施策前の検索結果データ",
    "post_campaign_search_data": "施策後の検索結果データ",
    "own_post_results_or_post_management_sheet": "自社投稿実績または投稿管理シート",
    "measurement_periods": "施策前後の計測期間",
}

STAGE_REQUIRED = {
    # 初訪: 業種（語彙）・カテゴリ名・競合（軸B。未確認なら「想定」で可）・公式TikTok
    1: (
        "target_brand", "vocab_preset", "category_name",
        "competitor_brands", "official_tiktok_account",
    ),
    2: (
        "target_brand", "target_product", "target_keywords", "campaign_goal",
    ),
    3: (
        "target_brand", "target_product", "official_site_url",
        "target_keywords", "campaign_goal", "creative_constraints",
        "analysis_evidence",
    ),
    4: (
        "target_brand", "official_tiktok_account", "campaign_start_date",
        "measurement_periods",
        "pre_campaign_search_data", "post_campaign_search_data",
        "own_post_results_or_post_management_sheet",
    ),
    5: (
        "target_brand", "target_product", "official_site_url",
        "target_keywords", "competitor_brands", "reproposal_context", "campaign_goal",
    ),
}

MODULE_REQUIRED = {
    "current_search_view": ("category_name",),
    "competitor_communication": ("category_name", "competitor_brands"),
    "competitor_paid_push": ("category_name", "competitor_brands"),
    "posting_gap": ("target_brand", "category_name", "competitor_brands"),
    "category_winning_types": ("category_name",),
    "first_three_ideas": ("target_brand", "category_name"),
    "search_exposure_share": (
        "target_brand", "general_search_keywords",
    ),
    "account_search_visibility": (
        "target_brand", "official_tiktok_account",
    ),
    "brand_search_visibility": (
        "target_brand", "official_tiktok_account",
    ),
    "poster_type_breakdown": (
        "target_brand", "official_tiktok_account",
    ),
    "hashtag_composition": ("search_result_excels",),
    "pr_disclosure_comparison": ("target_brand", "search_result_excels"),
    "keyword_presence_comparison": (
        "target_brand", "target_product", "target_keywords",
    ),
    "top_video_patterns": ("target_brand", "target_keywords", "search_result_excels"),
    "killer_creative_analysis": (
        "target_brand", "target_keywords",
    ),
    "creative_direction": (
        "target_brand", "target_product", "official_site_url", "campaign_goal",
    ),
    "video_structure_proposals": (
        "target_brand", "target_product", "official_site_url", "campaign_goal",
        "creative_constraints",
    ),
    "script_storyboard": (
        "target_brand", "target_product", "official_site_url", "campaign_goal",
        "creative_constraints",
    ),
    "ab_test_plan": ("campaign_goal", "creative_constraints"),
    "pre_post_search_exposure": (
        "target_brand", "measurement_periods", "pre_campaign_search_data",
        "post_campaign_search_data",
    ),
    "own_post_performance": (
        "target_brand", "measurement_periods",
        "own_post_results_or_post_management_sheet",
    ),
    "improvement_actions": (
        "target_brand", "pre_campaign_search_data", "post_campaign_search_data",
        "own_post_results_or_post_management_sheet",
    ),
    "competitive_gap": (
        "target_brand", "target_keywords",
    ),
    "representative_post_comparison": (
        "target_brand",
    ),
    "reproposal_opportunities": (
        "target_brand", "target_product", "official_site_url", "target_keywords",
        "competitor_brands",
    ),
    "reproposal_plan": (
        "target_brand", "target_product", "official_site_url",
        "campaign_goal",
    ),
}


def normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").strip().lower()


def match_is_negated(text: str, match: re.Match[str]) -> bool:
    """Return True when a matched request item is locally excluded."""
    before = text[max(0, match.start() - 10):match.start()]
    after = text[match.end():match.end() + 18]
    if re.search(r"(?:不要な|除外する|省く)\s*$", before):
        return True
    return bool(re.match(
        r"(?:は|を|が|については|に関しては)?\s*(?:" + "|".join(NEGATIVE_MARKERS) + r")",
        after,
    ))


def extract_output_formats(text: str) -> list[str]:
    formats = [
        name for name, patterns in OUTPUT_FORMAT_PATTERNS.items()
        if any(re.search(pattern, text) for pattern in patterns)
    ]
    # 指定が無ければ PPTX だけ。generate.js は PDF を出さない（変換できる環境でだけ後から作る）。
    # 既定を PPTX＋PDF にしていたため、返信テンプレが PDF の納品を約束していた（2026-09 監査）
    return formats or ["pptx"]


def extract_constraints(text: str) -> dict[str, list[str] | str | None]:
    item_counts = re.findall(
        r"(?:各社|各ブランド|各)?\s*[0-9]+(?:\s*[〜~\-～]\s*[0-9]+)?\s*本(?:ずつ)?",
        text,
    )
    page_counts = re.findall(r"[0-9]+\s*(?:ページ|枚)", text)
    exclusions = []
    for marker in ("不要", "いらない", "要らない", "除外", "含めない", "入れない"):
        for match in re.finditer(rf"([^。\n、]{{1,30}}?)(?:は|を)?{marker}", text):
            exclusions.append(match.group(0).strip())
    return {
        "item_counts": item_counts,
        "page_counts": page_counts,
        "exclusions": exclusions,
    }


def has_custom_explicit_output(text: str, modules: Sequence[str]) -> bool:
    """Recognize concrete deliverables even when they are not a named module."""
    if not any(re.search(marker, text) for marker in DIRECT_MARKERS):
        return False
    concrete = bool(re.search(
        r"サムネ|実画面|代表投稿|保存数|保存率|比較表|グラフ|スライド|ページ|"
        r"[0-9]+(?:[〜~\-～][0-9]+)?本(?:ずつ)?|[0-9]+(?:ページ|枚)",
        text,
    ))
    return concrete and not modules


def input_alias_map() -> dict[str, str]:
    reverse = {}
    for canonical, aliases in INPUT_ALIASES.items():
        reverse[normalize(canonical)] = canonical
        reverse.update({normalize(alias): canonical for alias in aliases})
    return reverse


def parse_available_inputs(values: Iterable[str]) -> tuple[set[str], dict[str, str]]:
    reverse = input_alias_map()
    keys = set()
    received_values = {}
    for item in values:
        raw = str(item or "").strip()
        if not raw:
            continue
        raw_key, separator, raw_value = raw.partition("=")
        key = reverse.get(normalize(raw_key), normalize(raw_key))
        keys.add(key)
        if separator and raw_value.strip():
            received_values[key] = raw_value.strip()
    return keys, received_values


def canonicalize_inputs(values: Iterable[str]) -> set[str]:
    return parse_available_inputs(values)[0]


STATUS_NAME_PATTERNS = (
    (1, r"初訪|初回訪問|初回商談|初回アポ"),
    (2, r"具体提案"),
    (3, r"構成提案"),
    (4, r"実施後レポート|投稿後レポート|効果検証レポート|レポート(?:を|の|に|が)"),
    # 「競合差の再提案」は型の名前。ここで1語として拾わないと、「競合差」「再提案」が章の明示
    # （competitive_gap / reproposal_plan）と読まれ、競合・再提案の背景が必須入力から落ちていた
    (5, r"競合差再提案|競合差(?:の|による)?再提案|再提案|再アプローチ"),
)


def unique_in_order(values: Iterable[int | str]) -> list:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def _numeric_status_candidates(text: str) -> list[int]:
    """Extract 1-5 only when the surrounding words describe deck selection.

    NFKC normalization turns circled numerals into ordinary digits before this
    function is called.  The context guard deliberately rejects page counts
    such as ``135ページ`` and unrelated quantities.
    """
    request_marker = (
        r"(?:入れて|含めて|まとめて|統合|組み合わせ|作って|作成|出して|資料|内容|"
        r"ステータス|段階|分類|それぞれ|別々|個別)"
    )
    ordered_marker = (
        rf"(?:を|の)?\s*(?:この|指定|記載|書いた)順(?:番)?(?:で|に)?\s*"
        rf"(?:{request_marker}|1つ|一つ)"
    )
    context_after = rf"(?:(?:を|の)?\s*{request_marker}|{ordered_marker})"
    context_before = r"(?:ステータス|stage|段階|分類|作りたい資料|作成資料)\s*[:：]?\s*"
    separator = r"(?:\s*(?:と|,|、|\+|＋|/|・|&|および|及び|ならびに)\s*)"
    token = r"[1-5]"

    candidates: list[tuple[int, str]] = []
    labelled = re.finditer(
        rf"{context_before}([1-5]{{2,5}}|(?:{token})(?:{separator}{token})*)",
        text,
    )
    for match in labelled:
        if re.match(r"\s*(?:ページ|頁|枚|本)", text[match.end(1):]):
            continue
        candidates.append((match.start(1), match.group(1)))

    listed = re.finditer(rf"((?:{token})(?:{separator}{token})+)(?=\s*{context_after})", text)
    for match in listed:
        candidates.append((match.start(1), match.group(1)))

    compact = re.finditer(rf"(?<![0-9])([1-5]{{2,5}})(?![0-9])(?=\s*{context_after})", text)
    for match in compact:
        # A direct unit after the digits always means a count, not statuses.
        if re.match(r"\s*(?:ページ|頁|枚|本)", text[match.end():]):
            continue
        candidates.append((match.start(1), match.group(1)))

    # An input made solely of statuses is unambiguous and common in a chat
    # follow-up (for example, ``1,5,3`` or ``123``).
    whole = re.fullmatch(rf"\s*((?:{token})(?:{separator}{token})+|[1-5]{{2,5}})\s*", text)
    if whole:
        candidates.append((whole.start(1), whole.group(1)))

    # Preserve the long-standing support for a single leading/status-labelled
    # number, including a normalized circled numeral.
    single = re.finditer(
        r"(?:^\s*|(?:ステータス|stage|段階|分類)\s*)([1-5])"
        r"(?=\s*(?:初訪|初回|具体提案|構成提案|レポート|競合差|再提案|[.:：、)\s]))",
        text,
    )
    for match in single:
        candidates.append((match.start(1), match.group(1)))

    if not candidates:
        return []
    _, raw = min(candidates, key=lambda item: item[0])
    return unique_in_order(int(value) for value in re.findall(r"[1-5]", raw))


def _named_status_candidates(text: str) -> list[tuple[int, int, int]]:
    found = []
    for status_id, pattern in STATUS_NAME_PATTERNS:
        for match in re.finditer(pattern, text):
            if not match_is_negated(text, match):
                found.append((match.start(), match.end(), status_id))
    return sorted(found)


def _names_form_explicit_list(text: str, found: Sequence[tuple[int, int, int]]) -> bool:
    if len({item[2] for item in found}) < 2:
        return False
    joiner = re.compile(r"^\s*(?:と|、|,|\+|＋|/|・|&|および|及び|ならびに)\s*$")
    return all(
        joiner.match(text[left[1]:right[0]])
        for left, right in zip(found, found[1:])
    )


def find_explicit_statuses(text: str) -> tuple[list[int], str | None]:
    # Also accept numbered names such as ``①初訪、⑤競合差再提案、③構成提案``.
    # Pairing each number with its matching label prevents ordinary numbered
    # prose from being mistaken for a status selection.
    numbered_names = []
    for match in re.finditer(r"(?<![0-9])([1-5])\s*[|｜:：.)）-]?\s*", text):
        status_id = int(match.group(1))
        label_match = re.match(STATUS_NAME_PATTERNS[status_id - 1][1], text[match.end():])
        if label_match:
            numbered_names.append((match.start(), status_id))
    if len({item[1] for item in numbered_names}) > 1:
        status_ids = unique_in_order(item[1] for item in numbered_names)
        joined = "・".join(str(status_id) for status_id in status_ids)
        return status_ids, f"営業がステータス{joined}を名称付きで明示"

    numeric = _numeric_status_candidates(text)
    if numeric:
        joined = "・".join(str(status_id) for status_id in numeric)
        return numeric, f"営業がステータス{joined}を明示"

    named = _named_status_candidates(text)
    if _names_form_explicit_list(text, named):
        status_ids = unique_in_order(item[2] for item in named)
        labels = "＋".join(STATUS[status_id]["name"] for status_id in status_ids)
        return status_ids, f"営業が「{labels}」を明示"
    if named:
        status_id = named[0][2]
        return [status_id], f"営業が「{STATUS[status_id]['name']}」を明示"
    return [], None


def find_explicit_status(text: str) -> tuple[int | None, str | None]:
    """Backward-compatible single-status view used by external callers."""
    status_ids, reason = find_explicit_statuses(text)
    return (status_ids[0] if status_ids else None), reason


def requested_as_separate_decks(text: str) -> bool:
    return bool(re.search(
        r"別々|それぞれ(?:で|に|の)?(?:資料|ファイル|出力|作成|出して)?|"
        r"個別(?:に|で|の)?(?:資料|ファイル|出力|作成)?",
        text,
    ))


def chapter_order(status_ids: Sequence[int], text: str) -> list[int]:
    if re.search(r"この順番|指定順|書いた順|記載順|順番通り", text):
        return list(status_ids)
    narrative_order = (1, 5, 2, 3, 4)
    return [status_id for status_id in narrative_order if status_id in status_ids]


def find_explicit_modules(text: str, ignore_spans: Sequence[tuple[int, int]] = ()) -> list[str]:
    """Find explicitly requested modules.

    ``ignore_spans`` are the spans of status names (for example 「競合差の再提案」).  A module
    pattern that matches only inside a status name is that status being named, not a module
    request, so it must not narrow the deck to that module.
    """
    if not any(re.search(marker, text) for marker in DIRECT_MARKERS):
        return []
    found = []
    for module, patterns in MODULE_PATTERNS.items():
        starts = []
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                if any(a <= match.start() and match.end() <= b for a, b in ignore_spans):
                    continue
                if not match_is_negated(text, match):
                    starts.append(match.start())
        if starts:
            found.append((min(starts), module))

    # A compact phrase such as "公式が一般検索・ブランド検索の両方に出るか"
    # expresses both official-account visibility modules even if it omits
    # the word "アカウント".
    if re.search(r"公式.{0,24}一般(?:キーワード)?検索.{0,24}(?:ブランド名|ブランド|指名)検索", text):
        inferred = (
            ("account_search_visibility", max(text.find("一般"), 0)),
            (
                "brand_search_visibility",
                max(text.find("ブランド名"), text.find("ブランド"), text.find("指名"), 0),
            ),
        )
        for module, position in inferred:
            if module not in {item[1] for item in found}:
                found.append((position, module))
    return [module for _, module in sorted(found)]


def score_statuses(text: str, modules: Sequence[str]) -> dict[int, int]:
    scores = {status_id: 0 for status_id in STATUS}
    for status_id, patterns in STATUS_SCORE_PATTERNS.items():
        for pattern, weight in patterns:
            matches = [m for m in re.finditer(pattern, text) if not match_is_negated(text, m)]
            if matches:
                scores[status_id] += weight
    for module in modules:
        for status_id, status in STATUS.items():
            if module in status["modules"] or module in LEGACY_STATUS_MODULES.get(status_id, ()):
                scores[status_id] += 4
    return scores


def required_inputs(
    status_id: int | None, modules: Sequence[str], explicit_modules: bool
) -> list[str]:
    groups = (
        [MODULE_REQUIRED.get(module, ()) for module in modules]
        if explicit_modules
        else [STAGE_REQUIRED.get(status_id, ())]
    )
    result = []
    for group in groups:
        for key in group:
            if key not in result:
                result.append(key)
    # 検索結果Excel は取得経路の一本化で廃止した。要求キーとしても持たない
    if "search_result_excels" in result:
        result.remove("search_result_excels")
    return result


def required_inputs_for_statuses(status_ids: Sequence[int]) -> list[str]:
    result = []
    for status_id in status_ids:
        for key in STAGE_REQUIRED.get(status_id, ()):
            if key not in result:
                result.append(key)
    return result


def missing_inputs(required: Sequence[str], available: set[str]) -> list[str]:
    missing = []
    for key in required:
        if key == "own_post_results_or_post_management_sheet":
            if not ({"own_post_results", "post_management_sheet"} & available):
                missing.append(key)
        elif key == "analysis_evidence":
            alternatives = {
                "prior_analysis_data",
            }
            if not (alternatives & available):
                missing.append(key)
        elif key == "target_keywords":
            if not ({"target_keywords", "general_search_keywords"} & available):
                missing.append(key)
        elif key == "category_name":
            # 初訪はカテゴリ名で検索する。一般検索キーワードが来ていればそれで代える
            if not ({"category_name", "general_search_keywords"} & available):
                missing.append(key)
        elif key not in available:
            missing.append(key)
    return missing


def campaign_not_started(text: str) -> bool:
    return bool(re.search(
        r"まだ.{0,8}(?:始ま|開始|実施|投稿)していない|未実施|開始前|実施前|施策前(?!後)|"
        r"ローンチ前|これから.{0,8}(?:開始|実施|投稿|施策)|"
        r"(?:来月|来週|今後).{0,12}施策|施策.{0,12}(?:始める|開始予定)",
        text,
    ))


def make_reply(
    status_id: int | None,
    status_ids: Sequence[int],
    ordered_status_ids: Sequence[int],
    combined_deck: bool,
    deck_count: int,
    modules: Sequence[str],
    missing: Sequence[str],
    available: set[str],
    received_values: dict[str, str],
    needs_clarification: bool,
    question: str | None,
    explicit_scope: bool,
    reasons: Sequence[str],
    requested_output_text: str,
    output_formats: Sequence[str],
    baseline_missing: bool,
    before_launch: bool,
    first_visit_alone: bool = False,
) -> str:
    lines = []
    multiple_statuses = len(status_ids) > 1
    if multiple_statuses:
        chapter_label = "＋".join(
            f"{status_id}｜{STATUS[status_id]['name']}" for status_id in ordered_status_ids
        )
        output_label = "1資料に統合" if combined_deck else f"{deck_count}資料を個別作成"
        if first_visit_alone:
            output_label = (f"初訪は単独＋残りを1資料に統合（計{deck_count}資料）" if combined_deck
                            else f"初訪は単独（計{deck_count}資料）")
        lines.append(f"判定：{chapter_label}（{output_label}）")
        lines.append("判断理由：営業が複数ステータスを明示したため、指定範囲をまとめて扱います。")
    elif explicit_scope:
        lines.append("判定：明示された作成内容を優先")
        if status_id is not None:
            lines.append(f"参考分類：{status_id}｜{STATUS[status_id]['name']}")
        lines.append("判断理由：作成内容が明確なため、ご指定をそのまま資料仕様にします。")
    elif status_id is None:
        lines.append("判定：保留")
    else:
        lines.extend([
            f"判定：{status_id}｜{STATUS[status_id]['name']}",
            f"目的：{STATUS[status_id]['purpose']}",
        ])
    if reasons and not explicit_scope and not multiple_statuses:
        lines.append(f"判断理由：{reasons[0]}")

    if needs_clarification and question:
        lines.extend(["", f"確認：{question}"])
        return "\n".join(lines)

    if multiple_statuses:
        lines.extend(["", "作成予定の章："])
        for selected_id in ordered_status_ids:
            lines.append(f"・{selected_id}｜{STATUS[selected_id]['name']}：{STATUS[selected_id]['purpose']}")
        if first_visit_alone:
            lines.append(f"・出力：初訪は単独の資料、{'残りは1つの統合資料' if combined_deck else '残りは別の資料'}"
                         f"（計{deck_count}資料）")
        else:
            lines.append(f"・出力：{'1つの統合資料' if combined_deck else f'{deck_count}つの個別資料'}")
    elif explicit_scope:
        lines.extend(["", "ご指定の作成内容："])
        lines.append(f"・{requested_output_text}")
    elif modules:
        lines.extend(["", "作成予定："])
        lines.extend(f"・{MODULE_LABEL[module]}" for module in modules)
    lines.append(f"・形式：{'＋'.join(fmt.upper() for fmt in output_formats)}")

    lines.extend(["", "受領済み情報："])
    if available:
        for key in sorted(available):
            label = INPUT_LABEL.get(key, key)
            value = received_values.get(key)
            lines.append(f"・{label}：{value}" if value else f"・{label}")
    else:
        lines.append("・なし")

    if 4 in status_ids and baseline_missing and before_launch:
        lines.append("")
        lines.append("重要：施策を始める前に、比較用の基準データを必ず取得してください。")
        lines.extend([
            "今すぐ取得・保存するもの：",
            "・一般キーワードとブランド名の検索結果（tiktok-acquire が自動で取得します）",
            "・公式アカウントの投稿一覧と主要指標",
            # ログイン状態は記録しない。この一式は非ログインで取得するため、
            # 「ログインアカウント」を聞くとログインを促す誤解になる
            "・取得日時、地域、デフォルト表示順、取得件数（いずれも取得JSONに記録されます）",
            "・施策後も同じ検索語・同じ条件で取得すること",
            "・収集方法：`tiktok-acquire` の search.mjs を同じ引数で再実行してください",
            "",
            "取得後は「施策前の基準データとして保存」と入力してください。"
            "施策後データが揃うまで、効果比較資料は作成しません。",
        ])
        lines.extend(["", "以下をコピーしてご返信ください。"])
        for key in missing:
            lines.append(f"{INPUT_LABEL.get(key, key)}：")
        lines.append("指示：添付データを施策前の基準データとして保存してください")
        return "\n".join(lines)

    if missing:
        lines.extend(["", "不足している必須情報："])
        lines.extend(f"・{INPUT_LABEL.get(key, key)}" for key in missing)

    if 4 in status_ids and baseline_missing:
        lines.append("")
        lines.append(
            "重要：施策前の検索結果がないため、施策による増減や効果は厳密には比較できません。"
            "未開始なら投稿・配信前に取得してください。開始済みなら、現状値だけの暫定版を作るか確認します。"
        )

    lines.extend(["", "以下をコピーしてご返信ください。"])
    for key in missing:
        if key == "competitor_brands" and 1 in status_ids:
            # 初訪の競合は1行1社（intake_form.py が読む形）。未確認なら「想定」で進める
            lines.append("競合1：（正式名（略称）｜確認済み または 想定｜@公式ID または 無し）")
            lines.append("競合2：")
        else:
            lines.append(f"{INPUT_LABEL.get(key, key)}：")
    lines.append(f"希望形式：{'＋'.join(fmt.upper() for fmt in output_formats)}")
    lines.append("指示：この内容で資料を作成してください")
    if explicit_scope:
        lines.append("※明示された作成内容だけを出力し、他ステータスの項目は追加しません。")
    return "\n".join(lines)


def route_request(request: str, available_inputs: Iterable[str] = ()) -> dict:
    original_request = (request or "").strip()
    text = normalize(request)
    if not text:
        raise ValueError("request must not be empty")

    explicit_status_ids, explicit_status_reason = find_explicit_statuses(text)
    explicit_status_id = explicit_status_ids[0] if explicit_status_ids else None
    status_name_spans = [(start, end) for start, end, _ in _named_status_candidates(text)]
    detected_modules = find_explicit_modules(text, status_name_spans)
    constraints = extract_constraints(text)
    concrete_scope_marker = bool(re.search(
        r"だけ|のみ|に絞|ページ|スライド|各\s*[0-9]+|"
        r"[0-9]+(?:[〜~\-～][0-9]+)?本|pdf|pptx|載せて|入れて|出して",
        text,
    ))
    # A named status alone selects its default package. Specific module
    # requests override that package when the salesperson limits the scope,
    # gives concrete output constraints, or enumerates three or more items.
    has_explicit_modules = bool(detected_modules) and (
        explicit_status_id is None or concrete_scope_marker or len(detected_modules) >= 3
    )
    has_custom_output = has_custom_explicit_output(text, detected_modules)
    explicit_scope = has_explicit_modules or has_custom_output
    modules = list(detected_modules) if has_explicit_modules else []
    output_formats = extract_output_formats(text)
    scores = score_statuses(text, modules)
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    reasons = []

    if explicit_status_id is not None:
        status_id = explicit_status_id
        reasons.append(explicit_status_reason + "のため、その判定を優先しました。")
    elif ranked[0][1] > 0:
        status_id = ranked[0][0]
        reasons.append(
            f"相談文の目的語から「{STATUS[status_id]['name']}」の一致度が最も高いと判定しました。"
        )
    else:
        status_id = None
        reasons.append("目的を特定できる語が不足しているため、ステータス判定を保留しました。")

    ordered_status_ids = chapter_order(explicit_status_ids, text) if explicit_status_ids else []
    separate_decks = len(explicit_status_ids) > 1 and requested_as_separate_decks(text)
    if separate_decks:
        ordered_status_ids = list(explicit_status_ids)
    combined_deck = len(explicit_status_ids) > 1 and not separate_decks
    deck_count = len(explicit_status_ids) if separate_decks else 1
    # 初訪は単独の資料（約8枚のお土産）。他の型と1つの資料に混ぜず、残りを別の資料にする
    first_visit_alone = 1 in explicit_status_ids and len(explicit_status_ids) > 1 and not separate_decks
    if first_visit_alone:
        rest = [status_id for status_id in ordered_status_ids if status_id != 1]
        ordered_status_ids = [1] + rest
        combined_deck = len(rest) > 1
        deck_count = 2

    if len(explicit_status_ids) > 1:
        modules = unique_in_order(
            module
            for selected_id in ordered_status_ids
            for module in STATUS[selected_id]["modules"]
        )
        if first_visit_alone:
            reasons.append("初訪は単独の資料で出します。残りの型は別の資料にします。")
        else:
            reasons.append(
                "複数ステータスの標準章を重複なく統合しました。"
                if combined_deck else
                "複数ステータスを指定どおり個別資料として扱います。"
            )
    elif explicit_scope:
        reasons.append("営業が作成内容を明示しているため、指定された項目だけを保持しました。")
    elif status_id is not None:
        modules = list(STATUS[status_id]["modules"])

    second_candidate = None
    for candidate_id, score in ranked:
        if candidate_id != status_id and score > 0:
            second_candidate = {
                "status_id": candidate_id,
                "status_name": STATUS[candidate_id]["name"],
                "score": score,
            }
            break

    explicit_status = explicit_status_id is not None
    if explicit_status or has_explicit_modules:
        needs_clarification = False
    elif has_custom_output and status_id is not None:
        needs_clarification = False
    elif status_id is None:
        needs_clarification = True
    else:
        top_score = scores[status_id]
        second_score = second_candidate["score"] if second_candidate else 0
        needs_clarification = top_score <= 3 or top_score - second_score <= 1

    question = None
    if needs_clarification:
        if status_id is None:
            question = (
                "今回の主目的は、現状把握・具体提案・構成作成・効果検証・再提案のどれですか。"
                "作りたい項目が決まっている場合は、その項目をそのまま書いてください。"
            )
        elif second_candidate:
            question = (
                f"主目的は「{STATUS[status_id]['name']}」と"
                f"「{second_candidate['status_name']}」のどちらですか。"
                "作りたい項目が決まっている場合は、その項目を優先します。"
            )
        else:
            question = (
                f"主目的は「{STATUS[status_id]['name']}」で合っていますか。"
                "作りたい項目が決まっている場合は、その項目をそのまま書いてください。"
            )

    required = (
        required_inputs_for_statuses(ordered_status_ids)
        if len(explicit_status_ids) > 1
        else required_inputs(status_id, modules, explicit_scope)
    )
    available, received_values = parse_available_inputs(available_inputs)
    missing = missing_inputs(required, available)
    effective_status_ids = explicit_status_ids or ([status_id] if status_id is not None else [])
    baseline_required = 4 in effective_status_ids and "pre_post_search_exposure" in modules
    baseline_missing = baseline_required and "pre_campaign_search_data" not in available
    before_launch = baseline_missing and campaign_not_started(text)
    if before_launch:
        capture_required = (
            "target_brand", "official_tiktok_account", "general_search_keywords",
            "campaign_start_date", "pre_campaign_search_data",
        )
        missing = missing_inputs(capture_required, available)
    if 4 in effective_status_ids:
        if baseline_required:
            reasons.append(
                "検索露出の効果比較には、施策前・施策後を同条件で取得したデータが必要です。"
            )
        if "own_post_performance" in modules:
            reasons.append("自社投稿結果は、投稿実績または投稿管理シートで確認します。")
        if before_launch:
            reasons.append("施策開始前のため、開始前データを今取得する必要があります。")

    if explicit_status:
        confidence = 1.0
    elif status_id is None:
        confidence = 0.0
    elif explicit_scope:
        confidence = 0.92 if ranked[0][1] > ranked[1][1] else 0.78
    else:
        margin = scores[status_id] - (second_candidate["score"] if second_candidate else 0)
        confidence = round(min(0.94, 0.52 + min(scores[status_id], 12) * 0.025
                               + min(max(margin, 0), 6) * 0.045), 2)

    requested_deliverables = []
    if len(explicit_status_ids) > 1:
        requested_deliverables = [
            f"{selected_id}｜{STATUS[selected_id]['name']}" for selected_id in ordered_status_ids
        ]
    elif explicit_scope:
        requested_deliverables = [original_request]
    elif modules:
        requested_deliverables = [MODULE_LABEL[module] for module in modules]
    elif status_id is not None:
        requested_deliverables = [f"{status_id}｜{STATUS[status_id]['name']}資料"]

    return {
        "explicit_request": bool(explicit_status or explicit_scope),
        "requested_output_text": original_request,
        "requested_deliverables": requested_deliverables,
        "requested_modules": modules,
        "output_formats": output_formats,
        "constraints": constraints,
        "status_id": status_id,
        "status_name": STATUS[status_id]["name"] if status_id else None,
        "status_ids": effective_status_ids,
        "status_names": [STATUS[selected_id]["name"] for selected_id in effective_status_ids],
        "combined_deck": combined_deck,
        "deck_count": deck_count,
        "chapter_order": ordered_status_ids or effective_status_ids,
        "independent_deck": effective_status_ids == [5],
        "confidence": confidence,
        "reasons": reasons,
        "second_candidate": second_candidate,
        "received_inputs": sorted(available),
        "received_input_values": received_values,
        "missing_inputs": missing,
        "baseline_required": baseline_required,
        "baseline_capture_required_before_launch": before_launch,
        "can_generate": not needs_clarification and not missing and not before_launch,
        "needs_clarification": needs_clarification,
        "clarification_question": question,
        "reply_template": make_reply(
            status_id, effective_status_ids, ordered_status_ids or effective_status_ids,
            combined_deck, deck_count, modules, missing, available, received_values,
            needs_clarification, question,
            explicit_scope, reasons, original_request, output_formats,
            baseline_missing, before_launch, first_visit_alone,
        ),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Route a sales request to a TikTok analysis deliverable."
    )
    parser.add_argument("--request", help="Request text; stdin is used when omitted.")
    parser.add_argument(
        "--available-inputs", default="",
        help=(
            "Comma-separated canonical input keys already supplied. "
            "Use key=value to preserve a confirmed value in the reply."
        ),
    )
    args = parser.parse_args(argv)
    # 標準入出力を UTF-8 に固定する。日本語 Windows のパイプでは cp932 になり、依頼文の絵文字を
    # 書き出す時点で UnicodeEncodeError になっていた（intake_form.py から呼ぶと黙って簡易判定に落ちた）
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    request = args.request if args.request is not None else sys.stdin.read()
    available = [item.strip() for item in args.available_inputs.split(",") if item.strip()]
    try:
        result = route_request(request, available)
    except ValueError as exc:
        parser.error(str(exc))
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
