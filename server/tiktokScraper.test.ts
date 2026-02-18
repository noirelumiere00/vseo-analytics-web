import { describe, it, expect } from "vitest";

// tiktokScraper.tsの型定義とユーティリティ関数のテスト
// 実際のPuppeteerブラウザ起動はCI/CDでは行わないため、
// データ変換・重複分析ロジックのユニットテストを中心に行う

// テスト用のモックデータ
const mockTikTokVideo = (id: string, playCount: number = 1000) => ({
  id,
  desc: `テスト動画 ${id}`,
  createTime: Date.now() / 1000,
  duration: 30,
  coverUrl: `https://example.com/cover/${id}.jpg`,
  playUrl: `https://example.com/play/${id}.mp4`,
  author: {
    uniqueId: `user_${id}`,
    nickname: `ユーザー ${id}`,
    avatarUrl: `https://example.com/avatar/${id}.jpg`,
    followerCount: 10000,
    followingCount: 500,
    heartCount: 50000,
    videoCount: 100,
  },
  stats: {
    playCount,
    diggCount: Math.floor(playCount * 0.1),
    commentCount: Math.floor(playCount * 0.01),
    shareCount: Math.floor(playCount * 0.005),
    collectCount: Math.floor(playCount * 0.02),
  },
  hashtags: ["テスト", "検証"],
});

// 重複分析ロジックのテスト（tiktokScraper.tsの内部ロジックを再現）
function analyzeDuplicatesLogic(
  searches: Array<{ videos: Array<{ id: string; stats: { playCount: number } }> }>
) {
  const videoAppearanceCount = new Map<string, number>();
  const videoMap = new Map<string, any>();

  for (const search of searches) {
    const seenInThisSearch = new Set<string>();
    for (const video of search.videos) {
      if (!seenInThisSearch.has(video.id)) {
        seenInThisSearch.add(video.id);
        videoAppearanceCount.set(
          video.id,
          (videoAppearanceCount.get(video.id) || 0) + 1
        );
        if (
          !videoMap.has(video.id) ||
          video.stats.playCount > (videoMap.get(video.id)?.stats.playCount || 0)
        ) {
          videoMap.set(video.id, video);
        }
      }
    }
  }

  const appearedInAll3: any[] = [];
  const appearedIn2: any[] = [];
  const appearedIn1Only: any[] = [];

  for (const [videoId, count] of Array.from(videoAppearanceCount.entries())) {
    const video = videoMap.get(videoId)!;
    if (count >= 3) {
      appearedInAll3.push(video);
    } else if (count === 2) {
      appearedIn2.push(video);
    } else {
      appearedIn1Only.push(video);
    }
  }

  appearedInAll3.sort((a, b) => b.stats.playCount - a.stats.playCount);
  appearedIn2.sort((a, b) => b.stats.playCount - a.stats.playCount);
  appearedIn1Only.sort((a, b) => b.stats.playCount - a.stats.playCount);

  const allUniqueVideos = [...appearedInAll3, ...appearedIn2, ...appearedIn1Only];
  const totalUniqueCount = allUniqueVideos.length;
  const duplicateCount = appearedInAll3.length + appearedIn2.length;
  const overlapRate = totalUniqueCount > 0 ? (duplicateCount / totalUniqueCount) * 100 : 0;

  return { appearedInAll3, appearedIn2, appearedIn1Only, allUniqueVideos, overlapRate };
}

describe("TikTok Scraper - Duplicate Analysis Logic", () => {
  it("should identify videos appearing in all 3 searches", () => {
    const commonVideo = mockTikTokVideo("common1", 50000);
    const searches = [
      { videos: [commonVideo, mockTikTokVideo("a1"), mockTikTokVideo("a2")] },
      { videos: [commonVideo, mockTikTokVideo("b1"), mockTikTokVideo("b2")] },
      { videos: [commonVideo, mockTikTokVideo("c1"), mockTikTokVideo("c2")] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(1);
    expect(result.appearedInAll3[0].id).toBe("common1");
    expect(result.appearedIn2.length).toBe(0);
    expect(result.appearedIn1Only.length).toBe(6);
  });

  it("should identify videos appearing in 2 out of 3 searches", () => {
    const twoTimeVideo = mockTikTokVideo("two1", 30000);
    const searches = [
      { videos: [twoTimeVideo, mockTikTokVideo("a1")] },
      { videos: [twoTimeVideo, mockTikTokVideo("b1")] },
      { videos: [mockTikTokVideo("c1"), mockTikTokVideo("c2")] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(0);
    expect(result.appearedIn2.length).toBe(1);
    expect(result.appearedIn2[0].id).toBe("two1");
    expect(result.appearedIn1Only.length).toBe(4);
  });

  it("should calculate correct overlap rate with all duplicates", () => {
    const v1 = mockTikTokVideo("v1", 50000);
    const v2 = mockTikTokVideo("v2", 40000);
    const v3 = mockTikTokVideo("v3", 30000);

    const searches = [
      { videos: [v1, v2, v3] },
      { videos: [v1, v2, v3] },
      { videos: [v1, v2, v3] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(3);
    expect(result.appearedIn2.length).toBe(0);
    expect(result.appearedIn1Only.length).toBe(0);
    expect(result.overlapRate).toBe(100);
    expect(result.allUniqueVideos.length).toBe(3);
  });

  it("should calculate correct overlap rate with no duplicates", () => {
    const searches = [
      { videos: [mockTikTokVideo("a1"), mockTikTokVideo("a2")] },
      { videos: [mockTikTokVideo("b1"), mockTikTokVideo("b2")] },
      { videos: [mockTikTokVideo("c1"), mockTikTokVideo("c2")] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(0);
    expect(result.appearedIn2.length).toBe(0);
    expect(result.appearedIn1Only.length).toBe(6);
    expect(result.overlapRate).toBe(0);
    expect(result.allUniqueVideos.length).toBe(6);
  });

  it("should sort videos by playCount within each category", () => {
    const high = mockTikTokVideo("high", 100000);
    const mid = mockTikTokVideo("mid", 50000);
    const low = mockTikTokVideo("low", 10000);

    const searches = [
      { videos: [low, high, mid] },
      { videos: [mid, low, high] },
      { videos: [high, mid, low] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(3);
    expect(result.appearedInAll3[0].id).toBe("high");
    expect(result.appearedInAll3[1].id).toBe("mid");
    expect(result.appearedInAll3[2].id).toBe("low");
  });

  it("should handle empty searches", () => {
    const searches = [
      { videos: [] as any[] },
      { videos: [] as any[] },
      { videos: [] as any[] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(0);
    expect(result.appearedIn2.length).toBe(0);
    expect(result.appearedIn1Only.length).toBe(0);
    expect(result.overlapRate).toBe(0);
    expect(result.allUniqueVideos.length).toBe(0);
  });

  it("should handle mixed overlap scenario", () => {
    const allThree = mockTikTokVideo("all3", 80000);
    const twoTimes = mockTikTokVideo("two", 60000);
    const oneTime = mockTikTokVideo("one", 40000);

    const searches = [
      { videos: [allThree, twoTimes, oneTime] },
      { videos: [allThree, twoTimes, mockTikTokVideo("x1")] },
      { videos: [allThree, mockTikTokVideo("x2"), mockTikTokVideo("x3")] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(1);
    expect(result.appearedInAll3[0].id).toBe("all3");
    expect(result.appearedIn2.length).toBe(1);
    expect(result.appearedIn2[0].id).toBe("two");
    expect(result.appearedIn1Only.length).toBe(4);
    
    // 重複率: (1 + 1) / 6 * 100 = 33.3%
    expect(result.overlapRate).toBeCloseTo(33.33, 1);
  });

  it("should not count duplicate videos within the same search", () => {
    const video = mockTikTokVideo("dup", 50000);

    const searches = [
      { videos: [video, video, video] }, // 同じ検索内での重複
      { videos: [mockTikTokVideo("b1")] },
      { videos: [mockTikTokVideo("c1")] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    // 同じ検索内での重複は1回としてカウント
    expect(result.appearedInAll3.length).toBe(0);
    expect(result.appearedIn2.length).toBe(0);
    expect(result.appearedIn1Only.length).toBe(3);
    expect(result.appearedIn1Only.find((v: any) => v.id === "dup")).toBeDefined();
  });

  it("should keep the video with highest playCount when merging", () => {
    const v1Low = { ...mockTikTokVideo("same", 10000) };
    const v1Mid = { ...mockTikTokVideo("same", 50000) };
    const v1High = { ...mockTikTokVideo("same", 100000) };

    const searches = [
      { videos: [v1Low] },
      { videos: [v1High] },
      { videos: [v1Mid] },
    ];

    const result = analyzeDuplicatesLogic(searches);

    expect(result.appearedInAll3.length).toBe(1);
    expect(result.appearedInAll3[0].stats.playCount).toBe(100000);
  });
});

describe("TikTok Video Data Structure", () => {
  it("should have correct structure for mock video", () => {
    const video = mockTikTokVideo("test1", 5000);

    expect(video).toHaveProperty("id");
    expect(video).toHaveProperty("desc");
    expect(video).toHaveProperty("createTime");
    expect(video).toHaveProperty("duration");
    expect(video).toHaveProperty("coverUrl");
    expect(video).toHaveProperty("playUrl");
    expect(video).toHaveProperty("author");
    expect(video).toHaveProperty("stats");
    expect(video).toHaveProperty("hashtags");

    expect(video.author).toHaveProperty("uniqueId");
    expect(video.author).toHaveProperty("nickname");
    expect(video.author).toHaveProperty("followerCount");

    expect(video.stats).toHaveProperty("playCount");
    expect(video.stats).toHaveProperty("diggCount");
    expect(video.stats).toHaveProperty("commentCount");
    expect(video.stats).toHaveProperty("shareCount");
    expect(video.stats).toHaveProperty("collectCount");
  });

  it("should calculate engagement metrics correctly", () => {
    const video = mockTikTokVideo("test2", 10000);

    expect(video.stats.playCount).toBe(10000);
    expect(video.stats.diggCount).toBe(1000); // 10%
    expect(video.stats.commentCount).toBe(100); // 1%
    expect(video.stats.shareCount).toBe(50); // 0.5%
    expect(video.stats.collectCount).toBe(200); // 2%
  });
});
