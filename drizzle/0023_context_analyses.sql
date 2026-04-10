CREATE TABLE `context_analyses` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `productName` varchar(255) NOT NULL,
  `productImageUrl` text,
  `status` enum('pending','collecting','analyzing','completed','failed') NOT NULL DEFAULT 'pending',
  `s1RawData` json,
  `s2RawData` json,
  `s3RawData` json,
  `analysisResult` json,
  `s3ReportKey` varchar(512),
  `errorMessage` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `completedAt` timestamp,
  CONSTRAINT `context_analyses_id` PRIMARY KEY(`id`)
);
