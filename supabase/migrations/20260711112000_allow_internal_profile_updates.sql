ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS official_follow_registered_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.profiles_block_protected_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.participation_count IS DISTINCT FROM OLD.participation_count
     OR NEW.win_count IS DISTINCT FROM OLD.win_count
     OR NEW.redemption_rate IS DISTINCT FROM OLD.redemption_rate
     OR NEW.confirm_gauge IS DISTINCT FROM OLD.confirm_gauge
     OR NEW.official_follow_registered IS DISTINCT FROM OLD.official_follow_registered
     OR NEW.x_id_normalized IS DISTINCT FROM OLD.x_id_normalized
  THEN
    IF current_setting('request.jwt.claim.role', true) = 'service_role'
       OR current_setting('app.profile_internal_update', true) = 'on'
    THEN
      NEW.updated_at := now();
      RETURN NEW;
    END IF;

    NEW.participation_count := OLD.participation_count;
    NEW.win_count := OLD.win_count;
    NEW.redemption_rate := OLD.redemption_rate;
    NEW.confirm_gauge := OLD.confirm_gauge;
    NEW.official_follow_registered := OLD.official_follow_registered;
    IF NEW.x_id_display IS DISTINCT FROM OLD.x_id_display THEN
      NEW.x_id_normalized := lower(regexp_replace(NEW.x_id_display, '^@+', ''));
    ELSE
      NEW.x_id_normalized := OLD.x_id_normalized;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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
  v_date DATE := COALESCE(_participation_date, (now() AT TIME ZONE 'Asia/Tokyo')::date);
  v_daily_inserted_count INT := 0;
  v_daily_inserted BOOLEAN := false;
  v_stat_inserted_count INT := 0;
  v_should_increment BOOLEAN := false;
  v_profile public.profiles%ROWTYPE;
BEGIN
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

CREATE OR REPLACE FUNCTION public.register_official_follow_participation(
  _user_id UUID,
  _participation_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(_participation_date, (now() AT TIME ZONE 'Asia/Tokyo')::date);
  v_profile public.profiles%ROWTYPE;
  v_was_registered BOOLEAN := false;
BEGIN
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  v_was_registered := v_profile.official_follow_registered;

  IF NOT v_was_registered THEN
    PERFORM set_config('app.profile_internal_update', 'on', true);
    UPDATE public.profiles
    SET official_follow_registered = true,
        official_follow_registered_at = COALESCE(official_follow_registered_at, now()),
        updated_at = now()
    WHERE id = _user_id
    RETURNING * INTO v_profile;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'official_follow_registered', true,
    'follow_first_registered', NOT v_was_registered,
    'participation_count', v_profile.participation_count,
    'confirm_gauge', v_profile.confirm_gauge,
    'redemption_rate', v_profile.redemption_rate,
    'win_count', v_profile.win_count,
    'participation_date', v_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_draw_result(
  _user_id UUID,
  _draw_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.lottery_draws%ROWTYPE;
  v_already_confirmed BOOLEAN := false;
  v_had_daily_participation BOOLEAN := false;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_draw
  FROM public.lottery_draws
  WHERE id = _draw_id
    AND is_test = false
    AND canceled_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draw_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('810day-result-confirm-' || _user_id::text || '-' || _draw_id::text));

  SELECT result_confirmed INTO v_already_confirmed
  FROM public.lottery_result_views
  WHERE draw_id = _draw_id
    AND user_id = _user_id
  FOR UPDATE;

  IF COALESCE(v_already_confirmed, false) THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
    RETURN jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'stat_updated', false,
      'participation_count', v_profile.participation_count,
      'confirm_gauge', v_profile.confirm_gauge,
      'redemption_rate', v_profile.redemption_rate
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.daily_participations
    WHERE user_id = _user_id
      AND participation_date = v_draw.draw_date
  ) INTO v_had_daily_participation;

  IF v_had_daily_participation THEN
    PERFORM set_config('app.profile_internal_update', 'on', true);
    UPDATE public.profiles
    SET confirm_gauge = LEAST(30, confirm_gauge + 1),
        redemption_rate = public.calc_redemption_rate(participation_count),
        updated_at = now()
    WHERE id = _user_id
    RETURNING * INTO v_profile;
  ELSE
    SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
  END IF;

  INSERT INTO public.lottery_result_views (draw_id, user_id, seen_at, result_confirmed, confirmed_at)
  VALUES (_draw_id, _user_id, now(), true, now())
  ON CONFLICT (draw_id, user_id) DO UPDATE SET
    seen_at = now(),
    result_confirmed = true,
    confirmed_at = COALESCE(public.lottery_result_views.confirmed_at, now());

  RETURN jsonb_build_object(
    'ok', true,
    'already_confirmed', false,
    'stat_updated', v_had_daily_participation,
    'participation_count', v_profile.participation_count,
    'confirm_gauge', v_profile.confirm_gauge,
    'redemption_rate', v_profile.redemption_rate
  );
END;
$$;

DO $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF to_regclass('public.participation_stat_days') IS NOT NULL THEN
    PERFORM set_config('app.profile_internal_update', 'on', true);

    WITH inserted AS (
      INSERT INTO public.participation_stat_days (user_id, participation_date, source)
      SELECT dp.user_id, dp.participation_date, 'daily'
      FROM public.daily_participations dp
      WHERE dp.participation_date = v_today
        AND NOT EXISTS (
          SELECT 1
          FROM public.participation_stat_days psd
          WHERE psd.user_id = dp.user_id
            AND psd.participation_date = dp.participation_date
        )
      ON CONFLICT (user_id, participation_date) DO NOTHING
      RETURNING user_id
    ),
    per_user AS (
      SELECT user_id, count(*)::int AS add_count
      FROM inserted
      GROUP BY user_id
    )
    UPDATE public.profiles p
    SET participation_count = p.participation_count + per_user.add_count,
        updated_at = now()
    FROM per_user
    WHERE p.id = per_user.user_id;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_official_follow_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_official_follow_participation(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) TO service_role;
