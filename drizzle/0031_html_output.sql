-- pain_analyses に HTMLスライド出力カラムを追加
ALTER TABLE `pain_analyses` ADD COLUMN `htmlOutput` longtext DEFAULT NULL;
