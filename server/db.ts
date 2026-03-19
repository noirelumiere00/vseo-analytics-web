import { eq, desc, inArray, and, or, gte, sql, ne, isNull } from "drizzle-orm";
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
  subscriptions,
  passwordResetTokens,
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
  InsertSubscription,
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

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
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
      videoMetricsReport: data.videoMetricsReport,
      hashtagSovReport: data.hashtagSovReport,
      crossPlatformData: data.crossPlatformData,
      videoScores: data.videoScores,
      aiOverallReport: data.aiOverallReport,
    },
  });
}

// === User Lookup (email / Google ID) ===

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserByGoogleId(googleId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  return result[0] ?? undefined;
}

export async function createUser(data: {
  openId: string;
  name: string;
  email: string;
  passwordHash?: string;
  googleId?: string;
  emailVerified?: number;
  loginMethod: string;
  tosAcceptedAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(users).values({
    openId: data.openId,
    name: data.name,
    email: data.email,
    passwordHash: data.passwordHash ?? null,
    googleId: data.googleId ?? null,
    emailVerified: data.emailVerified ?? 0,
    loginMethod: data.loginMethod,
    tosAcceptedAt: data.tosAcceptedAt ?? null,
    lastSignedIn: new Date(),
  });
  return result[0].insertId;
}

export async function linkGoogleAccount(userId: number, googleId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ googleId, emailVerified: 1 }).where(eq(users.id, userId));
}

export async function setTosAccepted(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ tosAcceptedAt: new Date() }).where(eq(users.id, userId));
}

export async function setEmailVerified(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ emailVerified: 1 }).where(eq(users.id, userId));
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

// === Subscriptions ===

export async function getSubscriptionByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  return result[0] ?? undefined;
}

export async function upsertSubscription(data: InsertSubscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(subscriptions).values(data).onDuplicateKeyUpdate({
    set: {
      plan: data.plan,
      stripeCustomerId: data.stripeCustomerId,
      stripeSubscriptionId: data.stripeSubscriptionId,
      status: data.status,
      currentPeriodStart: data.currentPeriodStart,
      currentPeriodEnd: data.currentPeriodEnd,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd,
    },
  });
}

export async function getSubscriptionByStripeCustomerId(customerId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  return result[0] ?? undefined;
}

export async function getSubscriptionByStripeSubscriptionId(subId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)).limit(1);
  return result[0] ?? undefined;
}

export async function updateSubscriptionByStripeSubId(stripeSubId: string, data: Partial<InsertSubscription>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(subscriptions).set(data).where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
}

// === Password Reset Tokens ===

export async function createPasswordResetToken(userId: number, token: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(passwordResetTokens).values({ userId, token, expiresAt });
}

export async function consumePasswordResetToken(token: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Atomic: UPDATE ... SET usedAt=NOW() WHERE token=? AND usedAt IS NULL AND expiresAt > NOW()
  const result = await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(
      eq(passwordResetTokens.token, token),
      isNull(passwordResetTokens.usedAt),
      gte(passwordResetTokens.expiresAt, new Date()),
    ));
  if (result[0].affectedRows === 0) return null;
  // Return the token record to get userId
  const record = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token)).limit(1);
  return record[0] ?? null;
}

export async function invalidateUserResetTokens(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
}

// === Quota ===

export async function countMonthlyJobs(userId: number, since: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  // Count analysis_jobs (exclude pending)
  const [a] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(analysisJobs)
    .where(and(
      eq(analysisJobs.userId, userId),
      gte(analysisJobs.createdAt, since),
      ne(analysisJobs.status, "pending"),
    ));

  // Count trend_discovery_jobs (exclude pending)
  const [t] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(trendDiscoveryJobs)
    .where(and(
      eq(trendDiscoveryJobs.userId, userId),
      gte(trendDiscoveryJobs.createdAt, since),
      ne(trendDiscoveryJobs.status, "pending"),
    ));

  // Count campaign_snapshots (exclude pending)
  const [c] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(campaignSnapshots)
    .innerJoin(campaigns, eq(campaignSnapshots.campaignId, campaigns.id))
    .where(and(
      eq(campaigns.userId, userId),
      gte(campaignSnapshots.createdAt, since),
      ne(campaignSnapshots.status, "pending"),
    ));

  return (a?.count ?? 0) + (t?.count ?? 0) + (c?.count ?? 0);
}

// === Active Jobs (Dashboard) ===

export async function getActiveJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return { analysis: [], trend: [], campaign: [] };

  const [analysisRows, trendRows, snapshotRows] = await Promise.all([
    db.select({
      id: analysisJobs.id,
      keyword: analysisJobs.keyword,
      status: analysisJobs.status,
      progress: analysisJobs.progress,
      createdAt: analysisJobs.createdAt,
    }).from(analysisJobs).where(and(
      eq(analysisJobs.userId, userId),
      or(eq(analysisJobs.status, "processing"), eq(analysisJobs.status, "queued"))
    )),
    db.select({
      id: trendDiscoveryJobs.id,
      persona: trendDiscoveryJobs.persona,
      status: trendDiscoveryJobs.status,
      progress: trendDiscoveryJobs.progress,
      createdAt: trendDiscoveryJobs.createdAt,
    }).from(trendDiscoveryJobs).where(and(
      eq(trendDiscoveryJobs.userId, userId),
      or(eq(trendDiscoveryJobs.status, "processing"), eq(trendDiscoveryJobs.status, "queued"))
    )),
    db.select({
      id: campaignSnapshots.id,
      campaignId: campaignSnapshots.campaignId,
      snapshotType: campaignSnapshots.snapshotType,
      status: campaignSnapshots.status,
      progress: campaignSnapshots.progress,
      campaignName: campaigns.name,
    }).from(campaignSnapshots)
      .innerJoin(campaigns, eq(campaignSnapshots.campaignId, campaigns.id))
      .where(and(
        eq(campaigns.userId, userId),
        or(eq(campaignSnapshots.status, "processing"), eq(campaignSnapshots.status, "queued"))
      )),
  ]);

  return { analysis: analysisRows, trend: trendRows, campaign: snapshotRows };
}

// === User Insights (ユーザー別集計, 5分キャッシュ) ===

const _userInsightsCache = new Map<number, { data: any; expiresAt: number }>();

export async function getPlatformInsights(userId: number) {
  const cached = _userInsightsCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const db = await getDb();
  if (!db) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [recentVideos, completedAnalysisCount, completedTrendCount, totalVideoCount, recentReports] = await Promise.all([
    db.select({
      hashtags: videos.hashtags,
      postedAt: videos.postedAt,
      duration: videos.duration,
      sentiment: videos.sentiment,
      viewCount: videos.viewCount,
      likeCount: videos.likeCount,
      commentCount: videos.commentCount,
      shareCount: videos.shareCount,
      accountName: videos.accountName,
      accountId: videos.accountId,
      followerCount: videos.followerCount,
      keyHook: videos.keyHook,
      isAd: videos.isAd,
    }).from(videos)
      .innerJoin(analysisJobs, eq(videos.jobId, analysisJobs.id))
      .where(and(eq(analysisJobs.userId, userId), gte(videos.createdAt, thirtyDaysAgo))),

    db.select({ count: sql<number>`COUNT(*)` }).from(analysisJobs).where(and(eq(analysisJobs.userId, userId), eq(analysisJobs.status, "completed"))),
    db.select({ count: sql<number>`COUNT(*)` }).from(trendDiscoveryJobs).where(and(eq(trendDiscoveryJobs.userId, userId), eq(trendDiscoveryJobs.status, "completed"))),
    db.select({ count: sql<number>`COUNT(*)` }).from(videos).innerJoin(analysisJobs, eq(videos.jobId, analysisJobs.id)).where(eq(analysisJobs.userId, userId)),

    // ハッシュタグコンビネーション + 感情ワード集計用
    db.select({
      hashtagStrategy: analysisReports.hashtagStrategy,
      emotionWords: analysisReports.emotionWords,
    }).from(analysisReports)
      .innerJoin(analysisJobs, eq(analysisReports.jobId, analysisJobs.id))
      .where(and(eq(analysisJobs.userId, userId), gte(analysisJobs.createdAt, thirtyDaysAgo)))
      .orderBy(desc(analysisJobs.createdAt))
      .limit(10),
  ]);

  // --- ハッシュタグ集計 (with ER) TOP10 ---
  const hashtagStats = new Map<string, { count: number; views: number; engagement: number }>();
  let totalViews = 0;
  let totalEngagement = 0;

  for (const v of recentVideos) {
    const views = Number(v.viewCount ?? 0);
    const eng = Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    totalViews += views;
    totalEngagement += eng;

    const tags = v.hashtags as string[] | null;
    if (tags) {
      for (const tag of tags) {
        const normalized = tag.toLowerCase().replace(/^#/, "");
        if (!normalized) continue;
        // 広告・汎用タグを除外
        const HASHTAG_BLACKLIST = new Set([
          "fyp", "foryou", "foryoupage", "viral", "trending", "trend",
          "おすすめ", "おすすめにのりたい", "バズりたい", "バズれ",
          "tiktok", "tiktoker", "tiktokjapan",
          "fy", "fypシ", "fypage", "fypdongggggggg",
          "xyzbca", "xyz", "xyzabc",
          "pr", "ad", "広告", "プロモーション", "sponsored",
          "タイアップ", "提供", "案件",
        ]);
        if (HASHTAG_BLACKLIST.has(normalized)) continue;
        const existing = hashtagStats.get(normalized) || { count: 0, views: 0, engagement: 0 };
        existing.count++;
        existing.views += views;
        existing.engagement += eng;
        hashtagStats.set(normalized, existing);
      }
    }
  }
  const topHashtags = Array.from(hashtagStats.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([tag, stats]) => ({
      tag,
      count: stats.count,
      avgER: stats.views > 0 ? Math.round((stats.engagement / stats.views) * 10000) / 100 : 0,
    }));

  // --- ハッシュタグコンビネーション ---
  // 注意: analysis_reports.hashtagStrategy.topCombinations の avgER は実際は平均再生数
  const COMBO_BLACKLIST = new Set([
    "fyp", "foryou", "foryoupage", "viral", "trending", "trend",
    "おすすめ", "おすすめにのりたい", "バズりたい", "バズれ",
    "tiktok", "tiktoker", "tiktokjapan",
    "fy", "fypシ", "fypage", "fypdongggggggg",
    "xyzbca", "xyz", "xyzabc",
    "pr", "ad", "広告", "プロモーション", "sponsored",
    "タイアップ", "提供", "案件",
  ]);
  const combinationMap = new Map<string, { tags: string[]; count: number; totalViews: number; n: number }>();
  for (const r of recentReports) {
    const strategy = r.hashtagStrategy as any;
    if (!strategy?.topCombinations) continue;
    for (const combo of strategy.topCombinations) {
      // ブラックリストタグを含むコンビネーションを除外
      const hasBlacklisted = combo.tags.some((t: string) => COMBO_BLACKLIST.has(t.toLowerCase()));
      if (hasBlacklisted) continue;
      const key = [...combo.tags].sort().join("+");
      const existing = combinationMap.get(key) || { tags: combo.tags, count: 0, totalViews: 0, n: 0 };
      existing.count += combo.count;
      existing.totalViews += combo.avgER; // avgER は実際は平均再生数
      existing.n++;
      combinationMap.set(key, existing);
    }
  }
  const topHashtagCombinations = Array.from(combinationMap.values())
    .map(c => ({ tags: c.tags, count: c.count, avgViews: c.n > 0 ? Math.round(c.totalViews / c.n) : 0 }))
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 3);

  // --- センチメント分析 (with ER) ---
  const sentimentStats: Record<string, { count: number; views: number; engagement: number }> = {
    positive: { count: 0, views: 0, engagement: 0 },
    neutral: { count: 0, views: 0, engagement: 0 },
    negative: { count: 0, views: 0, engagement: 0 },
  };
  for (const v of recentVideos) {
    const key = v.sentiment || "neutral";
    const views = Number(v.viewCount ?? 0);
    const eng = Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    if (sentimentStats[key]) {
      sentimentStats[key].count++;
      sentimentStats[key].views += views;
      sentimentStats[key].engagement += eng;
    }
  }
  const sentimentAnalysis = Object.entries(sentimentStats).map(([sentiment, stats]) => ({
    sentiment,
    count: stats.count,
    avgER: stats.views > 0 ? Math.round((stats.engagement / stats.views) * 10000) / 100 : 0,
  }));

  // --- 動画長別パフォーマンス ---
  const durationBuckets: Record<string, { views: number; engagement: number; count: number }> = {
    "~15秒": { views: 0, engagement: 0, count: 0 },
    "16~30秒": { views: 0, engagement: 0, count: 0 },
    "31~60秒": { views: 0, engagement: 0, count: 0 },
    "60秒超": { views: 0, engagement: 0, count: 0 },
  };
  for (const v of recentVideos) {
    const dur = v.duration ?? 0;
    const bucket = dur <= 15 ? "~15秒" : dur <= 30 ? "16~30秒" : dur <= 60 ? "31~60秒" : "60秒超";
    const views = Number(v.viewCount ?? 0);
    const eng = Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    durationBuckets[bucket].views += views;
    durationBuckets[bucket].engagement += eng;
    durationBuckets[bucket].count++;
  }
  const durationPerformance = Object.entries(durationBuckets)
    .map(([label, d]) => ({
      label,
      avgViews: d.count > 0 ? Math.round(d.views / d.count) : 0,
      avgER: d.count > 0 && d.views > 0 ? Math.round((d.engagement / d.views) * 10000) / 100 : 0,
      count: d.count,
    }))
    .filter(d => d.count > 0);

  // --- 投稿時間帯ヒートマップ (7曜日 × 4時間帯) ---
  const timeBands = [
    { label: "朝", start: 6, end: 11 },
    { label: "昼", start: 11, end: 15 },
    { label: "夕", start: 15, end: 19 },
    { label: "夜", start: 19, end: 24 },
  ];
  const dayOrder = ["月", "火", "水", "木", "金", "土", "日"];
  const heatmap: Record<string, Record<string, { views: number; engagement: number; count: number }>> = {};
  for (const band of timeBands) {
    heatmap[band.label] = {};
    for (const day of dayOrder) {
      heatmap[band.label][day] = { views: 0, engagement: 0, count: 0 };
    }
  }
  let bestHeatmapSlot = { day: "", band: "", er: 0 };
  for (const v of recentVideos) {
    if (!v.postedAt) continue;
    const dt = new Date(v.postedAt);
    const dayIdx = (dt.getDay() + 6) % 7; // Monday=0
    const dayName = dayOrder[dayIdx];
    const hour = dt.getHours();
    const band = timeBands.find(b => hour >= b.start && hour < b.end) || timeBands[3]; // default to 夜
    const views = Number(v.viewCount ?? 0);
    const eng = Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    heatmap[band.label][dayName].views += views;
    heatmap[band.label][dayName].engagement += eng;
    heatmap[band.label][dayName].count++;
  }
  // Compute ER for each cell and find best
  const postingHeatmap: Record<string, Record<string, { er: number; count: number }>> = {};
  for (const band of timeBands) {
    postingHeatmap[band.label] = {};
    for (const day of dayOrder) {
      const cell = heatmap[band.label][day];
      const er = cell.views > 0 ? Math.round((cell.engagement / cell.views) * 10000) / 100 : 0;
      postingHeatmap[band.label][day] = { er, count: cell.count };
      if (er > bestHeatmapSlot.er && cell.count >= 2) {
        bestHeatmapSlot = { day, band: band.label, er };
      }
    }
  }

  // --- トップクリエイター ---
  const creatorStats = new Map<string, {
    accountName: string;
    followerCount: number;
    videoCount: number;
    totalPlays: number;
    totalEngagement: number;
  }>();
  for (const v of recentVideos) {
    const key = v.accountId || v.accountName || "";
    if (!key) continue;
    const existing = creatorStats.get(key) || {
      accountName: v.accountName || key,
      followerCount: Number(v.followerCount ?? 0),
      videoCount: 0,
      totalPlays: 0,
      totalEngagement: 0,
    };
    existing.videoCount++;
    existing.totalPlays += Number(v.viewCount ?? 0);
    existing.totalEngagement += Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    existing.followerCount = Math.max(existing.followerCount, Number(v.followerCount ?? 0));
    creatorStats.set(key, existing);
  }
  const topCreators = Array.from(creatorStats.values())
    .filter(c => c.videoCount >= 2)
    .sort((a, b) => b.totalPlays - a.totalPlays)
    .slice(0, 5)
    .map(c => ({
      accountName: c.accountName,
      followerCount: c.followerCount,
      videoCount: c.videoCount,
      totalPlays: c.totalPlays,
      avgER: c.totalPlays > 0 ? Math.round((c.totalEngagement / c.totalPlays) * 10000) / 100 : 0,
    }));

  const overallAvgER = totalViews > 0 ? Math.round((totalEngagement / totalViews) * 10000) / 100 : 0;

  // --- キーフック分析 ---
  const hookStats = new Map<string, { count: number; views: number; engagement: number; example: string }>();
  for (const v of recentVideos) {
    const hook = ((v as any).keyHook || "").trim();
    if (!hook || hook.length < 4) continue;
    const views = Number(v.viewCount ?? 0);
    const eng = Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    const existing = hookStats.get(hook) || { count: 0, views: 0, engagement: 0, example: hook };
    existing.count++;
    existing.views += views;
    existing.engagement += eng;
    hookStats.set(hook, existing);
  }
  const topHooks = Array.from(hookStats.values())
    .filter(h => h.count >= 2)
    .sort((a, b) => {
      const erA = a.views > 0 ? a.engagement / a.views : 0;
      const erB = b.views > 0 ? b.engagement / b.views : 0;
      return erB - erA;
    })
    .slice(0, 5)
    .map(h => ({
      hook: h.example,
      count: h.count,
      avgViews: Math.round(h.views / h.count),
      avgER: h.views > 0 ? Math.round((h.engagement / h.views) * 10000) / 100 : 0,
    }));

  // --- 広告 vs オーガニック ---
  const adOrganic = { ad: { count: 0, views: 0, engagement: 0 }, organic: { count: 0, views: 0, engagement: 0 } };
  for (const v of recentVideos) {
    const bucket = (v as any).isAd === 1 ? "ad" : "organic";
    const views = Number(v.viewCount ?? 0);
    const eng = Number(v.likeCount ?? 0) + Number(v.commentCount ?? 0) + Number(v.shareCount ?? 0);
    adOrganic[bucket].count++;
    adOrganic[bucket].views += views;
    adOrganic[bucket].engagement += eng;
  }
  const adVsOrganic = {
    ad: {
      count: adOrganic.ad.count,
      avgViews: adOrganic.ad.count > 0 ? Math.round(adOrganic.ad.views / adOrganic.ad.count) : 0,
      avgER: adOrganic.ad.views > 0 ? Math.round((adOrganic.ad.engagement / adOrganic.ad.views) * 10000) / 100 : 0,
    },
    organic: {
      count: adOrganic.organic.count,
      avgViews: adOrganic.organic.count > 0 ? Math.round(adOrganic.organic.views / adOrganic.organic.count) : 0,
      avgER: adOrganic.organic.views > 0 ? Math.round((adOrganic.organic.engagement / adOrganic.organic.views) * 10000) / 100 : 0,
    },
  };

  // --- 感情ワードマップ ---
  const emotionWordMap = new Map<string, { word: string; totalCount: number; valence: number; arousal: number; n: number }>();
  for (const r of recentReports) {
    const words = (r as any).emotionWords as Array<{ word: string; count: number; valence: number; arousal: number }> | null;
    if (!words) continue;
    for (const w of words) {
      const existing = emotionWordMap.get(w.word) || { word: w.word, totalCount: 0, valence: 0, arousal: 0, n: 0 };
      existing.totalCount += w.count;
      existing.valence += w.valence;
      existing.arousal += w.arousal;
      existing.n++;
      emotionWordMap.set(w.word, existing);
    }
  }
  const emotionLandscape = Array.from(emotionWordMap.values())
    .map(e => ({
      word: e.word,
      count: e.totalCount,
      valence: e.n > 0 ? Math.round((e.valence / e.n) * 100) / 100 : 0,
      arousal: e.n > 0 ? Math.round((e.arousal / e.n) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const emotionQuadrants = {
    highEnergyPositive: emotionLandscape.filter(w => w.valence > 0 && w.arousal > 0),
    calmPositive: emotionLandscape.filter(w => w.valence > 0 && w.arousal <= 0),
    highEnergyNegative: emotionLandscape.filter(w => w.valence <= 0 && w.arousal > 0),
    calmNegative: emotionLandscape.filter(w => w.valence <= 0 && w.arousal <= 0),
  };

  const result = {
    topHashtags,
    topHashtagCombinations,
    sentimentAnalysis,
    durationPerformance,
    postingHeatmap,
    bestHeatmapSlot,
    topCreators,
    overallAvgER,
    topHooks,
    adVsOrganic,
    emotionLandscape,
    emotionQuadrants,
    stats: {
      completedAnalyses: completedAnalysisCount[0]?.count ?? 0,
      completedTrends: completedTrendCount[0]?.count ?? 0,
      totalVideos: totalVideoCount[0]?.count ?? 0,
    },
  };

  _userInsightsCache.set(userId, { data: result, expiresAt: Date.now() + 5 * 60 * 1000 });
  return result;
}

// === Admin: Users with subscriptions ===

export async function getAllUsersWithSubscriptions() {
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
    plan: subscriptions.plan,
    subscriptionStatus: subscriptions.status,
  }).from(users)
    .leftJoin(subscriptions, eq(users.id, subscriptions.userId))
    .orderBy(desc(users.createdAt));
}
