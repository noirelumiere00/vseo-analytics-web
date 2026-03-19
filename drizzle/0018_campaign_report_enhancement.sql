-- 施策効果レポート強化: 全Phase分のカラム追加
-- 全て nullable JSON カラムのため後方互換性あり

-- campaigns テーブル
ALTER TABLE `campaigns` ADD COLUMN `ownVideoUrls` json DEFAULT NULL;
ALTER TABLE `campaigns` ADD COLUMN `ownVideoData` json DEFAULT NULL;

-- campaign_snapshots テーブル
ALTER TABLE `campaign_snapshots` ADD COLUMN `ownVideoMetrics` json DEFAULT NULL;
ALTER TABLE `campaign_snapshots` ADD COLUMN `hashtagAnalysis` json DEFAULT NULL;
ALTER TABLE `campaign_snapshots` ADD COLUMN `detectedCompetitors` json DEFAULT NULL;

-- campaign_reports テーブル
ALTER TABLE `campaign_reports` ADD COLUMN `videoMetricsReport` json DEFAULT NULL;
ALTER TABLE `campaign_reports` ADD COLUMN `hashtagSovReport` json DEFAULT NULL;
ALTER TABLE `campaign_reports` ADD COLUMN `crossPlatformData` json DEFAULT NULL;
ALTER TABLE `campaign_reports` ADD COLUMN `videoScores` json DEFAULT NULL;
ALTER TABLE `campaign_reports` ADD COLUMN `aiOverallReport` json DEFAULT NULL;
