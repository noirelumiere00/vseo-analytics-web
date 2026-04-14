/**
 * painAnalyzer/prompts.ts — LLM prompts for each step
 */

// ================================================================
// STEP 2: Feature Extraction
// ================================================================

export const FEATURE_EXTRACTION_SYSTEM_PROMPT = `あなたは商品分析の専門家です。提供されたデータから商品の主要な特徴、ターゲット層、競合商品を抽出します。
データが不完全でも、利用可能な情報から最善の分析を行ってください。`;

export function buildFeatureExtractionPrompt(
  productName: string,
  s1Text: string,
  s3Text: string,
): string {
  return `以下の商品について、主要な特徴を抽出してください。

## 商品名
${productName}

## 公式情報・プレスリリース
${s1Text || "（データなし）"}

## Web上の評判・レビュー
${s3Text || "（データなし）"}

## 指示
1. 商品の主要な特徴・機能を5〜10個リストアップしてください
2. 主なターゲット層を特定してください
3. 主な競合商品を特定してください
4. 商品カテゴリを特定してください

特徴は「ユーザーにとっての価値」の観点で記述してください。
例：「軽量設計」→「片手で持てる軽さ」、「防水機能」→「雨の日も気にせず使える」`;
}

// ================================================================
// STEP 3: Pain Hypothesis Generation
// ================================================================

export const PAIN_HYPOTHESIS_SYSTEM_PROMPT = `あなたはユーザーリサーチの専門家です。商品の特徴から「その特徴がないと困るシーン」を逆算し、具体的なペイン（悩み・不便・課題）を仮説として生成します。

【重要なルール】
- ペインは「商品の機能説明」ではなく「ユーザーが実際に困っている具体的なシーン」で記述してください
- 抽象的な表現は避け、「いつ・どこで・誰が・何に困っているか」を含めてください
- 各ペインには、X（Twitter）やTikTokで実際に検索可能な検索クエリを添えてください
- 同じ特徴から複数の異なるペインが生まれることがあります`;

export function buildPainHypothesisPrompt(
  productName: string,
  features: { features: string[]; targetAudience: string; competitors: string[]; productCategory: string },
  s1Text: string,
  s3Text: string,
): string {
  return `以下の商品について、ユーザーが抱えるペイン（悩み・不便・課題）の仮説を生成してください。

## 商品名
${productName}

## 商品カテゴリ
${features.productCategory}

## 商品の特徴
${features.features.map((f, i) => `${i + 1}. ${f}`).join("\n")}

## ターゲット層
${features.targetAudience}

## 競合商品
${features.competitors.join(", ") || "（不明）"}

## 公式情報サマリー
${s1Text.slice(0, 1500) || "（データなし）"}

## Web評判サマリー
${s3Text.slice(0, 1500) || "（データなし）"}

## 指示
各特徴について「この特徴がないと、ユーザーはどんなシーンで困るか？」を逆算してください。

【ペイン仮説の例】（靴の場合）
- 「忙しい朝に両手が荷物で塞がっている時、靴を履くために一度荷物を置かなければならない」
- 「子供を抱っこしたまま玄関で靴を履けない」
- 「妊娠中で腰を曲げるのがつらく、靴を履くのが一苦労」
- 「宅配便の受け取り時にサッと外に出たいのに靴を履くのに時間がかかる」

8〜15個のペイン仮説を生成してください。
各ペインの confidence（確信度）は、データの裏付けがあるものほど高く設定してください。
searchQuery は日本語で、SNSで実際に使われそうな表現にしてください。`;
}

// ================================================================
// STEP 5: Segment Classification
// ================================================================

export const SEGMENT_CLASSIFICATION_SYSTEM_PROMPT = `あなたはソーシャルリスニングの専門家です。SNS上の投稿データとユーザー行動から、ターゲットセグメント（層）を分類します。

【マルチラベル分類】
1人のユーザーが複数のセグメントに属することがあります。
例：「ママ50% × フィットネス30% × エコ意識20%」

【界隈の発見】
- 投稿内容、フォロー先、いいね傾向から「界隈」を特定してください
- 界隈名は日本のSNS文化に即した名前にしてください（例：ポイ活界隈、筋トレ界隈、ワーママ界隈）`;

export function buildSegmentClassificationPrompt(
  productName: string,
  verifiedPains: Array<{ pain: string; topEvidence: string[] }>,
  xPostsSample: string,
  ttVideosSample: string,
): string {
  return `以下の商品に関する検証済みペインとSNSデータから、ターゲットセグメント（層）を分類してください。

## 商品名
${productName}

## 検証済みペイン
${verifiedPains.map((p, i) => `${i + 1}. ${p.pain}\n   根拠: ${p.topEvidence.slice(0, 3).join(" / ")}`).join("\n")}

## X（Twitter）投稿サンプル
${xPostsSample || "（データなし）"}

## TikTok動画サンプル
${ttVideosSample || "（データなし）"}

## 指示
1. まず「界隈」（コミュニティ）を発見してください（3〜6個）
2. 次に界隈を束ねてセグメント（層）を定義してください（3〜6個）
3. 各セグメントには、商品とのマッチ度（matchScore）を設定してください
4. 各セグメントの主要ペインと訴求ポイントを明記してください

セグメント名は「〇〇層」の形式にしてください。
iconは絵文字1文字にしてください。`;
}

// ================================================================
// STEP 6: Purchase Attitude Estimation
// ================================================================

export const PURCHASE_ATTITUDE_SYSTEM_PROMPT = `あなたは消費者行動分析の専門家です。SNS上の投稿データから各セグメントの購買態度を推定します。

【分析の観点】
- 価格感度：高級品を好むか、コスパを重視するか
- 購買決定要因：機能、デザイン、口コミ、ブランドのどれを重視するか
- 購買障壁：何が購入をためらわせるか
- 購買チャネル：オンライン vs 実店舗の好み`;

export function buildPurchaseAttitudePrompt(
  productName: string,
  segments: Array<{ id: string; name: string; primaryPain: string; appeals: string[] }>,
  xPostsSample: string,
): string {
  return `以下のセグメント別に購買態度を推定してください。

## 商品名
${productName}

## セグメント一覧
${segments.map(s => `- ${s.name}（ID: ${s.id}）\n  ペイン: ${s.primaryPain}\n  訴求: ${s.appeals.join(", ")}`).join("\n")}

## X投稿から推定された購買行動サンプル
${xPostsSample || "（データなし）"}

## 指示
各セグメントについて以下を推定してください：
1. 購買態度の要約（例：コスパ重視、機能重視）
2. 許容価格帯
3. 購買を後押しする要因（3〜5個）
4. 購買を妨げる要因（2〜3個）
5. 根拠となる投稿/行動の要約`;
}

// ================================================================
// STEP 7: Proposal Generation
// ================================================================

export const PROPOSAL_SYSTEM_PROMPT = `あなたはSNSマーケティング戦略家です。セグメント別の分析結果から、具体的な訴求コピーとアクションプランを生成します。

【コピーのルール】
- 各プラットフォーム（X, TikTok, Instagram）に最適化してください
- Xは140文字以内のテキスト中心
- TikTokはフック（最初の3秒）を意識したキャプション
- Instagramはビジュアル訴求を意識したキャプション
- ハッシュタグはプラットフォームごとの文化に合わせてください

【優先アクション】
- 具体的で実行可能なアクションにしてください
- タイムライン（24H, 2-3日, 1週間）を明記してください`;

export function buildProposalPrompt(
  productName: string,
  segments: Array<{ id: string; name: string; primaryPain: string; appeals: string[] }>,
  purchaseAttitudes: Array<{ segmentId: string; attitude: string; priceRange: string }>,
  features: { features: string[]; productCategory: string },
): string {
  return `以下のセグメント分析結果から、具体的な訴求案を生成してください。

## 商品名
${productName}

## 商品カテゴリ
${features.productCategory}

## 商品の主要特徴
${features.features.slice(0, 5).join(", ")}

## セグメント × 購買態度
${segments.map(s => {
  const att = purchaseAttitudes.find(a => a.segmentId === s.id);
  return `### ${s.name}（ID: ${s.id}）
  ペイン: ${s.primaryPain}
  訴求: ${s.appeals.join(", ")}
  購買態度: ${att?.attitude || "不明"}
  価格帯: ${att?.priceRange || "不明"}`;
}).join("\n\n")}

## 指示
各セグメントについて以下を生成してください：
1. **コピー案**: X, TikTok, Instagram それぞれ1つずつ（計3案/セグメント）
2. **ハッシュタグセット**: 推奨ハッシュタグ5〜8個
3. **優先アクション**: 3つのアクションプラン（timeline付き）

コピーはペインに刺さる表現を使い、商品の特徴を解決策として提示してください。`;
}

// ================================================================
// Verification Score (STEP 4 helper)
// ================================================================

export const VERIFICATION_SCORE_SYSTEM_PROMPT = `あなたはソーシャルリスニングの専門家です。SNS投稿がペイン仮説をどの程度裏付けているかを評価します。`;

export function buildVerificationScorePrompt(
  pain: string,
  posts: string,
): string {
  return `以下のペイン仮説について、提供されたSNS投稿がどの程度裏付けているか評価してください。

## ペイン仮説
${pain}

## 関連するSNS投稿
${posts}

## 指示
以下のJSON形式で回答してください:
{
  "verificationScore": 0.0〜1.0の数値（裏付けの強さ）,
  "topEvidence": ["最も関連性の高い投稿の要約を3つまで"],
  "reasoning": "判断の根拠（1〜2文）"
}

verificationScore の基準:
- 0.8〜1.0: 明確にペインを裏付ける投稿が複数ある
- 0.5〜0.7: 間接的に裏付ける投稿がある
- 0.3〜0.4: 関連はあるが弱い
- 0.0〜0.2: ほぼ裏付けなし`;
}

// ================================================================
// Final Summary (STEP 7 helper)
// ================================================================

export const FINAL_SUMMARY_SYSTEM_PROMPT = `あなたはマーケティング分析の専門家です。ペイン分析の結果全体を俯瞰し、エグゼクティブサマリーを生成します。`;

export function buildFinalSummaryPrompt(
  productName: string,
  segmentNames: string[],
  totalPains: number,
  topSegment: string,
): string {
  return `以下のペイン分析結果のエグゼクティブサマリーを生成してください。

## 商品名
${productName}

## 発見されたセグメント
${segmentNames.join(", ")}

## 検証済みペイン数
${totalPains}

## 最もマッチ度の高いセグメント
${topSegment}

## 指示
1. 全体を俯瞰したエグゼクティブサマリー（3〜5文）
2. 戦略提言（3〜5個）
3. 各セグメントの推定比率（%）

マーケティング意思決定者向けの簡潔な言葉で書いてください。`;
}
