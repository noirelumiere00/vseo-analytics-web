-- ビッグキーワード機能追加: カテゴリ全体での露出計測
ALTER TABLE `campaigns` ADD COLUMN `bigKeywords` json DEFAULT NULL;
ALTER TABLE `campaign_snapshots` ADD COLUMN `bigKeywordResults` json DEFAULT NULL;
ALTER TABLE `campaign_reports` ADD COLUMN `bigKeywordReport` json DEFAULT NULL;
