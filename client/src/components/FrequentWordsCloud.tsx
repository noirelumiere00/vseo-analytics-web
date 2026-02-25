import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

interface WordData {
  word: string;
  count: number;
}

interface FrequentWordsCloudProps {
  positiveWords: WordData[];
  negativeWords: WordData[];
}

/**
 * 頻出ワード分析コンポーネント
 * ワードクラウド風で、頻出量により文字サイズを動的に変更
 */
export function FrequentWordsCloud({
  positiveWords,
  negativeWords,
}: FrequentWordsCloudProps) {
  // 最大・最小のカウント値から相対的なフォントサイズを計算
  const calculateFontSize = (count: number, allCounts: number[]): string => {
    if (allCounts.length === 0) return "text-base";
    const max = Math.max(...allCounts);
    const min = Math.min(...allCounts);
    const range = max - min || 1;
    const ratio = (count - min) / range;
    
    // フォントサイズを 12px から 32px の範囲で計算
    const sizeInPx = 12 + ratio * 20;
    return `text-[${sizeInPx}px]`;
  };

  const positiveCounts = positiveWords.map((w) => w.count);
  const negativeCounts = negativeWords.map((w) => w.count);

  return (
    <div className="space-y-8">
      {/* ポジティブワード */}
      <div>
        <div className="flex items-center gap-2 mb-6">
          <div className="bg-green-100 rounded-full p-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-green-700">ポジティブワード</h3>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-8 border border-green-200">
          <div className="flex flex-wrap gap-4 justify-center items-center">
            {positiveWords.length > 0 ? (
              positiveWords.map((item, idx) => {
                const max = Math.max(...positiveCounts);
                const min = Math.min(...positiveCounts);
                const range = max - min || 1;
                const ratio = (item.count - min) / range;
                const sizeInPx = 14 + ratio * 24; // 14px ~ 38px
                const opacity = 0.6 + ratio * 0.4; // 0.6 ~ 1.0

                return (
                  <div
                    key={idx}
                    className="text-green-700 font-semibold whitespace-nowrap hover:scale-110 transition-transform cursor-pointer"
                    style={{
                      fontSize: `${sizeInPx}px`,
                      opacity,
                    }}
                    title={`${item.word}: ${item.count}件`}
                  >
                    {item.word}
                  </div>
                );
              })
            ) : (
              <span className="text-gray-400">データなし</span>
            )}
          </div>
        </div>
      </div>

      {/* ネガティブワード */}
      <div>
        <div className="flex items-center gap-2 mb-6">
          <div className="bg-red-100 rounded-full p-2">
            <TrendingDown className="h-5 w-5 text-red-600" />
          </div>
          <h3 className="text-xl font-bold text-red-700">ネガティブワード</h3>
        </div>
        <div className="bg-gradient-to-br from-red-50 to-rose-50 rounded-xl p-8 border border-red-200">
          <div className="flex flex-wrap gap-4 justify-center items-center">
            {negativeWords.length > 0 ? (
              negativeWords.map((item, idx) => {
                const max = Math.max(...negativeCounts);
                const min = Math.min(...negativeCounts);
                const range = max - min || 1;
                const ratio = (item.count - min) / range;
                const sizeInPx = 14 + ratio * 24; // 14px ~ 38px
                const opacity = 0.6 + ratio * 0.4; // 0.6 ~ 1.0

                return (
                  <div
                    key={idx}
                    className="text-red-700 font-semibold whitespace-nowrap hover:scale-110 transition-transform cursor-pointer"
                    style={{
                      fontSize: `${sizeInPx}px`,
                      opacity,
                    }}
                    title={`${item.word}: ${item.count}件`}
                  >
                    {item.word}
                  </div>
                );
              })
            ) : (
              <span className="text-gray-400">データなし</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
