# Backend migrations

Migrations are reviewed SQL and are not executed by an API request or startup hook. Before enabling
the lesson tutor, an operator must apply `001_lesson_tutor_guard.sql` to the target database with a
credential authorized for DDL with `psql --set ON_ERROR_STOP=1`, then verify the table and indexes.
The migration uses one transaction, so a failed statement leaves no partial schema. It must be run by
a migration operator that owns the target schema and may grant privileges. The final statement grants
only `SELECT`, `INSERT`, and `UPDATE` on this table to the existing `glidelingo_app` runtime
role; verify those grants—and that `DELETE` is denied—while connected as that runtime role before
activation. Run retention with a separate maintenance credential that has `DELETE` on this table,
not with the internet-facing API runtime role.

Completed, retryable, and ambiguous tutor rows are retained for seven days so client retries receive a
stable result throughout the supported idempotency window. Run the two bounded statements in
`maintenance_lesson_tutor_guard.sql` at least daily after activation, repeating until both affect
zero rows. The first statement terminalizes abandoned leases even when no later admission arrives:

```sql
WITH abandoned AS (
  SELECT ctid
  FROM lesson_tutor_turn_guard
  WHERE status = 'in_progress'
    AND updated_at < now() - interval '120 seconds'
  ORDER BY updated_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
UPDATE lesson_tutor_turn_guard AS guard
SET status = 'ambiguous'
FROM abandoned
WHERE guard.ctid = abandoned.ctid;
```

Then delete expired terminal rows:

```sql
WITH expired AS (
  SELECT ctid
  FROM lesson_tutor_turn_guard
  WHERE status <> 'in_progress'
    AND updated_at < now() - interval '7 days'
  ORDER BY updated_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM lesson_tutor_turn_guard AS guard
USING expired
WHERE guard.ctid = expired.ctid;
```

The tutor flags must remain false until both migration and recurring retention maintenance are in
place. Admission and maintenance both convert an `in_progress` row older than its conservative
120-second lease to `ambiguous`, which remains a non-retryable `409` for the same idempotency key
during the supported seven-day idempotency window. The maintenance path ensures an idle service
cannot retain abandoned rows forever.
