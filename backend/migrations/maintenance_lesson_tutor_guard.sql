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
