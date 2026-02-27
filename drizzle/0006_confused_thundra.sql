CREATE TABLE `analysis_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`sentiment` enum('positive','neutral','negative') NOT NULL,
	`keywords` json,
	`keyHook` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analysis_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `analysis_cache_contentHash_unique` UNIQUE(`contentHash`)
);
