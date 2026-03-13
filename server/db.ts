import { eq, desc, inArray, and, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  analysisJobs,
  videos,
  ocrResults,
  transcriptions,
  analysisScores,
  analysisReports,
  tripleSearchResults,
  trendDiscoveryJobs,
  campaigns,
  campaignSnapshots,
  campaignReports,
  InsertAnalysisJob,
  InsertVideo,
  InsertOcrResult,
  InsertTranscription,
  InsertAnalysisScore,
  InsertAnalysisReport,
  InsertTripleSearchResult,
  InsertTrendDiscoveryJob,
  InsertCampaign,
  InsertCampaignSnapshot,
  InsertCampaignReport,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "passwordHash"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByName(name: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(users).where(eq(users.name, name)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];

  return db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    role: users.role,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(desc(users.createdAt));
}

export async function deleteUserById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(users).where(eq(users.id, id));
}

export async function updateUserRole(id: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(users).set({ role }).where(eq(users.id, id));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// === Analysis Jobs ===
export async function createAnalysisJob(job: InsertAnalysisJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(analysisJobs).values(job);
  return result[0].insertId;
}

export async function getAnalysisJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get analysis jobs: database not available");
    return [];
  }
  
  try {
    console.log(`[Database] Fetching analysis jobs for userId: ${userId}`);
    const result = await db.select().from(analysisJobs).where(eq(analysisJobs.userId, userId)).orderBy(desc(analysisJobs.createdAt));
    console.log(`[Database] Found ${result.length} jobs for userId: ${userId}`);
    return result;
  } catch (error) {
    console.error("[Database] Error fetching analysis jobs:", error);
    return [];
  }
}

export async function getProcessingJobByUserId(userId: number) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [result] = await db.select().from(analysisJobs)
      .where(and(
        eq(analysisJobs.userId, userId),
        or(eq(analysisJobs.status, "processing"), eq(analysisJobs.status, "queued"))
      ))
      .limit(1);
    return result ?? null;
  } catch (error) {
    console.error("[Database] Error checking processing job:", error);
    return null;
  }
}

export async function getAnalysisJobById(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateAnalysisJobStatus(jobId: number, status: "pending" | "queued" | "processing" | "completed" | "failed", completedAt?: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(analysisJobs).set({ status, completedAt }).where(eq(analysisJobs.id, jobId));
}

// === Videos ===
export async function createVideo(video: InsertVideo) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(videos).values(video);
  return result[0].insertId;
}

export async function getVideosByJobId(jobId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(videos).where(eq(videos.jobId, jobId)).orderBy(desc(videos.duplicateCount));
}

export async function updateVideoDuplicateCount(videoId: number, count: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(videos).set({ duplicateCount: count }).where(eq(videos.id, videoId));
}

export async function updateVideo(videoId: number, data: Partial<InsertVideo>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(videos).set(data).where(eq(videos.id, videoId));
}

// === OCR Results ===
export async function createOcrResult(ocr: InsertOcrResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(ocrResults).values(ocr);
}

export async function getOcrResultsByVideoId(videoId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(ocrResults).where(eq(ocrResults.videoId, videoId));
}

// === Transcriptions ===
export async function createTranscription(transcription: InsertTranscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(transcriptions).values(transcription);
}

export async function getTranscriptionByVideoId(videoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(transcriptions).where(eq(transcriptions.videoId, videoId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getTranscriptionsByVideoId(videoId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(transcriptions).where(eq(transcriptions.videoId, videoId));
}

// === Analysis Scores ===
export async function createAnalysisScore(score: InsertAnalysisScore) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(analysisScores).values(score);
}

export async function getAnalysisScoreByVideoId(videoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(analysisScores).where(eq(analysisScores.videoId, videoId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// === Analysis Reports ===
export async function createAnalysisReport(report: InsertAnalysisReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(analysisReports).values(report);
  return result[0].insertId;
}

export async function deleteAnalysisReportByJobId(jobId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(analysisReports).where(eq(analysisReports.jobId, jobId));
}

export async function getAnalysisReportByJobId(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(analysisReports).where(eq(analysisReports.jobId, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateAnalysisReport(jobId: number, report: Partial<InsertAnalysisReport>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(analysisReports).set(report).where(eq(analysisReports.jobId, jobId));
}

// === Triple Search Results ===
export async function saveTripleSearchResult(data: InsertTripleSearchResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Upsert: if exists for this jobId, update; otherwise insert
  await db.insert(tripleSearchResults).values(data).onDuplicateKeyUpdate({
    set: {
      searchData: data.searchData,
      appearedInAll3Ids: data.appearedInAll3Ids,
      appearedIn2Ids: data.appearedIn2Ids,
      appearedIn1OnlyIds: data.appearedIn1OnlyIds,
      overlapRate: data.overlapRate,
      commonalityAnalysis: data.commonalityAnalysis,
    },
  });
}

export async function updateTripleSearchCommonality(jobId: number, commonalityAnalysis: InsertTripleSearchResult['commonalityAnalysis']) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(tripleSearchResults)
    .set({ commonalityAnalysis })
    .where(eq(tripleSearchResults.jobId, jobId));
}

export async function updateTripleSearchLosePattern(jobId: number, losePatternAnalysis: InsertTripleSearchResult['losePatternAnalysis']) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(tripleSearchResults)
    .set({ losePatternAnalysis })
    .where(eq(tripleSearchResults.jobId, jobId));
}

export async function updateTripleSearchCommonalityAd(jobId: number, commonalityAnalysisAd: InsertTripleSearchResult['commonalityAnalysisAd']) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(tripleSearchResults)
    .set({ commonalityAnalysisAd })
    .where(eq(tripleSearchResults.jobId, jobId));
}

export async function updateTripleSearchLosePatternAd(jobId: number, losePatternAnalysisAd: InsertTripleSearchResult['losePatternAnalysisAd']) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(tripleSearchResults)
    .set({ losePatternAnalysisAd })
    .where(eq(tripleSearchResults.jobId, jobId));
}

export async function getTripleSearchResultByJobId(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(tripleSearchResults).where(eq(tripleSearchResults.jobId, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// === Stuck Job Recovery ===
/**
 * サーバー起動時にprocessing状態のジョブをfailedにリセット
 * （サーバー再起動やクラッシュで中断されたジョブの回復）
 */
export async function resetStuckProcessingJobs() {
  const db = await getDb();
  if (!db) return 0;

  const result1 = await db.update(analysisJobs)
    .set({ status: "queued" })
    .where(eq(analysisJobs.status, "processing"));

  const result2 = await db.update(trendDiscoveryJobs)
    .set({ status: "queued" })
    .where(eq(trendDiscoveryJobs.status, "processing"));

  const result3 = await db.update(campaignSnapshots)
    .set({ status: "queued" })
    .where(eq(campaignSnapshots.status, "processing"));

  return (result1[0].affectedRows ?? 0) + (result2[0].affectedRows ?? 0) + (result3[0].affectedRows ?? 0);
}

// === Worker Queue Helpers ===

export async function getQueuedAnalysisJobs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(analysisJobs).where(eq(analysisJobs.status, "queued")).orderBy(analysisJobs.id);
}

export async function getQueuedTrendDiscoveryJobs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trendDiscoveryJobs).where(eq(trendDiscoveryJobs.status, "queued")).orderBy(trendDiscoveryJobs.id);
}

export async function getQueuedCampaignSnapshots() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaignSnapshots).where(eq(campaignSnapshots.status, "queued")).orderBy(campaignSnapshots.id);
}

export async function updateJobProgress(table: "analysis" | "trend" | "campaign", id: number, progress: Record<string, unknown>) {
  const db = await getDb();
  if (!db) return;

  if (table === "analysis") {
    await db.update(analysisJobs).set({ progress: progress as any }).where(eq(analysisJobs.id, id));
  } else if (table === "trend") {
    await db.update(trendDiscoveryJobs).set({ progress: progress as any }).where(eq(trendDiscoveryJobs.id, id));
  } else if (table === "campaign") {
    await db.update(campaignSnapshots).set({ progress: progress as any }).where(eq(campaignSnapshots.id, id));
  }
}

export async function setCancelRequested(jobId: number, value: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(analysisJobs).set({ cancelRequested: value }).where(eq(analysisJobs.id, jobId));
}

export async function getCancelRequested(jobId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db.select({ cancelRequested: analysisJobs.cancelRequested }).from(analysisJobs).where(eq(analysisJobs.id, jobId)).limit(1);
  return (row?.cancelRequested ?? 0) === 1;
}

// === Trend Discovery Jobs ===
export async function createTrendDiscoveryJob(job: InsertTrendDiscoveryJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(trendDiscoveryJobs).values(job);
  return result[0].insertId;
}

export async function getTrendDiscoveryJobById(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(trendDiscoveryJobs).where(eq(trendDiscoveryJobs.id, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getTrendDiscoveryJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  // scrapedVideos は一覧では不要かつ巨大（各700KB超）なので除外
  // 全カラム SELECT + ORDER BY でMySQL sort_buffer_size を超過しエラーになる
  return db.select({
    id: trendDiscoveryJobs.id,
    userId: trendDiscoveryJobs.userId,
    persona: trendDiscoveryJobs.persona,
    status: trendDiscoveryJobs.status,
    expandedKeywords: trendDiscoveryJobs.expandedKeywords,
    expandedHashtags: trendDiscoveryJobs.expandedHashtags,
    crossAnalysis: trendDiscoveryJobs.crossAnalysis,
    createdAt: trendDiscoveryJobs.createdAt,
    completedAt: trendDiscoveryJobs.completedAt,
  }).from(trendDiscoveryJobs).where(eq(trendDiscoveryJobs.userId, userId)).orderBy(desc(trendDiscoveryJobs.createdAt));
}

export async function updateTrendDiscoveryJob(jobId: number, data: Partial<InsertTrendDiscoveryJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(trendDiscoveryJobs).set(data).where(eq(trendDiscoveryJobs.id, jobId));
}

export async function updateTrendDiscoveryJobStatus(jobId: number, status: "pending" | "queued" | "processing" | "completed" | "failed", completedAt?: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(trendDiscoveryJobs).set({ status, completedAt }).where(eq(trendDiscoveryJobs.id, jobId));
}

export async function deleteTrendDiscoveryJob(jobId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(trendDiscoveryJobs).where(eq(trendDiscoveryJobs.id, jobId));
}

/**
 * ジョブの動画関連データをクリア（再実行時に古いデータを削除）
 */
export async function clearJobVideoData(jobId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const jobVideos = await db.select({ id: videos.id }).from(videos).where(eq(videos.jobId, jobId));
  const videoIds = jobVideos.map(v => v.id);

  if (videoIds.length > 0) {
    await db.delete(ocrResults).where(inArray(ocrResults.videoId, videoIds));
    await db.delete(transcriptions).where(inArray(transcriptions.videoId, videoIds));
    await db.delete(analysisScores).where(inArray(analysisScores.videoId, videoIds));
  }
  await db.delete(videos).where(eq(videos.jobId, jobId));
  await db.delete(analysisReports).where(eq(analysisReports.jobId, jobId));

  console.log(`[Database] Cleared ${videoIds.length} videos and related data for job ${jobId}`);
}

/**
 * 分析ジョブを削除（関連データも含む）
 */
export async function deleteAnalysisJob(jobId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 関連する動画IDを取得
  const jobVideos = await db.select({ id: videos.id }).from(videos).where(eq(videos.jobId, jobId));
  const videoIds = jobVideos.map(v => v.id);

  // 関連データを削除
  if (videoIds.length > 0) {
    await db.delete(ocrResults).where(inArray(ocrResults.videoId, videoIds));
    await db.delete(transcriptions).where(inArray(transcriptions.videoId, videoIds));
    await db.delete(analysisScores).where(inArray(analysisScores.videoId, videoIds));
  }
  await db.delete(videos).where(eq(videos.jobId, jobId));
  await db.delete(analysisReports).where(eq(analysisReports.jobId, jobId));
  await db.delete(tripleSearchResults).where(eq(tripleSearchResults.jobId, jobId));
  await db.delete(analysisJobs).where(eq(analysisJobs.id, jobId));
}

// === Campaigns ===

export async function createCampaign(data: InsertCampaign) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(campaigns).values(data);
  return result[0].insertId;
}

export async function getCampaignsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaigns).where(eq(campaigns.userId, userId)).orderBy(desc(campaigns.createdAt));
}

export async function getCampaignById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function updateCampaign(id: number, data: Partial<InsertCampaign>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(campaigns).set(data).where(eq(campaigns.id, id));
}

export async function deleteCampaign(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(campaignReports).where(eq(campaignReports.campaignId, id));
  await db.delete(campaignSnapshots).where(eq(campaignSnapshots.campaignId, id));
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

// === Campaign Snapshots ===

export async function createCampaignSnapshot(data: InsertCampaignSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(campaignSnapshots).values(data);
  return result[0].insertId;
}

export async function getCampaignSnapshotById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(campaignSnapshots).where(eq(campaignSnapshots.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function getCampaignSnapshotsByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(campaignSnapshots).where(eq(campaignSnapshots.campaignId, campaignId)).orderBy(desc(campaignSnapshots.createdAt));
}

export async function updateCampaignSnapshot(id: number, data: Partial<InsertCampaignSnapshot>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(campaignSnapshots).set(data).where(eq(campaignSnapshots.id, id));
}

// === Campaign Reports ===

export async function createCampaignReport(data: InsertCampaignReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(campaignReports).values(data);
  return result[0].insertId;
}

export async function getCampaignReportByCampaignId(campaignId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(campaignReports).where(eq(campaignReports.campaignId, campaignId)).limit(1);
  return result[0] ?? undefined;
}

export async function upsertCampaignReport(data: InsertCampaignReport) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(campaignReports).values(data).onDuplicateKeyUpdate({
    set: {
      baselineDate: data.baselineDate,
      measurementDate: data.measurementDate,
      summary: data.summary,
      positionReport: data.positionReport,
      competitorReport: data.competitorReport,
      sovReport: data.sovReport,
      competitorFrequencyReport: data.competitorFrequencyReport,
      rippleReport: data.rippleReport,
      screenshots: data.screenshots,
      notes: data.notes,
    },
  });
}
