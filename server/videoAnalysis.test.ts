import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as db from "./db";
import {
  fetchVideoMetadata,
  performOcrAnalysis,
  performTranscription,
  calculateScores,
  analyzeVideo,
  analyzeDuplicates,
} from "./videoAnalysis";

describe("Video Analysis Engine", () => {
  let testJobId: number;
  let testUserId: number;

  beforeAll(async () => {
    // テスト用のユーザーとジョブを作成
    testUserId = 1; // 仮のユーザーID
    testJobId = await db.createAnalysisJob({
      userId: testUserId,
      keyword: "テスト",
      status: "pending",
    });
  });

  describe("fetchVideoMetadata", () => {
    it("should extract TikTok video metadata", async () => {
      const tiktokUrl = "https://www.tiktok.com/@user/video/123456789";
      const metadata = await fetchVideoMetadata(tiktokUrl);

      expect(metadata.platform).toBe("tiktok");
      expect(metadata.videoId).toBe("123456789");
      expect(metadata.url).toBe(tiktokUrl);
      expect(metadata.duration).toBeGreaterThan(0);
    });

    it("should extract YouTube Shorts metadata", async () => {
      const youtubeUrl = "https://youtube.com/shorts/abc123";
      const metadata = await fetchVideoMetadata(youtubeUrl);

      expect(metadata.platform).toBe("youtube");
      expect(metadata.videoId).toBe("abc123");
      expect(metadata.url).toBe(youtubeUrl);
      expect(metadata.duration).toBeGreaterThan(0);
    });
  });

  describe("performOcrAnalysis", () => {
    it("should extract text from video frames at 2-second intervals", async () => {
      const videoUrl = "https://www.tiktok.com/@user/video/123456789";
      const duration = 10; // 10秒の動画

      const ocrResults = await performOcrAnalysis(videoUrl, duration);

      // 10秒の動画なら、0秒、2秒、4秒、6秒、8秒の5フレーム
      expect(ocrResults.length).toBe(5);
      expect(ocrResults[0].frameTimestamp).toBe(0);
      expect(ocrResults[1].frameTimestamp).toBe(2);
      expect(ocrResults[2].frameTimestamp).toBe(4);
      expect(ocrResults[3].frameTimestamp).toBe(6);
      expect(ocrResults[4].frameTimestamp).toBe(8);

      // 各フレームにテキストが含まれている
      ocrResults.forEach((result) => {
        expect(typeof result.extractedText).toBe("string");
      });
    });

    it("should handle short videos correctly", async () => {
      const videoUrl = "https://www.tiktok.com/@user/video/123456789";
      const duration = 3; // 3秒の動画

      const ocrResults = await performOcrAnalysis(videoUrl, duration);

      // 3秒の動画なら、0秒、2秒の2フレーム
      expect(ocrResults.length).toBe(2);
    });
  });

  describe("performTranscription", () => {
    it("should return transcription with text and language", async () => {
      const videoUrl = "https://www.tiktok.com/@user/video/123456789";

      const transcription = await performTranscription(videoUrl);

      expect(transcription).toHaveProperty("fullText");
      expect(transcription).toHaveProperty("language");
      expect(typeof transcription.fullText).toBe("string");
      expect(typeof transcription.language).toBe("string");
    });
  });

  describe("calculateScores", () => {
    it("should calculate scores for video components", async () => {
      const metadata = {
        url: "https://www.tiktok.com/@user/video/123456789",
        platform: "tiktok" as const,
        title: "テスト動画",
        thumbnailUrl: "https://example.com/thumb.jpg",
        duration: 30,
        videoId: "123456789",
      };

      const ocrResults = [
        { frameTimestamp: 0, extractedText: "今日のメイク" },
        { frameTimestamp: 2, extractedText: "おすすめ商品" },
      ];

      const transcription = {
        fullText: "こんにちは、今日は最新のメイクテクニックを紹介します。",
        language: "ja",
      };

      const scores = await calculateScores(metadata, ocrResults, transcription);

      expect(scores).toHaveProperty("thumbnailScore");
      expect(scores).toHaveProperty("textScore");
      expect(scores).toHaveProperty("audioScore");
      expect(scores).toHaveProperty("overallScore");

      // スコアは0-100の範囲
      expect(scores.thumbnailScore).toBeGreaterThanOrEqual(0);
      expect(scores.thumbnailScore).toBeLessThanOrEqual(100);
      expect(scores.textScore).toBeGreaterThanOrEqual(0);
      expect(scores.textScore).toBeLessThanOrEqual(100);
      expect(scores.audioScore).toBeGreaterThanOrEqual(0);
      expect(scores.audioScore).toBeLessThanOrEqual(100);
      expect(scores.overallScore).toBeGreaterThanOrEqual(0);
      expect(scores.overallScore).toBeLessThanOrEqual(100);
    });
  });

  describe("analyzeVideo", () => {
    it("should perform complete video analysis and store results in database", async () => {
      const videoUrl = "https://www.tiktok.com/@user/video/987654321";

      const result = await analyzeVideo(testJobId, videoUrl);

      expect(result).toHaveProperty("videoId");
      expect(result).toHaveProperty("ocrResults");
      expect(result).toHaveProperty("transcription");
      expect(result).toHaveProperty("scores");

      // データベースに保存されているか確認
      const video = await db.getVideosByJobId(testJobId);
      expect(video.length).toBeGreaterThan(0);

      const savedVideo = video.find((v) => v.videoUrl === videoUrl);
      expect(savedVideo).toBeDefined();

      // OCR結果が保存されているか確認
      const ocrResults = await db.getOcrResultsByVideoId(result.videoId);
      expect(ocrResults.length).toBeGreaterThan(0);

      // 文字起こし結果が保存されているか確認
      const transcription = await db.getTranscriptionByVideoId(result.videoId);
      expect(transcription).toBeDefined();

      // スコアが保存されているか確認
      const score = await db.getAnalysisScoreByVideoId(result.videoId);
      expect(score).toBeDefined();
    });
  });

  describe("analyzeDuplicates", () => {
    it("should detect duplicate videos across multiple analyses", { timeout: 15000 }, async () => {
      const duplicateVideoUrl = "https://www.tiktok.com/@user/video/111222333";

      // 同じ動画を3回分析（3アカウントでの出現をシミュレート）
      await analyzeVideo(testJobId, duplicateVideoUrl);
      await analyzeVideo(testJobId, duplicateVideoUrl);
      await analyzeVideo(testJobId, duplicateVideoUrl);

      // 重複度分析を実行
      await analyzeDuplicates(testJobId);

      // 重複度が正しく設定されているか確認
      const videos = await db.getVideosByJobId(testJobId);
      const duplicateVideos = videos.filter((v) => v.videoUrl === duplicateVideoUrl);

      expect(duplicateVideos.length).toBe(3);
      duplicateVideos.forEach((video) => {
        // 3回出現 = 重複度2（自分自身を除く）
        expect(video.duplicateCount).toBe(2);
      });
    });

    it("should handle videos with no duplicates", async () => {
      const uniqueVideoUrl = "https://www.tiktok.com/@user/video/unique123";

      await analyzeVideo(testJobId, uniqueVideoUrl);
      await analyzeDuplicates(testJobId);

      const videos = await db.getVideosByJobId(testJobId);
      const uniqueVideo = videos.find((v) => v.videoUrl === uniqueVideoUrl);

      expect(uniqueVideo).toBeDefined();
      expect(uniqueVideo!.duplicateCount).toBe(0);
    });
  });
});
