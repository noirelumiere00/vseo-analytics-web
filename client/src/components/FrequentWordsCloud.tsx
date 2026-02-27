import React, { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

// ──────────────────────────────────────────────
// 型定義
// ──────────────────────────────────────────────

export interface EmotionWord {
  word: string;
  count: number;
  valence: number;  // Y軸: -1(悲/怒) → +1(喜/楽)
  arousal: number;  // X軸: -1(穏/受動) → +1(興奮/能動)
  sources?: Array<"keyword" | "ocr" | "transcription" | "modal">;
}

interface WordData {
  word: string;
  count: number;
}

interface FrequentWordsCloudProps {
  // 新形式: 感情座標付きワード
  emotionWords?: EmotionWord[];
  // 旧形式: 後方互換フォールバック
  positiveWords?: WordData[];
  negativeWords?: WordData[];
}

// ──────────────────────────────────────────────
// 2D 感情マップ（新形式）
// ──────────────────────────────────────────────

const QUADRANT_COLORS = {
  joyExcited:  "#dcfce7", // 右上: 喜・興奮 (green)
  calmPleasure:"#dbeafe", // 左上: 楽・穏   (blue)
  angryActive: "#fef3c7", // 右下: 怒・活性 (amber)
  sadPassive:  "#ffe4e6", // 左下: 哀・沈静 (rose)
};

const BUBBLE_COLORS: Record<string, string> = {
  joyExcited:  "#16a34a",
  calmPleasure:"#2563eb",
  angryActive: "#d97706",
  sadPassive:  "#e11d48",
};

function getQuadrant(valence: number, arousal: number) {
  if (valence >= 0 && arousal >= 0) return "joyExcited";
  if (valence >= 0 && arousal < 0)  return "calmPleasure";
  if (valence < 0  && arousal >= 0) return "angryActive";
  return "sadPassive";
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: EmotionWord & { _maxCount: number };
}

const CustomDot = ({ cx = 0, cy = 0, payload }: CustomDotProps) => {
  if (!payload) return null;
  const maxCount = payload._maxCount || 1;
  const ratio = payload.count / maxCount;
  const radius = Math.round(14 + ratio * 26); // 14px〜40px
  const quadrant = getQuadrant(payload.valence, payload.arousal);
  const fill = BUBBLE_COLORS[quadrant];
  const fontSize = radius > 22 ? 10 : 8;
  const displayWord = payload.word.length > 5
    ? payload.word.slice(0, 5) + "…"
    : payload.word;

  return (
    <g>
      <circle cx={cx} cy={cy} r={radius} fill={fill} opacity={0.75} />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={fontSize}
        fill="#fff"
        fontWeight="600"
        style={{ pointerEvents: "none" }}
      >
        {displayWord}
      </text>
    </g>
  );
};

interface TooltipPayloadItem {
  payload: EmotionWord & { _maxCount: number };
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const quadrant = getQuadrant(d.valence, d.arousal);
  const labels: Record<string, string> = {
    joyExcited:  "喜・興奮",
    calmPleasure:"楽・穏",
    angryActive: "怒・活性",
    sadPassive:  "哀・沈静",
  };
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-md text-sm">
      <div className="font-bold text-gray-800">{d.word}</div>
      <div className="text-gray-500 mt-0.5">出現数: {d.count}件</div>
      <div className="text-gray-500">感情価: {d.valence.toFixed(2)}</div>
      <div className="text-gray-500">感情強度: {d.arousal.toFixed(2)}</div>
      <div className="mt-1 text-xs font-semibold" style={{ color: BUBBLE_COLORS[quadrant] }}>
        {labels[quadrant]}
      </div>
      {d.sources && d.sources.length > 0 && (
        <div className="text-xs text-gray-400 mt-0.5">
          出典: {d.sources.join(", ")}
        </div>
      )}
    </div>
  );
};

function EmotionWordMap({ words }: { words: EmotionWord[] }) {
  const maxCount = useMemo(() => Math.max(...words.map(w => w.count), 1), [words]);

  const chartData = useMemo(
    () => words.map(w => ({ ...w, _maxCount: maxCount })),
    [words, maxCount]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-base font-semibold text-gray-700">感情ワードマップ</h3>
        <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
          {[
            { key: "joyExcited",   label: "喜・興奮" },
            { key: "calmPleasure", label: "楽・穏" },
            { key: "angryActive",  label: "怒・活性" },
            { key: "sadPassive",   label: "哀・沈静" },
          ].map(({ key, label }) => (
            <span key={key} className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: BUBBLE_COLORS[key] }}
              />
              {label}
            </span>
          ))}
          <span className="text-gray-400">バブルサイズ = 出現頻度</span>
        </div>
      </div>

      {/* 軸ラベル */}
      <div className="relative">
        <div className="text-xs text-gray-400 text-center mb-1">
          ↑ 喜び・楽しさ (感情価 +)
        </div>
        <div className="flex items-center gap-1">
          <div className="text-xs text-gray-400 writing-vertical-rl" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>
            穏やか ← 感情強度 → 興奮
          </div>
          <div className="flex-1" style={{ minHeight: 380 }}>
            <ResponsiveContainer width="100%" height={380}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                {/* 象限の背景色 */}
                <ReferenceArea x1={0}  x2={1}  y1={0}  y2={1}  fill={QUADRANT_COLORS.joyExcited}   opacity={1} />
                <ReferenceArea x1={-1} x2={0}  y1={0}  y2={1}  fill={QUADRANT_COLORS.calmPleasure} opacity={1} />
                <ReferenceArea x1={0}  x2={1}  y1={-1} y2={0}  fill={QUADRANT_COLORS.angryActive}  opacity={1} />
                <ReferenceArea x1={-1} x2={0}  y1={-1} y2={0}  fill={QUADRANT_COLORS.sadPassive}   opacity={1} />

                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <ReferenceLine x={0} stroke="#9ca3af" strokeWidth={1.5} />
                <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1.5} />

                <XAxis
                  type="number"
                  dataKey="arousal"
                  domain={[-1, 1]}
                  tickCount={5}
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  tickFormatter={(v) => v.toFixed(1)}
                  label={{ value: "感情強度（arousal）", position: "insideBottom", offset: -10, fontSize: 10, fill: "#9ca3af" }}
                />
                <YAxis
                  type="number"
                  dataKey="valence"
                  domain={[-1, 1]}
                  tickCount={5}
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  tickFormatter={(v) => v.toFixed(1)}
                  label={{ value: "感情価（valence）", angle: -90, position: "insideLeft", offset: 10, fontSize: 10, fill: "#9ca3af" }}
                />

                <Tooltip content={<CustomTooltip />} />

                <Scatter
                  data={chartData}
                  shape={(props: CustomDotProps) => <CustomDot {...props} />}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="text-xs text-gray-400 text-center mt-1">
          ↓ 悲しみ・怒り (感情価 −)
        </div>
      </div>

      <p className="text-xs text-gray-400">
        ※ LLM（Gemini）がTikTok日本語コンテキストに基づきスコアを付与。バブルが大きいほど出現頻度が高い。
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────
// 旧形式フォールバック（後方互換）
// ──────────────────────────────────────────────

function LegacyWordCloud({
  positiveWords,
  negativeWords,
}: {
  positiveWords: WordData[];
  negativeWords: WordData[];
}) {
  const positiveCounts = positiveWords.map((w) => w.count);
  const negativeCounts = negativeWords.map((w) => w.count);

  return (
    <div className="space-y-8">
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
                const sizeInPx = 14 + ratio * 24;
                const opacity = 0.6 + ratio * 0.4;
                return (
                  <div
                    key={idx}
                    className="text-green-700 font-semibold whitespace-nowrap hover:scale-110 transition-transform cursor-pointer"
                    style={{ fontSize: `${sizeInPx}px`, opacity }}
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
                const sizeInPx = 14 + ratio * 24;
                const opacity = 0.6 + ratio * 0.4;
                return (
                  <div
                    key={idx}
                    className="text-red-700 font-semibold whitespace-nowrap hover:scale-110 transition-transform cursor-pointer"
                    style={{ fontSize: `${sizeInPx}px`, opacity }}
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

// ──────────────────────────────────────────────
// メインエクスポート
// ──────────────────────────────────────────────

export function FrequentWordsCloud({
  emotionWords,
  positiveWords = [],
  negativeWords = [],
}: FrequentWordsCloudProps) {
  if (emotionWords && emotionWords.length > 0) {
    return <EmotionWordMap words={emotionWords} />;
  }
  return <LegacyWordCloud positiveWords={positiveWords} negativeWords={negativeWords} />;
}
