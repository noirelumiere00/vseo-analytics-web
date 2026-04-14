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

export const SEGMENT_CLASSIFICATION_SYSTEM_PROMPT = `あなたは「界隈マーケティング」の第一人者です。SNS上の投稿データとユーザー行動から、メーカー想定外の「界隈（熱量の高いユーザー集団）」を発見し、ターゲットセグメントを分類します。

【「界隈」の定義（博報堂・SHIBUYA109 lab. 準拠）】
界隈とは、属性ではなく「好き」や興味関心を軸にSNS上で形成される、境界のゆるい集まりです。
- 明確な境界線がなく、界隈同士は重なり合う
- 一人が複数の界隈に所属し、回遊する
- リーダー中心ではなく、相互作用で成り立つ
- 理解やリスペクトがない外部者に敏感

【界隈の7分類（モチベーション別）】
発見する界隈は以下のどれに該当するか必ず判定してください：
1. 情報交換系 — 最新・リアルな情報を共有（専門性・信ぴょう性が重要）
2. 趣味系 — 同じ趣味を一緒に楽しみたい（参加導線・楽しみ方の提案が重要）
3. 推し活・オタ活系 — 推し活をともに盛り上がりたい（マナー理解・敬意が必須）
4. 世界観系 — 視覚的な世界観を共有（ビジュアル・トーンの整合性が重要）
5. 連帯系 — 同じ状況や悩みを共有（誠実さ・寄り添い・課題解決が求められる）
6. 「あるある」系 — 日常のあるあるで盛り上がる（短期バズ向き）
7. ネタ系 — 瞬間的な面白さで盛り上がる（話題化向きだが継続施策には不向き）

【大中小の粒度構造】
大きな界隈の内部に中分類・小分類が入れ子状に存在します。
「K-POP界隈」のような大きすぎる括りではなく、小さな界隈まで解像度を上げてください。

【界隈化しやすい条件】
以下の条件が揃うカテゴリほど界隈消費が起こりやすい：
- トレンド変化が速い / 細分化されたニーズがある
- リアルな対象に対する推し活が成立する
- 写真や動画で共有しやすい / 試し買いしやすい単価感

【界隈消費の2類型】
- 界隈内消費: 界隈の内部で評判が回り、界隈内の多数に購入が広がる
- 界隈伝播消費: ある界隈で流行したものが、別の界隈にも波及する
  → Core Layer (A-C) で界隈内消費を起こし、Expansion Layer (D-E) で伝播消費を狙う

【界隈の発見ルール】
- 必ず**5つの界隈**を発見してください（Core Layer: A-C の3界隈 + Expansion Layer: D-E の2界隈）
- Core Layer = 商品との親和性が高く、熱量の高いコア層（界隈内消費の起点）
- Expansion Layer = コア層から波及して取り込める拡大層（界隈伝播消費のターゲット）
- メーカーの公式ターゲット以外の「意外な界隈」を必ず1つ以上含めてください
- 界隈名は日本のSNS文化に即した具体的な名前にしてください

【文化コード】
各界隈について以下を特定してください：
- **呼び名**: ユーザーが自称する呼称（〇〇勢、〇〇民、〇〇沼、〇〇部）
- **特有ハッシュタグ**: 界隈内で使われるハッシュタグ
- **投稿構図の型**: よくある投稿フォーマット（開封動画、ビフォーアフター、GRWM等）

【公式とのGAP分析】
メーカーの想定用途と、ユーザーの実際の使い方のズレを明確にしてください。
このズレこそが界隈消費の起点になります。
例：「栄養ドリンク」が「推し活の儀式」として消費されている

【推定人数】
各界隈の推定人数を、提供されたWeb情報やSNSデータから概算してください。
「人気がある」「多い」などの定性表現は禁止。必ず数字で示してください。`;

export function buildSegmentClassificationPrompt(
  productName: string,
  verifiedPains: Array<{ pain: string; topEvidence: string[] }>,
  xPostsSample: string,
  ttVideosSample: string,
  s1Summary?: string,
  s3Summary?: string,
): string {
  return `以下の商品に関する検証済みペインとSNSデータから、**必ず5つの界隈**を発見し、セグメント分類してください。

## 商品名
${productName}

## 公式情報（メーカー側の想定）
${s1Summary || "（データなし）"}

## Web上の評判（ユーザー側の実態）
${s3Summary || "（データなし）"}

## 検証済みペイン
${verifiedPains.map((p, i) => `${i + 1}. ${p.pain}\n   根拠: ${p.topEvidence.slice(0, 3).join(" / ")}`).join("\n")}

## X（Twitter）投稿サンプル
${xPostsSample || "（データなし）"}

## TikTok動画サンプル
${ttVideosSample || "（データなし）"}

## 指示
1. **5つの界隈を発見**してください:
   - Core Layer (A-C): 商品との親和性が高い3界隈（layer: "core"）
   - Expansion Layer (D-E): 波及で取り込める2界隈（layer: "expansion"）
2. 各界隈について以下を必ず出力:
   - cultureCode: 呼び名(nicknames)、特有ハッシュタグ(hashtags)、投稿構図の型(contentPatterns)
   - officialGap: メーカー想定(official) vs ユーザー実態(reality) vs インサイト(insight)
   - estimatedPopulation: 推定人数（概算）
   - populationFormula: 人数の計算根拠
   - keywords: 界隈に関連するキーワード5つ（後でTikTok/Instagram定量検証に使用）
3. 次に界隈を束ねてセグメント（層）を定義してください
4. 各セグメントのmatchScore、主要ペイン、訴求ポイントを明記

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
// STEP 7b: Kaiwai Creative Generation (per community, 6 proposals each)
// ================================================================

export const KAIWAI_CREATIVE_SYSTEM_PROMPT = `あなたは界隈マーケティングのクリエイティブディレクターです。
界隈ごとに選抜されたキーワードを使い、「右脳（感情・直感）」と「左脳（機能・論理）」の2軸でTikTok投稿案を生成します。

【界隈アプローチの4原則（博報堂・SHIBUYA109 lab. 準拠）】
1. **カテゴライズしない**: 「〇〇界隈向け」ではなく「〇〇好きの人へ」のトーンで。勝手にラベル化しない。
2. **リスペクトを忘れない**: 界隈の価値観や姿勢への敬意が伝わる表現にする。表面的コラボより理解の深さ。
3. **ポジティブ文脈で発信**: 優越感ではなく「一緒に楽しめる」表現。利他的共有が広がりを生む。
4. **活用シーンを提案**: 商品説明ではなく「界隈の活動の中でどう使うと嬉しいか」の解像度を上げる。

【SEESASモデル（界隈起点の消費行動）】
Sympathy(共感) → Enthusiasm(熱狂) → Expression(発信) → Spread(拡散) → Action(行動) → Sustainability(定着)
- 右脳案 = Sympathy/Enthusiasmに対応（「いいな」「やりたい」を引き出す）
- 左脳案 = Action/Sustainabilityに対応（「なるほど」「買う理由がある」を提供する）

【右脳的アプローチ（Emotional）】
- 話口調（〜だよね、〜じゃん、〜してみた）
- 直感的、「好き」「憧れ」「雰囲気」に訴求
- 界隈の「ゆるさ」と「心地よさ」を壊さないトーン
- ビジュアル: エモーショナル、warm lighting、生活感、界隈のリアルな日常

【左脳的アプローチ（Logical）】
- 説明口調（〜の理由、〜を比較、〜の事実）
- 論理的、「機能」「成分」「コスパ」「数字」に訴求
- 界隈内で共有される「実用情報」としての価値を持たせる
- ビジュアル: テキストオーバーレイ、比較表、データ可視化`;

export function buildKaiwaiCreativePrompt(
  productName: string,
  community: { id: string; name: string; keywords: string[]; primaryPain?: string },
  selectedKeywords: string[],
): string {
  return `以下の界隈×キーワードでTikTok投稿案を生成してください。

## 商品名
${productName}

## 界隈
${community.name}（ID: ${community.id}）
${community.primaryPain ? `主要ペイン: ${community.primaryPain}` : ""}

## 選抜キーワード（3つ）
${selectedKeywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

## 指示
各キーワードについて、右脳案と左脳案を1つずつ生成してください（計6案）。

各案に含めるもの：
- **headline**: フック（最初の3秒で目を引く一言）
- **body**: 投稿テキスト（右脳=話口調、左脳=説明口調）
- **visualConcept**: 映像コンセプトの説明（TikTokのUI画面として描写）

communityId は "${community.id}"、communityName は "${community.name}" を使用してください。`;
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
