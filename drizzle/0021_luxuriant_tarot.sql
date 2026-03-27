ALTER TABLE `analysis_reports` ADD `googleAdsKeywordCache` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `videoMetricsReport` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `hashtagSovReport` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `crossPlatformData` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `videoScores` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `aiOverallReport` json;--> statement-breakpoint
ALTER TABLE `campaign_reports` ADD `bigKeywordReport` json;--> statement-breakpoint
ALTER TABLE `campaign_snapshots` ADD `ownVideoMetrics` json;--> statement-breakpoint
ALTER TABLE `campaign_snapshots` ADD `hashtagAnalysis` json;--> statement-breakpoint
ALTER TABLE `campaign_snapshots` ADD `detectedCompetitors` json;--> statement-breakpoint
ALTER TABLE `campaign_snapshots` ADD `bigKeywordResults` json;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `satelliteAccountIds` json;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `ownVideoUrls` json;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `ownVideoData` json;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `bigKeywords` json;