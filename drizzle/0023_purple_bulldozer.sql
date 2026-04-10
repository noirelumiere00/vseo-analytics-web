ALTER TABLE `analysis_reports` ADD `productionBrief` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `shareToken` varchar(64);--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `shareEnabled` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `trackingEnabled` boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `targetViews` bigint;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD CONSTRAINT `campaign_reports_shareToken_unique` UNIQUE(`shareToken`);