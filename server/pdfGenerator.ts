import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, BorderStyle, WidthType, VerticalAlign, AlignmentType } from "docx";
import * as fs from "fs";
import * as path from "path";
import type { AnalysisJob, AnalysisReport, Video, TripleSearchResult } from "../drizzle/schema";

export interface PDFGenerationData {
  job: AnalysisJob;
  report: AnalysisReport | undefined;
  videos: Video[];
  tripleSearch: TripleSearchResult | undefined;
  keyword?: string;
}

/**
 * 分析レポートをDOCX形式で生成（後でPDFに変換可能）
 */
export async function generateAnalysisReportDocx(data: PDFGenerationData): Promise<Buffer> {
  const sections = [];

  // タイトルセクション
  sections.push(
    new Paragraph({
      text: "VSEO Analytics - 分析レポート",
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  // 基本情報
  sections.push(
    new Paragraph({
      text: "基本情報",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 100 },
    })
  );

  const basicInfoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph("キーワード")],
            shading: { fill: "E0E0E0" },
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph(data.keyword || data.job.keyword || "N/A")],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph("分析日時")],
            shading: { fill: "E0E0E0" },
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph(new Date(data.job.createdAt).toLocaleString("ja-JP"))],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph("ステータス")],
            shading: { fill: "E0E0E0" },
            width: { size: 30, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph(data.job.status)],
            width: { size: 70, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    ],
  });

  sections.push(basicInfoTable);
  sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

  // サマリーセクション
  if (data.report) {
    sections.push(
      new Paragraph({
        text: "分析サマリー",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );

    const summaryTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph("総動画数")],
              shading: { fill: "E0E0E0" },
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph((data.report?.totalVideos ?? 0).toString())],
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("総再生数")],
              shading: { fill: "E0E0E0" },
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph(formatNumber(data.report.totalViews))],
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph("総エンゲージメント")],
              shading: { fill: "E0E0E0" },
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph(formatNumber(data.report.totalEngagement))],
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("")],
              shading: { fill: "E0E0E0" },
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("")],
              width: { size: 25, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      ],
    });

    sections.push(summaryTable);
    sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

    // センチメント分析
    sections.push(
      new Paragraph({
        text: "センチメント分析",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );

    const sentimentTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph("ポジティブ")],
              shading: { fill: "C6E0B4" },
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("ニュートラル")],
              shading: { fill: "F4B084" },
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("ネガティブ")],
              shading: { fill: "F8CBAD" },
              width: { size: 34, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph(
                  `${data.report.positiveCount} (${data.report.positivePercentage}%)`
                ),
              ],
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph(
                  `${data.report.neutralCount} (${data.report.neutralPercentage}%)`
                ),
              ],
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph(
                  `${data.report.negativeCount} (${data.report.negativePercentage}%)`
                ),
              ],
              width: { size: 34, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      ],
    });

    sections.push(sentimentTable);
    sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

    // 頻出ワード
    if (data.report.positiveWords && data.report.positiveWords.length > 0) {
      sections.push(
        new Paragraph({
          text: "ポジティブキーワード",
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 100, after: 50 },
        })
      );

      sections.push(
        new Paragraph({
          text: data.report.positiveWords.join(", "),
          spacing: { after: 100 },
        })
      );
    }

    if (data.report.negativeWords && data.report.negativeWords.length > 0) {
      sections.push(
        new Paragraph({
          text: "ネガティブキーワード",
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 100, after: 50 },
        })
      );

      sections.push(
        new Paragraph({
          text: data.report.negativeWords.join(", "),
          spacing: { after: 100 },
        })
      );
    }

    // 主要示唆
    if (data.report.keyInsights && data.report.keyInsights.length > 0) {
      sections.push(
        new Paragraph({
          text: "主要示唆",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );

      for (const insight of data.report.keyInsights) {
        const categoryLabel = {
          risk: "⚠️ リスク",
          urgent: "🔴 緊急",
          positive: "✅ ポジティブ",
        }[insight.category];

        sections.push(
          new Paragraph({
            text: `${categoryLabel}: ${insight.title}`,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 100, after: 50 },
          })
        );

        sections.push(
          new Paragraph({
            text: insight.description,
            spacing: { after: 100 },
          })
        );
      }
    }
  }

  // 重複度分析
  if (data.tripleSearch && data.tripleSearch.appearedInAll3Ids) {
    sections.push(
      new Paragraph({
        text: "重複度分析",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );

    const overlapRate = ((data.tripleSearch.overlapRate ?? 0) / 10).toFixed(1);
    sections.push(
      new Paragraph({
        text: `重複率: ${overlapRate}%`,
        spacing: { after: 50 },
      })
    );

    const duplicateTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph("3回全出現")],
              shading: { fill: "E0E0E0" },
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("2回出現")],
              shading: { fill: "E0E0E0" },
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph("1回のみ")],
              shading: { fill: "E0E0E0" },
              width: { size: 34, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph(data.tripleSearch.appearedInAll3Ids.length.toString())],
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph(data.tripleSearch.appearedIn2Ids?.length.toString() || "0")],
              width: { size: 33, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph(data.tripleSearch.appearedIn1OnlyIds?.length.toString() || "0")],
              width: { size: 34, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      ],
    });

    sections.push(duplicateTable);
    sections.push(new Paragraph({ text: "", spacing: { after: 200 } }));

    // 共通点分析
    if (data.tripleSearch.commonalityAnalysis) {
      sections.push(
        new Paragraph({
          text: "勝ちパターン共通点分析",
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 100, after: 50 },
        })
      );

      const analysis = data.tripleSearch.commonalityAnalysis;

      if (analysis.summary) {
        sections.push(
          new Paragraph({
            text: "総括",
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 50, after: 30 },
          })
        );
        sections.push(new Paragraph({ text: analysis.summary, spacing: { after: 50 } }));
      }

      if (analysis.keyHook) {
        sections.push(
          new Paragraph({
            text: "共通キーフック",
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 50, after: 30 },
          })
        );
        sections.push(new Paragraph({ text: analysis.keyHook, spacing: { after: 50 } }));
      }

      if (analysis.contentTrend) {
        sections.push(
          new Paragraph({
            text: "コンテンツ傾向",
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 50, after: 30 },
          })
        );
        sections.push(new Paragraph({ text: analysis.contentTrend, spacing: { after: 50 } }));
      }

      if (analysis.formatFeatures) {
        sections.push(
          new Paragraph({
            text: "フォーマット特徴",
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 50, after: 30 },
          })
        );
        sections.push(new Paragraph({ text: analysis.formatFeatures, spacing: { after: 50 } }));
      }

      if (analysis.hashtagStrategy) {
        sections.push(
          new Paragraph({
            text: "ハッシュタグ戦略",
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 50, after: 30 },
          })
        );
        sections.push(new Paragraph({ text: analysis.hashtagStrategy, spacing: { after: 50 } }));
      }

      if (analysis.vseoTips) {
        sections.push(
          new Paragraph({
            text: "VSEO攻略ポイント",
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 50, after: 30 },
          })
        );
        sections.push(new Paragraph({ text: analysis.vseoTips, spacing: { after: 50 } }));
      }
    }
  }

  // 動画リスト
  if (data.videos && data.videos.length > 0) {
    sections.push(
      new Paragraph({
        text: "分析対象動画一覧",
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      })
    );

    for (const video of data.videos) {
      sections.push(
        new Paragraph({
          text: `${video.accountName} - ${video.title || "No Title"}`,
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 100, after: 50 },
        })
      );

      const videoTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph("再生数")],
                shading: { fill: "E0E0E0" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph(formatNumber(video.viewCount || 0))],
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph("いいね")],
                shading: { fill: "E0E0E0" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph(formatNumber(video.likeCount || 0))],
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph("コメント")],
                shading: { fill: "E0E0E0" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph(formatNumber(video.commentCount || 0))],
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph("シェア")],
                shading: { fill: "E0E0E0" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph(formatNumber(video.shareCount || 0))],
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph("センチメント")],
                shading: { fill: "E0E0E0" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph(video.sentiment || "N/A")],
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph("フォロワー")],
                shading: { fill: "E0E0E0" },
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
              new TableCell({
                children: [new Paragraph(formatNumber(video.followerCount || 0))],
                width: { size: 25, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
        ],
      });

      sections.push(videoTable);
      sections.push(new Paragraph({ text: "", spacing: { after: 100 } }));
    }
  }

  // フッター
  sections.push(
    new Paragraph({
      text: `生成日時: ${new Date().toLocaleString("ja-JP")}`,
      spacing: { before: 200 },
      alignment: AlignmentType.CENTER,
    })
  );

  const doc = new Document({
    sections: [
      {
        children: sections,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

/**
 * 数値をフォーマット（1000以上は"K"表記）
 */
function formatNumber(num: number | null | undefined): string {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}
