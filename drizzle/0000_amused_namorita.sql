CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`content_hash` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	`expires_at` text NOT NULL
);
