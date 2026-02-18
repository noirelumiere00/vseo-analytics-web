import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, 
  users, 
  analysisJobs,
  videos,
  ocrResults,
  transcriptions,
  analysisScores,
  InsertAnalysisJob,
  InsertVideo,
  InsertOcrResult,
  InsertTranscription,
  InsertAnalysisScore
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
