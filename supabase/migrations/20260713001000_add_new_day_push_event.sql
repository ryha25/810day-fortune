ALTER TABLE public.push_notification_events
DROP CONSTRAINT IF EXISTS push_notification_events_event_type_check;

ALTER TABLE public.push_notification_events
ADD CONSTRAINT push_notification_events_event_type_check
CHECK (event_type IN ('new_day', 'cutoff_10min', 'cutoff_closed', 'draw_result'));
