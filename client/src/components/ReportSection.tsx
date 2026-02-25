import { useState, useEffect } from "react";

// Types
interface Aspect {
  name: string;
  pos: number;
  neg: number;
  desc: string;
}

interface Proposal {
  area: string;
  action: string;
  priority: "高" | "中" | "低";
  icon: string;
}

interface ReportSectionProps {
  keyword: string;
  date: string;
  videoCount: number;
  platform: string;
  aspects: Aspect[];
  proposals: Proposal[];
  sentimentData?: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

// Components
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      style={{
        transition: "transform 0.35s cubic-bezier(0.4,0,0.2,1)",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        flexShrink: 0,
      }}
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Accordion({
  title,
  number,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  number: string;
  badge?: { text: string; color: string; bg: string };
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || false);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        marginBottom: 16,
        border: "1px solid rgba(30,60,90,0.08)",
        boxShadow: open ? "0 8px 32px rgba(30,60,90,0.08)" : "0 2px 8px rgba(30,60,90,0.03)",
        transition: "box-shadow 0.35s ease",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "20px 24px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "'Noto Sans JP', sans-serif",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #1a3a5c, #2e75b6)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            flexShrink: 0,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {number}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 17,
            fontWeight: 700,
            color: "#1a2a3a",
            letterSpacing: "0.01em",
          }}
        >
          {title}
        </span>
        {badge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: badge.color,
              background: badge.bg,
              padding: "3px 10px",
              borderRadius: 20,
              letterSpacing: "0.02em",
            }}
          >
            {badge.text}
          </span>
        )}
        <ChevronIcon open={open} />
      </button>
      <div
        style={{
          maxHeight: open ? 2000 : 0,
          opacity: open ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease",
        }}
      >
        <div style={{ padding: "0 24px 24px 24px" }}>{children}</div>
      </div>
    </div>
  );
}

function AspectRow({ aspect, index }: { aspect: Aspect; index: number }) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 100 + index * 80);
    return () => clearTimeout(t);
  }, [index]);

  return (
    <div
      style={{
        padding: "16px 0",
        borderBottom: index < 5 ? "1px solid #f0f2f5" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600, color: "#1a2a3a", fontSize: 15 }}>
          {aspect.name}
        </span>
      </div>

      {/* Stacked bar with labels */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Positive label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minWidth: 62,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#0d9255",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: "#0d9255",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {aspect.pos}%
          </span>
        </div>

        {/* Stacked bar */}
        <div
          style={{
            flex: 1,
            height: 12,
            borderRadius: 6,
            overflow: "hidden",
            display: "flex",
            background: "#e8ecf0",
          }}
        >
          <div
            style={{
              height: "100%",
              width: animated ? `${aspect.pos}%` : "0%",
              background: "linear-gradient(90deg, #0d9255, #34c77b)",
              borderRadius: "6px 0 0 6px",
              transition: `width 1s cubic-bezier(0.4,0,0.2,1) ${index * 80}ms`,
            }}
          />
          <div
            style={{
              height: "100%",
              width: animated ? `${aspect.neg}%` : "0%",
              background: "linear-gradient(90deg, #e8737a, #c0392b)",
              borderRadius: "0 6px 6px 0",
              transition: `width 1s cubic-bezier(0.4,0,0.2,1) ${index * 80 + 200}ms`,
            }}
          />
        </div>

        {/* Negative label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            minWidth: 62,
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: "#c0392b",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {aspect.neg}%
          </span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#c0392b",
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      {/* Legend description */}
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13,
          color: "#6b7a8d",
          lineHeight: 1.6,
        }}
      >
        {aspect.desc}
      </p>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: "高" | "中" | "低" }) {
  const map = {
    高: { bg: "#fef2f2", color: "#c0392b", border: "#fecaca" },
    中: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
    低: { bg: "#f0f9ff", color: "#2563eb", border: "#bfdbfe" },
  };
  const s = map[priority];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 6,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {priority}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      style={{
        flex: "1 1 140px",
        padding: "20px 16px",
        borderRadius: 14,
        background: `linear-gradient(135deg, ${color}08, ${color}14)`,
        border: `1px solid ${color}20`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 32,
          fontWeight: 800,
          color,
          fontFamily: "'DM Sans', sans-serif",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2a3a", marginTop: 6 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "#8896a6", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// Main Component
export function ReportSection({
  keyword,
  date,
  videoCount,
  platform,
  aspects,
  proposals,
  sentimentData,
}: ReportSectionProps) {
  const avgPositive = Math.round(
    aspects.reduce((sum, a) => sum + a.pos, 0) / aspects.length
  );

  return (
    <div
      style={{
        fontFamily: "'Noto Sans JP', sans-serif",
      }}
    >
      {/* Content */}
      <div style={{ padding: "0 24px" }}>

        {/* Keyword Display Section */}
        <Accordion
          number="1"
          title="側面分析・強み弱みサマリー"
          badge={{ text: `${aspects.length} ASPECTS`, color: "#2e75b6", bg: "#e8f0fa" }}
          defaultOpen={true}
        >
          <p
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              color: "#6b7a8d",
              lineHeight: 1.7,
            }}
          >
            {platform}上の #{keyword} 関連動画{videoCount}本を分析し、主要な評価側面ごとのポジティブ/ネガティブ比率を算出しました。
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 4,
              padding: "8px 12px",
              borderRadius: 8,
              background: "#f8f9fb",
              fontSize: 12,
              color: "#6b7a8d",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: "linear-gradient(90deg, #0d9255, #34c77b)",
                }}
              />
              <span style={{ fontWeight: 600 }}>ポジティブ</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: "linear-gradient(90deg, #e8737a, #c0392b)",
                }}
              />
              <span style={{ fontWeight: 600 }}>ネガティブ</span>
            </div>
          </div>

          {/* Strengths group */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 6,
                background: "#ecfdf5",
                border: "1px solid #d1fae5",
                fontSize: 11,
                fontWeight: 700,
                color: "#0d9255",
                letterSpacing: "0.06em",
                fontFamily: "'DM Sans', sans-serif",
                marginBottom: 8,
              }}
            >
              ● STRENGTHS — 強み
            </div>
            {aspects
              .filter((a) => a.pos >= 75)
              .map((a, i) => (
                <AspectRow key={a.name} aspect={a} index={i} />
              ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "#e8ecf0", margin: "12px 0" }} />

          {/* Weaknesses group */}
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 12px",
                borderRadius: 6,
                background: "#fef7f7",
                border: "1px solid #fecaca",
                fontSize: 11,
                fontWeight: 700,
                color: "#c0392b",
                letterSpacing: "0.06em",
                fontFamily: "'DM Sans', sans-serif",
                marginBottom: 8,
              }}
            >
              ▲ NEEDS IMPROVEMENT — 要改善
            </div>
            {aspects
              .filter((a) => a.pos < 75)
              .map((a, i) => (
                <AspectRow key={a.name} aspect={a} index={i + 4} />
              ))}
          </div>
        </Accordion>

        <Accordion
          number="2"
          title="マーケティング施策提案"
          badge={{ text: `${proposals.length} ACTIONS`, color: "#b45309", bg: "#fffbeb" }}
        >
          <div style={{ marginBottom: 16 }}>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 13,
                color: "#6b7a8d",
                lineHeight: 1.7,
              }}
            >
              <strong style={{ color: "#1a2a3a" }}>ターゲット層:</strong> 安全性と快適性を重視するファミリー層 / 価格と燃費を気にする経済性重視層
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {proposals.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "#fafbfc",
                  border: "1px solid #edf0f4",
                  transition: "border-color 0.2s ease",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "#c8d4e0")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "#edf0f4")
                }
              >
                <span
                  style={{
                    fontSize: 22,
                    lineHeight: 1,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {p.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "#1a2a3a",
                      }}
                    >
                      {p.area}
                    </span>
                    <PriorityBadge priority={p.priority} />
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: "#6b7a8d",
                      lineHeight: 1.6,
                    }}
                  >
                    {p.action}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Accordion>

        <Accordion number="3" title="データソースと留意事項">
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "#f8f9fb",
              border: "1px solid #edf0f4",
              fontSize: 13,
              color: "#6b7a8d",
              lineHeight: 1.8,
            }}
          >
            <p style={{ margin: "0 0 8px" }}>
              本レポートは、{platform}の <strong style={{ color: "#1a2a3a" }}>#{keyword}</strong>{" "}
              ハッシュタグにおける上位表示動画{videoCount}本のテキストデータを基に、LLMによる側面抽出・感情分析を行った結果です。
            </p>
            <p style={{ margin: 0 }}>
              サンプルサイズが限定的であるため、信頼度は
              <strong style={{ color: "#b45309" }}>「中程度」</strong>
              としています。より正確な分析のためには、対象動画数の拡大やYouTube・Instagram等の他プラットフォームのデータを併用することを推奨します。
            </p>
          </div>
        </Accordion>

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            textAlign: "center",
            fontSize: 11,
            color: "#a0aab4",
            letterSpacing: "0.04em",
            paddingBottom: 24,
          }}
        >
          VSEO Analytics · Confidential · {new Date().getFullYear()}年{new Date().getMonth() + 1}月
        </div>
      </div>
    </div>
  );
}

export default ReportSection;
