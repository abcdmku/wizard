CREATE TABLE `test_wizard_dedupe` (
	`run_key` text NOT NULL,
	`kind` text NOT NULL,
	`dedupe_id` text NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`claim_id` text NOT NULL,
	`owner_fence` text NOT NULL,
	`claimed_at_ms` integer NOT NULL,
	`request` text,
	`result` text,
	`completed_at_ms` integer,
	PRIMARY KEY(`run_key`, `kind`, `dedupe_id`),
	FOREIGN KEY (`run_key`) REFERENCES `test_wizard_runs`(`run_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_wizard_dedupe_retention_idx` ON `test_wizard_dedupe` (`status`,`completed_at_ms`);--> statement-breakpoint
CREATE TABLE `test_wizard_runs` (
	`run_key` text PRIMARY KEY NOT NULL,
	`fence_counter` integer DEFAULT 0 NOT NULL,
	`claim_counter` integer DEFAULT 0 NOT NULL,
	`owner_id` text,
	`fence` text,
	`lease_expires_at_ms` integer,
	`snapshot_epoch` integer,
	`snapshot_seq` integer,
	`snapshot` text
);
--> statement-breakpoint
CREATE TABLE `test_wizard_timers` (
	`run_key` text NOT NULL,
	`timer_id` text NOT NULL,
	`due_at_ms` integer NOT NULL,
	`expected_epoch` integer NOT NULL,
	`expected_seq` integer NOT NULL,
	`claim_id` text NOT NULL,
	`owner_fence` text NOT NULL,
	`claimed_until_ms` integer NOT NULL,
	PRIMARY KEY(`run_key`, `timer_id`),
	FOREIGN KEY (`run_key`) REFERENCES `test_wizard_runs`(`run_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_wizard_timer_retention_idx` ON `test_wizard_timers` (`claimed_until_ms`);