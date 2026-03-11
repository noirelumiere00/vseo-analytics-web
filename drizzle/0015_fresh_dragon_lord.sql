CREATE TABLE `trend_discovery_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`persona` varchar(255) NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`expandedKeywords` json,
	`expandedHashtags` json,
	`scrapedVideos` json,
	`crossAnalysis` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `trend_discovery_jobs_id` PRIMARY KEY(`id`)
);
