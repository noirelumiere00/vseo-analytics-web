-- Google Ads Keyword Planner キャッシュ列追加
ALTER TABLE `analysis_reports` ADD COLUMN `googleAdsKeywordCache` json DEFAULT NULL;
