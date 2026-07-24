-- Existing development and early-production data may predate the one-executor
-- invariant. Retain the most recently created active run per user and retire
-- any older checkpointed run before installing the partial unique index.
INSERT INTO `run_events` (
  `id`, `run_id`, `type`, `idempotency_key`, `detail_json`, `occurred_at`, `created_at`
)
SELECT
  lower(hex(randomblob(16))),
  `run_id`,
  'run_cancelled',
  'migration:one-active-run:' || `run_id`,
  '{"source":"migration","reason":"enforced_one_active_run_invariant"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT older.`id` AS `run_id`
  FROM `application_runs` AS older
  WHERE older.`state` IN ('ready', 'claimed', 'running', 'paused', 'needs_user_input')
    AND EXISTS (
      SELECT 1
      FROM `application_runs` AS newer
      WHERE newer.`user_id` = older.`user_id`
        AND newer.`state` IN ('ready', 'claimed', 'running', 'paused', 'needs_user_input')
        AND (
          newer.`created_at` > older.`created_at`
          OR (newer.`created_at` = older.`created_at` AND newer.`id` > older.`id`)
        )
    )
);
--> statement-breakpoint
UPDATE `application_runs`
SET
  `state` = 'cancelled',
  `launch_token_hash` = NULL,
  `execution_ticket_expires_at` = NULL,
  `executor_session_id` = NULL,
  `executor_tab_id` = NULL,
  `executor_event_token_hash` = NULL,
  `executor_event_token_expires_at` = NULL,
  `completed_at` = CURRENT_TIMESTAMP,
  `updated_at` = CURRENT_TIMESTAMP
WHERE `id` IN (
  SELECT older.`id`
  FROM `application_runs` AS older
  WHERE older.`state` IN ('ready', 'claimed', 'running', 'paused', 'needs_user_input')
    AND EXISTS (
      SELECT 1
      FROM `application_runs` AS newer
      WHERE newer.`user_id` = older.`user_id`
        AND newer.`state` IN ('ready', 'claimed', 'running', 'paused', 'needs_user_input')
        AND (
          newer.`created_at` > older.`created_at`
          OR (newer.`created_at` = older.`created_at` AND newer.`id` > older.`id`)
        )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_runs_one_active_per_user_idx` ON `application_runs` (`user_id`) WHERE "application_runs"."state" in ('ready', 'claimed', 'running', 'paused', 'needs_user_input');
