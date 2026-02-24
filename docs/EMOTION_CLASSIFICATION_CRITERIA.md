# 感情ワード分類基準（VSEO Analytics）

## 目的
TikTok動画の説明文から抽出したワードを、ポジティブ・ネガティブ・ニュートラルに正確に分類する。

## 分類ルール

### ✅ ポジティブワード（Positive）
感情的に肯定的な表現、満足度を示す言葉
- 例：「楽しい」「最高」「素晴らしい」「良い」「快適」「安い」「美しい」「感動」「おすすめ」

### ❌ ネガティブワード（Negative）
感情的に否定的な表現、不満足度を示す言葉
- 例：「つまらない」「最悪」「ゴミ」「高い」「混雑」「不快」「退屈」「失望」「ひどい」

### ⚪ ニュートラルワード（Neutral）
感情を持たない、中立的な言葉
- **固有名詞**：「テーマパーク」「沖縄」「ジャングリア」「東京」「施設名」
- **日付・数値**：「2024年」「5月」「3日」「100円」「10時間」「1000人」
- **一般的な名詞**：「動画」「投稿」「チケット」「駐車場」「食事」「スタッフ」
- **中立的な動詞**：「行った」「見た」「訪問」「体験」「利用」
- **その他**：「です」「ます」「ある」「いる」などの助動詞

## 判定基準

### 曖昧な場合の判定ルール
1. **文脈を考慮**：単語だけでなく、使用されている文脈を確認
2. **感情の有無**：感情を含まない場合は Neutral
3. **固有名詞の優先**：固有名詞は常に Neutral（例：「沖縄」は地名なので Neutral）
4. **修飾語の確認**：「高い」は「価格が高い」（ネガティブ）か「評価が高い」（ポジティブ）かで判定

## 例

| ワード | 分類 | 理由 |
|--------|------|------|
| テーマパーク | Neutral | 固有名詞・施設名 |
| 沖縄 | Neutral | 地名・固有名詞 |
| 楽しい | Positive | 感情ワード |
| 最悪 | Negative | 感情ワード |
| 2024年 | Neutral | 日付 |
| 100円 | Neutral | 数値 |
| 混雑 | Negative | 不満足を示す |
| 快適 | Positive | 満足を示す |
| 訪問 | Neutral | 中立的な動詞 |
| 素晴らしい | Positive | 肯定的な形容詞 |

## LLM プロンプトでの実装

### ネガティブワード抽出プロンプト
```
Below are TikTok video descriptions. Please extract ONLY negative emotion words and phrases that express dissatisfaction, criticism, or negative feelings.

IMPORTANT CLASSIFICATION RULES:
- Extract ONLY words that express negative emotions or dissatisfaction
- DO NOT include: proper nouns (place names, facility names), dates, numbers, neutral nouns, or neutral verbs
- Examples of NEGATIVE words: "ゴミ", "最悪", "つまらない", "不快", "混雑", "退屈", "失望", "ひどい"
- Examples of words to EXCLUDE: "テーマパーク", "沖縄", "2024年", "100円", "訪問", "体験"
```

### ポジティブワード抽出プロンプト
```
Below are TikTok video descriptions. Please extract ONLY positive emotion words and phrases that express satisfaction, praise, or positive feelings.

IMPORTANT CLASSIFICATION RULES:
- Extract ONLY words that express positive emotions or satisfaction
- DO NOT include: proper nouns (place names, facility names), dates, numbers, neutral nouns, or neutral verbs
- Examples of POSITIVE words: "楽しい", "最高", "素晴らしい", "安い", "快適", "美しい", "感動", "おすすめ"
- Examples of words to EXCLUDE: "テーマパーク", "沖縄", "2024年", "100円", "訪問", "体験"
```

## 実装ファイル
- `server/videoAnalysis.ts` - 感情ワード抽出ロジック（行 487-567）

## 更新履歴
- 2026-02-24: 初版作成、固有名詞・日付・数値を Neutral に分類する基準を確立
