import { describe, it, expect, beforeEach } from "vitest";
import { generateAnalysisReportDocx, type PDFGenerationData } from "./pdfGenerator";
import type { AnalysisJob, AnalysisReport, Video, TripleSearchResult } from "../drizzle/schema";

describe("pdfGenerator", () => {
  let mockData: PDFGenerationData;

  beforeEach(() => {
    const now = new Date();
    
    const mockJob: AnalysisJob = {
      id: 1,
      userId: 1,
      keyword: "テストキーワード",
      manualUrls: null,
      status: "completed",
      createdAt: now,
      completedAt: now,
    };

    const mockReport: AnalysisReport = {
      id: 1,
      jobId: 1,
      totalVideos: 10,
      totalViews: 100000,
      totalEngagement: 5000,
      neutralCount: 2,
      neutralPercentage: 20,
      positiveCount: 6,
      positivePercentage: 60,
      negativeCount: 2,
      negativePercentage: 20,
      posNegPositiveCount: 6,
      posNegPositivePercentage: 75,
      posNegNegativeCount: 2,
      posNegNegativePercentage: 25,
      positiveViewsShare: 70,
      negativeViewsShare: 30,
      positiveEngagementShare: 75,
      negativeEngagementShare: 25,
      positiveWords: ["素晴らしい", "最高", "おすすめ"],
      negativeWords: ["つまらない", "退屈", "つまらん"],
      keyInsights: [
        {
          category: "positive",
          title: "高いエンゲージメント率",
          description: "ポジティブなコンテンツは平均75%のエンゲージメント率を達成",
        },
      ],
      createdAt: now,
    };

    const mockVideos: Video[] = [
      {
        id: 1,
        jobId: 1,
        platform: "tiktok",
        videoUrl: "https://www.tiktok.com/@user/video/123",
        videoId: "123",
        title: "テスト動画1",
        description: "テスト説明",
        thumbnailUrl: "https://example.com/thumb.jpg",
        duration: 30,
        viewCount: 10000,
        likeCount: 500,
        commentCount: 100,
        shareCount: 50,
        saveCount: 30,
        accountName: "テストアカウント",
        accountId: "user123",
        followerCount: 50000,
        accountAvatarUrl: "https://example.com/avatar.jpg",
        sentiment: "positive",
        keyHook: "テストキーフック",
        keywords: ["キーワード1", "キーワード2"],
        hashtags: ["#テスト", "#動画"],
        duplicateCount: 3,
        postedAt: now,
        createdAt: now,
      },
    ];

    const mockTripleSearch: TripleSearchResult = {
      id: 1,
      jobId: 1,
      searchData: [
        { sessionIndex: 0, totalFetched: 15, videoIds: ["123", "456", "789"] },
        { sessionIndex: 1, totalFetched: 15, videoIds: ["123", "456", "101"] },
        { sessionIndex: 2, totalFetched: 15, videoIds: ["123", "456", "202"] },
      ],
      appearedInAll3Ids: ["123", "456"],
      appearedIn2Ids: ["789", "101"],
      appearedIn1OnlyIds: ["202"],
      overlapRate: 133, // 13.3%
      commonalityAnalysis: {
        summary: "3回全出現した動画の共通特徴",
        keyHook: "共通キーフック",
        contentTrend: "コンテンツトレンド",
        formatFeatures: "フォーマット特徴",
        hashtagStrategy: "ハッシュタグ戦略",
        vseoTips: "VSEO攻略ポイント",
      },
      createdAt: now,
    };

    mockData = {
      job: mockJob,
      report: mockReport,
      videos: mockVideos,
      tripleSearch: mockTripleSearch,
      keyword: "テストキーワード",
    };
  });

  it("should generate a valid DOCX buffer", async () => {
    const buffer = await generateAnalysisReportDocx(mockData);
    
    expect(buffer).toBeDefined();
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should generate DOCX with report data", async () => {
    const buffer = await generateAnalysisReportDocx(mockData);
    const bufferString = Buffer.from(buffer).toString("utf-8", 0, 500);
    
    // DOCX is a ZIP file, so it should start with PK (ZIP signature)
    expect(bufferString.charCodeAt(0)).toBe(80); // 'P'
    expect(bufferString.charCodeAt(1)).toBe(75); // 'K'
  });

  it("should handle missing report gracefully", async () => {
    const dataWithoutReport = { ...mockData, report: undefined };
    const buffer = await generateAnalysisReportDocx(dataWithoutReport);
    
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should handle missing triple search data gracefully", async () => {
    const dataWithoutTripleSearch = { ...mockData, tripleSearch: undefined };
    const buffer = await generateAnalysisReportDocx(dataWithoutTripleSearch);
    
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should handle empty videos array", async () => {
    const dataWithoutVideos = { ...mockData, videos: [] };
    const buffer = await generateAnalysisReportDocx(dataWithoutVideos);
    
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should generate DOCX with all data sections", async () => {
    const buffer = await generateAnalysisReportDocx(mockData);
    
    // Buffer should be large enough to contain all sections
    // (typical size: ~8-10KB for a full report with all sections)
    expect(buffer.length).toBeGreaterThan(5000);
  });
});
