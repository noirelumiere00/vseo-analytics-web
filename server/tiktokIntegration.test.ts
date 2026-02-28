import { describe, it, expect, vi } from "vitest";

// tiktokScraper のモック
vi.mock("./tiktokScraper", () => ({
  searchTikTokVideos: vi.fn().mockResolvedValue({
    videos: [
      {
        id: "12345",
        desc: "ジャングリア沖縄に行ってきた！最高の体験 #ジャングリア #沖縄 #旅行",
        createTime: 1700000000,
        duration: 30,
        coverUrl: "https://example.com/cover.jpg",
        playUrl: "https://example.com/play.mp4",
        author: {
          uniqueId: "user1",
          nickname: "テストユーザー1",
          avatarUrl: "https://example.com/avatar1.jpg",
          followerCount: 10000,
          followingCount: 100,
          heartCount: 50000,
          videoCount: 200,
        },
        stats: {
          playCount: 100000,
          diggCount: 5000,
          commentCount: 300,
          shareCount: 200,
          collectCount: 100,
        },
        hashtags: ["ジャングリア", "沖縄", "旅行"],
      },
      {
        id: "67890",
        desc: "沖縄のジャングリアがすごい！ #沖縄旅行",
        createTime: 1700100000,
        duration: 45,
        coverUrl: "https://example.com/cover2.jpg",
        playUrl: "https://example.com/play2.mp4",
        author: {
          uniqueId: "user2",
          nickname: "テストユーザー2",
          avatarUrl: "https://example.com/avatar2.jpg",
          followerCount: 50000,
          followingCount: 200,
          heartCount: 200000,
          videoCount: 500,
        },
        stats: {
          playCount: 500000,
          diggCount: 20000,
          commentCount: 1000,
          shareCount: 500,
          collectCount: 300,
        },
        hashtags: ["沖縄旅行"],
      },
    ],
    keyword: "ジャングリア沖縄",
    totalFetched: 2,
  }),
}));

// videoAnalysis のモック
vi.mock("./videoAnalysis", () => ({
  analyzeVideoFromTikTok: vi.fn().mockResolvedValue({ dbVideoId: 1, sentimentInput: {} }),
  analyzeVideoFromUrl: vi.fn().mockResolvedValue(undefined),
  analyzeDuplicates: vi.fn().mockResolvedValue(undefined),
  generateAnalysisReport: vi.fn().mockResolvedValue(undefined),
}));

describe("TikTok Integration", () => {
  it("TikTokVideo型の構造が正しいこと", async () => {
    const { searchTikTokVideos } = await import("./tiktokScraper");
    const result = await searchTikTokVideos("ジャングリア沖縄", 10);

    expect(result.videos).toHaveLength(2);
    expect(result.keyword).toBe("ジャングリア沖縄");

    const video = result.videos[0];
    expect(video.id).toBe("12345");
    expect(video.author.uniqueId).toBe("user1");
    expect(video.stats.playCount).toBe(100000);
    expect(video.hashtags).toContain("ジャングリア");
  });

  it("動画をアカウント別にグループ化できること", async () => {
    const { searchTikTokVideos } = await import("./tiktokScraper");
    const result = await searchTikTokVideos("ジャングリア沖縄", 10);

    // アカウント別にグループ化
    const accountMap = new Map<string, typeof result.videos>();
    for (const video of result.videos) {
      const key = video.author.uniqueId;
      if (!accountMap.has(key)) accountMap.set(key, []);
      accountMap.get(key)!.push(video);
    }

    expect(accountMap.size).toBe(2);
    expect(accountMap.get("user1")).toHaveLength(1);
    expect(accountMap.get("user2")).toHaveLength(1);
  });

  it("動画を再生数でソートできること", async () => {
    const { searchTikTokVideos } = await import("./tiktokScraper");
    const result = await searchTikTokVideos("ジャングリア沖縄", 10);

    const sorted = [...result.videos].sort(
      (a, b) => b.stats.playCount - a.stats.playCount
    );

    expect(sorted[0].id).toBe("67890"); // 500000再生
    expect(sorted[1].id).toBe("12345"); // 100000再生
  });

  it("analyzeVideoFromTikTokが呼び出し可能であること", async () => {
    const { analyzeVideoFromTikTok } = await import("./videoAnalysis");
    const { searchTikTokVideos } = await import("./tiktokScraper");
    const result = await searchTikTokVideos("ジャングリア沖縄", 10);

    await analyzeVideoFromTikTok(1, result.videos[0]);
    expect(analyzeVideoFromTikTok).toHaveBeenCalledWith(1, result.videos[0]);
  });

  it("generateAnalysisReportが呼び出し可能であること", async () => {
    const { generateAnalysisReport } = await import("./videoAnalysis");

    await generateAnalysisReport(1);
    expect(generateAnalysisReport).toHaveBeenCalledWith(1);
  });

  it("ハッシュタグの抽出が正しいこと", async () => {
    const { searchTikTokVideos } = await import("./tiktokScraper");
    const result = await searchTikTokVideos("ジャングリア沖縄", 10);

    expect(result.videos[0].hashtags).toEqual(["ジャングリア", "沖縄", "旅行"]);
    expect(result.videos[1].hashtags).toEqual(["沖縄旅行"]);
  });

  it("エンゲージメント率を計算できること", async () => {
    const { searchTikTokVideos } = await import("./tiktokScraper");
    const result = await searchTikTokVideos("ジャングリア沖縄", 10);

    const video = result.videos[0];
    const engagementRate =
      ((video.stats.diggCount + video.stats.commentCount + video.stats.shareCount) /
        video.stats.playCount) *
      100;

    expect(engagementRate).toBeCloseTo(5.5, 1); // (5000+300+200)/100000 * 100 = 5.5%
  });
});
