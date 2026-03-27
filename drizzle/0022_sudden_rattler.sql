CREATE TABLE `campaign_daily_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`videoUrl` varchar(512) NOT NULL,
	`platform` enum('tiktok','youtube','instagram') NOT NULL,
	`dateKey` varchar(10) NOT NULL,
	`viewCount` bigint,
	`likeCount` bigint,
	`commentCount` bigint,
	`shareCount` bigint,
	`saveCount` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_daily_metrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_campaign_video_date` UNIQUE(`campaignId`,`videoUrl`,`dateKey`)
);
--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `platformSummary` json;