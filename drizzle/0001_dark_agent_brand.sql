CREATE TABLE `analysis_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`keyword` varchar(255),
	`manualUrls` json,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `analysis_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analysis_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoId` int NOT NULL,
	`thumbnailScore` int DEFAULT 0,
	`textScore` int DEFAULT 0,
	`audioScore` int DEFAULT 0,
	`durationScore` int DEFAULT 0,
	`overallScore` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analysis_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ocr_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoId` int NOT NULL,
	`frameTimestamp` int NOT NULL,
	`extractedText` text,
	`confidence` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ocr_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transcriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoId` int NOT NULL,
	`fullText` text NOT NULL,
	`segments` json,
	`language` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `transcriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`platform` enum('tiktok','youtube_shorts') NOT NULL,
	`videoUrl` varchar(512) NOT NULL,
	`videoId` varchar(128) NOT NULL,
	`title` text,
	`thumbnailUrl` varchar(512),
	`duration` int,
	`viewCount` bigint,
	`likeCount` bigint,
	`accountName` varchar(255),
	`duplicateCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `videos_id` PRIMARY KEY(`id`)
);
