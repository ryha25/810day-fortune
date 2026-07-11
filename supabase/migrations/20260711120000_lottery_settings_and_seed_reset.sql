CREATE TABLE IF NOT EXISTS public.lottery_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  draw_time_jst TIME NOT NULL DEFAULT '12:00',
  participation_cutoff_time_jst TIME NOT NULL DEFAULT '11:59',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lottery_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.lottery_settings TO anon, authenticated;
GRANT ALL ON public.lottery_settings TO service_role;

DROP POLICY IF EXISTS "lottery settings readable" ON public.lottery_settings;
CREATE POLICY "lottery settings readable"
ON public.lottery_settings
FOR SELECT
TO anon, authenticated
USING (true);

INSERT INTO public.lottery_settings (id, draw_time_jst, participation_cutoff_time_jst)
VALUES (true, '12:00', '11:59')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.update_lottery_settings(
  _admin_user_id UUID,
  _draw_time_jst TIME,
  _participation_cutoff_time_jst TIME
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_utc_time TIME;
  v_cron TEXT;
BEGIN
  IF NOT public.has_role(_admin_user_id, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  INSERT INTO public.lottery_settings (id, draw_time_jst, participation_cutoff_time_jst, updated_at)
  VALUES (true, _draw_time_jst, _participation_cutoff_time_jst, now())
  ON CONFLICT (id) DO UPDATE SET
    draw_time_jst = EXCLUDED.draw_time_jst,
    participation_cutoff_time_jst = EXCLUDED.participation_cutoff_time_jst,
    updated_at = now();

  v_utc_time := ((timestamp '2000-01-01' + _draw_time_jst) - interval '9 hours')::time;
  v_cron := extract(minute from v_utc_time)::int || ' ' || extract(hour from v_utc_time)::int || ' * * *';

  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      PERFORM cron.unschedule('810day-daily-draw');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      '810day-daily-draw',
      v_cron,
      'SELECT public.run_daily_draw();'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'draw_time_jst', _draw_time_jst::text,
    'participation_cutoff_time_jst', _participation_cutoff_time_jst::text,
    'cron_utc', v_cron
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lottery_settings(UUID, TIME, TIME) TO service_role;

CREATE OR REPLACE FUNCTION public.record_daily_post_participation(
  _user_id UUID,
  _participation_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_jst TIMESTAMP := now() AT TIME ZONE 'Asia/Tokyo';
  v_date DATE := COALESCE(_participation_date, (now() AT TIME ZONE 'Asia/Tokyo')::date);
  v_cutoff TIME := '11:59';
  v_daily_inserted_count INT := 0;
  v_daily_inserted BOOLEAN := false;
  v_stat_inserted_count INT := 0;
  v_should_increment BOOLEAN := false;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT participation_cutoff_time_jst
  INTO v_cutoff
  FROM public.lottery_settings
  WHERE id = true;

  IF v_date = v_now_jst::date AND v_now_jst::time > COALESCE(v_cutoff, '11:59'::time) THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'cutoff_passed',
      'cutoff_time_jst', COALESCE(v_cutoff, '11:59'::time)::text,
      'participation_count', v_profile.participation_count,
      'confirm_gauge', v_profile.confirm_gauge,
      'redemption_rate', v_profile.redemption_rate,
      'win_count', v_profile.win_count,
      'participation_date', v_date
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('810day-daily-participation-' || _user_id::text || '-' || v_date::text));

  INSERT INTO public.daily_participations (user_id, participation_date)
  VALUES (_user_id, v_date)
  ON CONFLICT (user_id, participation_date) DO NOTHING;

  GET DIAGNOSTICS v_daily_inserted_count = ROW_COUNT;
  v_daily_inserted := v_daily_inserted_count > 0;

  IF to_regclass('public.participation_stat_days') IS NOT NULL THEN
    INSERT INTO public.participation_stat_days (user_id, participation_date, source)
    VALUES (_user_id, v_date, 'daily')
    ON CONFLICT (user_id, participation_date) DO NOTHING;

    GET DIAGNOSTICS v_stat_inserted_count = ROW_COUNT;
    v_should_increment := v_stat_inserted_count > 0;
  ELSE
    v_should_increment := v_daily_inserted;
  END IF;

  IF v_should_increment THEN
    PERFORM set_config('app.profile_internal_update', 'on', true);
    UPDATE public.profiles
    SET participation_count = participation_count + 1,
        updated_at = now()
    WHERE id = _user_id;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = _user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'daily_participated', true,
    'daily_inserted', v_daily_inserted,
    'participation_count', v_profile.participation_count,
    'confirm_gauge', v_profile.confirm_gauge,
    'redemption_rate', v_profile.redemption_rate,
    'win_count', v_profile.win_count,
    'participation_date', v_date
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) TO service_role;

DO $$
DECLARE
  v_deleted_count INT := 0;
BEGIN
  CREATE TEMP TABLE reset_delete_users ON COMMIT DROP AS
  SELECT p.id
  FROM public.profiles p
  LEFT JOIN public.existing_participants e ON e.x_id_normalized = p.x_id_normalized
  WHERE e.x_id_normalized IS NULL
    AND p.x_id_normalized <> 'ryuyah25';

  IF to_regclass('public.lottery_result_views') IS NOT NULL THEN
    DELETE FROM public.lottery_result_views;
  END IF;

  IF to_regclass('public.lottery_winners') IS NOT NULL THEN
    DELETE FROM public.lottery_winners;
  END IF;

  IF to_regclass('public.lottery_draws') IS NOT NULL THEN
    DELETE FROM public.lottery_draws;
  END IF;

  IF to_regclass('public.daily_participations') IS NOT NULL THEN
    DELETE FROM public.daily_participations;
  END IF;

  IF to_regclass('public.participation_stat_days') IS NOT NULL THEN
    DELETE FROM public.participation_stat_days;
  END IF;

  IF to_regclass('public.profile_stat_audit_logs') IS NOT NULL THEN
    DELETE FROM public.profile_stat_audit_logs;
  END IF;

  DELETE FROM auth.users
  WHERE id IN (SELECT id FROM reset_delete_users);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  PERFORM set_config('app.profile_internal_update', 'on', true);

  UPDATE public.profiles p
  SET x_id_display = e.x_id_display,
      participation_count = e.participation_count,
      win_count = e.win_count,
      redemption_rate = e.redemption_rate,
      confirm_gauge = e.confirm_gauge,
      official_follow_registered = false,
      official_follow_registered_at = NULL,
      updated_at = now()
  FROM public.existing_participants e
  WHERE p.x_id_normalized = e.x_id_normalized;

  RAISE NOTICE '810day seed reset complete. deleted_new_users=%', v_deleted_count;
END $$;
