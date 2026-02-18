import { describe, it, expect, beforeAll } from "vitest";
import * as db from "./db";
import {
  analyzeVideoFromTikTok,
  analyzeVideoFromUrl,
  analyzeSentimentAndKeywords,
  analyzeDuplicates,
  generateAnalysisReport,
} from "./videoAnalysis";
import type { TikTokVideo } from "./tiktokScraper";

// テスト用のTikTokVideoモック
function createMockTikTokVideo(overrides: Partial<TikTokVideo> = {}): TikTokVideo {
  return {
    id: "test_" + Math.random().toString(36).substring(7),
    desc: "テスト動画の説明 #テスト #検証",
    createTime: Math.floor(Date.now() / 1000),
    duration: 30,
    coverUrl: "https://example.com/cover.jpg",
    playUrl: "https://example.com/play.mp4",
    author: {
      uniqueId: "test_user",
      nickname: "テストユーザー",
      avatarUrl: "https://example.com/avatar.jpg",
      followerCount: 10000,
      followingCount: 500,
      heartCount: 50000,
      videoCount: 100,
    },
    stats: {
      playCount: 50000,
      diggCount: 5000,
      commentCount: 500,
      shareCount: 250,
      collectCount: 1000,
    },
    hashtags: ["テスト", "検証"],
    ...overrides,
  };
}

describe("Video Analysis Engine", () => {
  let testJobId: number;

  beforeAll(async () => {
    testJobId = await db.createAnalysisJob({
      userId: 1,
      keyword: "テスト",
      status: "pending",
    });
  });

  describe("analyzeVideoFromTikTok", () => {
    it("should create video record from TikTok data", { timeout: 30000 }, async () => {
      const mockVideo = createMockTikTokVideo({
        id: "12345678901",
        desc: "テスト動画 #テスト",
        author: {
          uniqueId: "testuser1",
          nickname: "テストユーザー1",
          avatarUrl: "https://example.com/avatar.jpg",
          followerCount: 5000,
          followingCount: 200,
          heartCount: 30000,
          videoCount: 50,
        },
        stats: {
          playCount: 100000,
          diggCount: 10000,
          commentCount: 1000,
          shareCount: 500,
          collectCount: 2000,
        },
      });

      await analyzeVideoFromTikTok(testJobId, mockVideo);

      // DBに動画が保存されたか確認
      const videos = await db.getVideosByJobId(testJobId);
      const savedVideo = videos.find(v => v.videoId === "12345678901");
      expect(savedVideo).toBeDefined();
      expect(savedVideo!.platform).toBe("tiktok");
      expect(savedVideo!.accountId).toBe("testuser1");
      expect(Number(savedVideo!.viewCount)).toBe(100000);
    });

    it("should store engagement metrics correctly", { timeout: 30000 }, async () => {
      const mockVideo = createMockTikTokVideo({
        id: "engagement_test",
        stats: {
          playCount: 200000,
          diggCount: 20000,
          commentCount: 2000,
          shareCount: 1000,
          collectCount: 5000,
        },
      });

      await analyzeVideoFromTikTok(testJobId, mockVideo);

      const videos = await db.getVideosByJobId(testJobId);
      const savedVideo = videos.find(v => v.videoId === "engagement_test");
      expect(savedVideo).toBeDefined();
      expect(Number(savedVideo!.likeCount)).toBe(20000);
      expect(Number(savedVideo!.commentCount)).toBe(2000);
      expect(Number(savedVideo!.shareCount)).toBe(1000);
      expect(Number(savedVideo!.saveCount)).toBe(5000);
    });
  });

  describe("analyzeSentimentAndKeywords", () => {
    it("should return sentiment, keywords, and keyHook", { timeout: 30000 }, async () => {
      const result = await analyzeSentimentAndKeywords({
        title: "最高の旅行体験！おすすめスポット紹介",
        description: "今回は最高の旅行体験をシェアします。おすすめスポットを紹介！",
        hashtags: ["旅行", "おすすめ"],
        ocrTexts: ["最高の旅行体験", "おすすめスポット"],
        transcriptionText: "今回は最高の旅行体験をシェアします",
      });

      expect(result).toHaveProperty("sentiment");
      expect(["positive", "negative", "neutral"]).toContain(result.sentiment);
      expect(result).toHaveProperty("keywords");
      expect(Array.isArray(result.keywords)).toBe(true);
      expect(result).toHaveProperty("keyHook");
      expect(typeof result.keyHook).toBe("string");
    });
  });

  describe("analyzeDuplicates", () => {
    it("should update duplicate counts for videos in a job", { timeout: 15000 }, async () => {
      // 新しいジョブを作成
      const dupJobId = await db.createAnalysisJob({
        userId: 1,
        keyword: "重複テスト",
        status: "processing",
      });

      // 同じvideoIdで複数のレコードを作成
      const sameVideoId = "dup_video_123";
      for (let i = 0; i < 3; i++) {
        await db.createVideo({
          jobId: dupJobId,
          videoUrl: `https://www.tiktok.com/@user${i}/video/${sameVideoId}`,
          platform: "tiktok",
          videoId: sameVideoId,
          title: "重複テスト動画",
          description: "テスト",
          thumbnailUrl: "https://example.com/thumb.jpg",
          duration: 30,
          viewCount: 10000,
          likeCount: 1000,
          commentCount: 100,
          shareCount: 50,
          saveCount: 200,
          accountName: `user${i}`,
          accountId: `user${i}`,
          followerCount: 5000,
          accountAvatarUrl: "https://example.com/avatar.jpg",
          hashtags: ["テスト"],
          postedAt: new Date(),
        });
      }

      // ユニークな動画も追加
      await db.createVideo({
        jobId: dupJobId,
        videoUrl: "https://www.tiktok.com/@unique/video/unique_123",
        platform: "tiktok",
        videoId: "unique_123",
        title: "ユニーク動画",
        description: "テスト",
        thumbnailUrl: "https://example.com/thumb.jpg",
        duration: 30,
        viewCount: 5000,
        likeCount: 500,
        commentCount: 50,
        shareCount: 25,
        saveCount: 100,
        accountName: "unique_user",
        accountId: "unique_user",
        followerCount: 3000,
        accountAvatarUrl: "https://example.com/avatar.jpg",
        hashtags: ["テスト"],
        postedAt: new Date(),
      });

      await analyzeDuplicates(dupJobId);

      const videos = await db.getVideosByJobId(dupJobId);
      const dupVideos = videos.filter(v => v.videoId === sameVideoId);
      const uniqueVideo = videos.find(v => v.videoId === "unique_123");

      // 重複動画は duplicateCount = 2 (自分以外に2つ)
      dupVideos.forEach(v => {
        expect(v.duplicateCount).toBe(2);
      });

      // ユニーク動画は duplicateCount = 0
      expect(uniqueVideo!.duplicateCount).toBe(0);
    });
  });

  describe("generateAnalysisReport", () => {
    it("should generate a report for a job with videos", { timeout: 60000 }, async () => {
      // テスト用のジョブを作成
      const reportJobId = await db.createAnalysisJob({
        userId: 1,
        keyword: "レポートテスト",
        status: "processing",
      });

      // 動画を追加
      const mockVideo = createMockTikTokVideo({ id: "report_test_1" });
      await analyzeVideoFromTikTok(reportJobId, mockVideo);

      // レポート生成
      await generateAnalysisReport(reportJobId);

      // レポートが保存されたか確認
      const report = await db.getAnalysisReportByJobId(reportJobId);
      expect(report).toBeDefined();
      expect(report).toHaveProperty("totalVideos");
    });
  });
});
