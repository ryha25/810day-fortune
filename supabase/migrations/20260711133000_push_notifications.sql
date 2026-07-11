CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

DROP POLICY IF EXISTS "push subscriptions self select" ON public.push_subscriptions;
CREATE POLICY "push subscriptions self select"
ON public.push_subscriptions
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "push subscriptions self insert" ON public.push_subscriptions;
CREATE POLICY "push subscriptions self insert"
ON public.push_subscriptions
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push subscriptions self update" ON public.push_subscriptions;
CREATE POLICY "push subscriptions self update"
ON public.push_subscriptions
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push subscriptions self delete" ON public.push_subscriptions;
CREATE POLICY "push subscriptions self delete"
ON public.push_subscriptions
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
ON public.push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS public.push_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK (event_type IN ('cutoff_10min', 'cutoff_closed', 'draw_result')),
  event_date DATE NOT NULL,
  scheduled_at_jst TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_type, event_date)
);

ALTER TABLE public.push_notification_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.push_notification_events TO authenticated;
GRANT ALL ON public.push_notification_events TO service_role;

DROP POLICY IF EXISTS "push events admin select" ON public.push_notification_events;
CREATE POLICY "push events admin select"
ON public.push_notification_events
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.push_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.push_notification_events(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, subscription_id)
);

ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.push_notification_deliveries TO authenticated;
GRANT ALL ON public.push_notification_deliveries TO service_role;

DROP POLICY IF EXISTS "push deliveries admin select" ON public.push_notification_deliveries;
CREATE POLICY "push deliveries admin select"
ON public.push_notification_deliveries
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
