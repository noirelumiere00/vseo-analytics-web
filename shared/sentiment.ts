// Shared sentiment analysis logic for caption text
// Used by both server (campaignReport) and client (CampaignReportOriginal)

export const POS_WORDS = /最高|美味し|おいし|すごい|すごく|良い|いい感じ|おすすめ|オススメ|楽し|好き|可愛|かわいい|カワイイ|嬉し|素敵|綺麗|きれい|最強|神$|神す|ヤバい|やばい|やばす|感動|面白|おもしろ|幸せ|大好き|ハマ|リピ|推し|優勝|天才|完璧|完成度|満足|虜|沼|飯テロ|至福|贅沢|絶品|旨|うま|ウマ|映え|バズ|お気に入り|抜群|極上|最上|一番|ベスト|感謝|ありがと|👍|🔥|❤|💕|😍|🥰|✨|💯|👏|😋|🤤/i;
export const NEG_WORDS = /最悪|まずい|マズい|ダメ|だめ|微妙|残念|嫌い|きらい|ひどい|酷い|悪い|がっかり|ガッカリ|不味|後悔|失敗|期待はずれ|いまいち|イマイチ|つまらな|詐欺|ぼったくり|高すぎ|不満|苦手|やめた|無理|クソ|ゴミ|💩|😤|😡|👎/i;

export type Sentiment = "positive" | "neutral" | "negative";

export function analyzeSentiment(text: string | undefined): Sentiment {
  if (!text) return "neutral";
  const hasPos = POS_WORDS.test(text);
  const hasNeg = NEG_WORDS.test(text);
  if (hasPos && !hasNeg) return "positive";
  if (hasNeg && !hasPos) return "negative";
  if (hasPos && hasNeg) return "neutral"; // mixed → neutral
  return "neutral";
}
