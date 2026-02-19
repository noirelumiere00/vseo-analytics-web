CREATE TABLE `triple_search_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`searchData` json,
	`appearedInAll3Ids` json,
	`appearedIn2Ids` json,
	`appearedIn1OnlyIds` json,
	`overlapRate` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `triple_search_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `triple_search_results_jobId_unique` UNIQUE(`jobId`)
);
