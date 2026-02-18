CREATE TABLE `analysis_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`totalVideos` int DEFAULT 0,
	`totalViews` bigint DEFAULT 0,
	`totalEngagement` bigint DEFAULT 0,
	`neutralCount` int DEFAULT 0,
	`neutralPercentage` int DEFAULT 0,
	`positiveCount` int DEFAULT 0,
	`positivePercentage` int DEFAULT 0,
	`negativeCount` int DEFAULT 0,
	`negativePercentage` int DEFAULT 0,
	`posNegPositiveCount` int DEFAULT 0,
	`posNegPositivePercentage` int DEFAULT 0,
	`posNegNegativeCount` int DEFAULT 0,
	`posNegNegativePercentage` int DEFAULT 0,
	`positiveViewsShare` int DEFAULT 0,
	`negativeViewsShare` int DEFAULT 0,
	`positiveEngagementShare` int DEFAULT 0,
	`negativeEngagementShare` int DEFAULT 0,
	`positiveWords` json,
	`negativeWords` json,
	`keyInsights` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analysis_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `analysis_reports_jobId_unique` UNIQUE(`jobId`)
);
--> statement-breakpoint
ALTER TABLE `videos` ADD `description` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `commentCount` bigint;--> statement-breakpoint
ALTER TABLE `videos` ADD `shareCount` bigint;--> statement-breakpoint
ALTER TABLE `videos` ADD `saveCount` bigint;--> statement-breakpoint
ALTER TABLE `videos` ADD `accountId` varchar(128);--> statement-breakpoint
ALTER TABLE `videos` ADD `followerCount` bigint;--> statement-breakpoint
ALTER TABLE `videos` ADD `accountAvatarUrl` varchar(512);--> statement-breakpoint
ALTER TABLE `videos` ADD `sentiment` enum('positive','neutral','negative');--> statement-breakpoint
ALTER TABLE `videos` ADD `keyHook` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `keywords` json;--> statement-breakpoint
ALTER TABLE `videos` ADD `hashtags` json;--> statement-breakpoint
ALTER TABLE `videos` ADD `postedAt` timestamp;