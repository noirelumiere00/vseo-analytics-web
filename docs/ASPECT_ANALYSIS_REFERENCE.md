# 側面分析（Aspect Analysis）の処理フロー - 参考資料

## 処理フロー概要

```
入力: SNS投稿テキスト + 複数コメント
  ↓
全テキストを結合
  ↓
LLM プロンプト生成
  ↓
GPT-4o LLM 呼び出し
  ↓
JSON Schema 検証
  ↓
レスポンス解析
  ↓
側面分析データ抽出
  ↓
出力: 詳細分析結果
```

## JSON Schema 構造

```json
{
  "positive_words": [
    {"word": string, "count": number}
  ],
  "negative_words": [
    {"word": string, "count": number}
  ],
  "top_emotions": [string],
  "aspect_analysis": [
    {
      "aspect": string,
      "positive_percentage": number,
      "negative_percentage": number
    }
  ],
  "summary": string
}
```

## 側面分析の出力例

```json
{
  "aspect_analysis": [
    {
      "aspect": "料理の味",
      "positive_percentage": 90,
      "negative_percentage": 10
    },
    {
      "aspect": "サービス",
      "positive_percentage": 70,
      "negative_percentage": 30
    },
    {
      "aspect": "価格",
      "positive_percentage": 40,
      "negative_percentage": 60
    },
    {
      "aspect": "雰囲気",
      "positive_percentage": 85,
      "negative_percentage": 15
    }
  ]
}
```

## 実装時の重要ポイント

1. **側面の自動抽出**: LLM が投稿内容から関連する側面を自動抽出
2. **ポジティブ・ネガティブ率**: 複数投稿での言及頻度に基づいて計算
3. **側面数の制限**: 4-6個の主要側面に限定
4. **JSON Schema 検証**: 返された結果を厳密に検証
5. **エラーハンドリング**: LLM 呼び出し失敗時の適切な処理

## 現在の実装との差分

| 項目 | 参考資料 | 現在の実装 | 改善点 |
|------|--------|----------|------|
| ワード構造 | `{word, count}` | 文字列配列 | ワード頻度を含める |
| 側面数 | 4-6個 | 可変 | 制限を厳格化 |
| 出力形式 | `positive_percentage` | `positiveRate` | 命名を統一 |
| 感情ワード | 最大10個 | 可変 | 制限を追加 |
