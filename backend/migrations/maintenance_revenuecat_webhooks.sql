WITH expired AS (
  SELECT event_id
  FROM revenuecat_webhook_event
  WHERE processed_at < now() - interval '30 days'
  ORDER BY processed_at
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM revenuecat_webhook_event AS webhook
USING expired
WHERE webhook.event_id = expired.event_id;
