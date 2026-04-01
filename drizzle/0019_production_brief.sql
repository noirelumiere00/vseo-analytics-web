-- Add productionBrief JSON column to analysis_reports
ALTER TABLE `analysis_reports` ADD COLUMN `productionBrief` json DEFAULT NULL;
