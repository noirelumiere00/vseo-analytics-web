import { eq, desc, inArray } from "drizzle-orm";
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
  InsertAnalysisJob,
  InsertVideo,
  InsertOcrResult,
  InsertTranscription,
  InsertAnalysisScore,
  InsertAnalysisReport,
  InsertTripleSearchResult
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

    const textFields = ["name", "email", "loginMethod"] as const;
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
  if (!db) return [];
  
  return db.select().from(analysisJobs).where(eq(analysisJobs.userId, userId)).orderBy(desc(analysisJobs.createdAt));
}

export async function getAnalysisJobById(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(analysisJobs).where(eq(analysisJobs.id, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateAnalysisJobStatus(jobId: number, status: "pending" | "processing" | "completed" | "failed", completedAt?: Date) {
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

export async function getAnalysisReportByJobId(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(analysisReports).where(eq(analysisReports.jobId, jobId)).limit(1);
  return result[0];
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
  
  const result = await db.update(analysisJobs)
    .set({ status: "failed" })
    .where(eq(analysisJobs.status, "processing"));
  
  return result[0].affectedRows ?? 0;
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
