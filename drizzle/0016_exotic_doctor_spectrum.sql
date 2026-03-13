CREATE TABLE `campaign_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`baselineDate` timestamp,
	`measurementDate` timestamp,
	`summary` json,
	`positionReport` json,
	`competitorReport` json,
	`sovReport` json,
	`competitorFrequencyReport` json,
	`rippleReport` json,
	`screenshots` json,
	`notes` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaign_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_reports_campaignId_unique` UNIQUE(`campaignId`)
);
--> statement-breakpoint
CREATE TABLE `campaign_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`snapshotType` enum('baseline','measurement') NOT NULL,
	`status` enum('pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`progress` json,
	`searchResults` json,
	`competitorProfiles` json,
	`rippleEffect` json,
	`capturedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `campaign_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`clientName` varchar(255),
	`keywords` json NOT NULL,
	`ownAccountIds` json NOT NULL,
	`ownVideoIds` json,
	`campaignHashtags` json,
	`competitors` json,
	`brandKeywords` json,
	`baselineSnapshotId` int,
	`measurementSnapshotId` int,
	`status` enum('draft','baseline_captured','measurement_captured','report_ready') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `analysis_jobs` MODIFY COLUMN `status` enum('pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `trend_discovery_jobs` MODIFY COLUMN `status` enum('pending','queued','processing','completed','failed') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `queuedAction` varchar(32);--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `progress` json;--> statement-breakpoint
ALTER TABLE `analysis_jobs` ADD `cancelRequested` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `trend_discovery_jobs` ADD `queuedAction` varchar(32);--> statement-breakpoint
ALTER TABLE `trend_discovery_jobs` ADD `progress` json;