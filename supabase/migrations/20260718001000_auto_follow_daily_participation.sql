ALTER TABLE public.daily_participations
  ADD COLUMN IF NOT EXISTS official_follow_participated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_post_participated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS participation_count_incremented BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirm_gauge_incremented BOOLEAN NOT NULL DEFAULT false;

UPDATE public.daily_participations
SET daily_post_participated = true,
    participation_count_incremented = true
WHERE daily_post_participated = false;

CREATE OR REPLACE FUNCTION public.ensure_daily_participation_count_once(
  _user_id UUID,
  _participation_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incremented_count INT := 0;
BEGIN
  UPDATE public.daily_participations
  SET participation_count_incremented = true
  WHERE user_id = _user_id
    AND participation_date = _participation_date
    AND participation_count_incremented = false;

  GET DIAGNOSTICS v_incremented_count = ROW_COUNT;

  IF v_incremented_count > 0 THEN
    PERFORM set_config('app.profile_internal_update', 'on', true);
    UPDATE public.profiles
    SET participation_count = participation_count + 1,
        updated_at = now()
    WHERE id = _user_id;
  END IF;

  RETURN v_incremented_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_official_follow_auto_participations(
  _participation_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(_participation_date, (now() AT TIME ZONE 'Asia/Tokyo')::date);
  v_row RECORD;
  v_changed_count INT := 0;
  v_row_changed_count INT := 0;
  v_incremented_count INT := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-auto-follow-' || v_date::text));

  FOR v_row IN
    SELECT id
    FROM public.profiles
    WHERE official_follow_registered = true
      AND (
        official_follow_registered_at IS NULL
        OR official_follow_registered_at <= (v_date::timestamp AT TIME ZONE 'Asia/Tokyo')
      )
  LOOP
    INSERT INTO public.daily_participations (
      user_id,
      participation_date,
      official_follow_participated
    )
    VALUES (
      v_row.id,
      v_date,
      true
    )
    ON CONFLICT (user_id, participation_date) DO UPDATE SET
      official_follow_participated = true
    WHERE public.daily_participations.official_follow_participated = false;

    GET DIAGNOSTICS v_row_changed_count = ROW_COUNT;
    v_changed_count := v_changed_count + v_row_changed_count;

    IF public.ensure_daily_participation_count_once(v_row.id, v_date) THEN
      v_incremented_count := v_incremented_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'participation_date', v_date,
    'processed_count', (
      SELECT count(*)
      FROM public.profiles
      WHERE official_follow_registered = true
        AND (
          official_follow_registered_at IS NULL
          OR official_follow_registered_at <= (v_date::timestamp AT TIME ZONE 'Asia/Tokyo')
        )
    ),
    'changed_rows', v_changed_count,
    'participation_count_incremented', v_incremented_count
  );
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
  v_count_incremented BOOLEAN := false;
  v_profile public.profiles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-daily-participation-' || _user_id::text || '-' || v_date::text));

  INSERT INTO public.daily_participations (
    user_id,
    participation_date,
    daily_post_participated
  )
  VALUES (
    _user_id,
    v_date,
    true
  )
  ON CONFLICT (user_id, participation_date) DO UPDATE SET
    daily_post_participated = true
  WHERE public.daily_participations.daily_post_participated = false;

  GET DIAGNOSTICS v_daily_inserted_count = ROW_COUNT;
  v_daily_inserted := v_daily_inserted_count > 0;
  v_count_incremented := public.ensure_daily_participation_count_once(_user_id, v_date);

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = _user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'daily_participated', true,
    'daily_inserted', v_daily_inserted,
    'participation_count_incremented', v_count_incremented,
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

  PERFORM public.record_official_follow_auto_participations(v_date);

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = _user_id;

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

CREATE OR REPLACE FUNCTION public.run_daily_draw_core(_draw_date DATE, _is_test BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(_draw_date, (now() AT TIME ZONE 'Asia/Tokyo')::date);
  v_draw_id UUID;
  v_daily_count INT := 0;
  v_follow_count INT := 0;
  v_daily_id UUID;
  v_daily_x_id_display TEXT;
  v_daily_x_id_normalized TEXT;
  v_daily_redemption_rate INT;
  v_daily_sol_address TEXT;
  v_daily_discord_id TEXT;
  v_daily_by_gauge BOOLEAN := false;
  v_follow_id UUID;
  v_follow_x_id_display TEXT;
  v_follow_x_id_normalized TEXT;
  v_follow_redemption_rate INT;
  v_follow_sol_address TEXT;
  v_follow_discord_id TEXT;
  v_follow_by_gauge BOOLEAN := false;
  v_w BOOLEAN := false;
  v_snapshot JSONB := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-draw-' || v_date::text || '-' || CASE WHEN _is_test THEN 'test' ELSE 'production' END));

  PERFORM public.record_official_follow_auto_participations(v_date);

  IF NOT _is_test AND EXISTS (SELECT 1 FROM public.lottery_draws WHERE draw_date = v_date AND is_test = false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_drawn', 'draw_date', v_date);
  END IF;

  SELECT count(*) INTO v_daily_count
  FROM public.daily_participations
  WHERE participation_date = v_date
    AND daily_post_participated = true;

  SELECT count(*) INTO v_follow_count
  FROM public.daily_participations
  WHERE participation_date = v_date
    AND official_follow_participated = true;

  IF v_daily_count = 0 AND v_follow_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_candidates', 'draw_date', v_date);
  END IF;

  WITH candidates AS (
    SELECT p.*
    FROM public.daily_participations dp
    JOIN public.profiles p ON p.id = dp.user_id
    WHERE dp.participation_date = v_date
      AND dp.daily_post_participated = true
  ),
  max_candidates AS (
    SELECT * FROM candidates WHERE confirm_gauge >= 30
  )
  SELECT id, x_id_display, x_id_normalized, redemption_rate, sol_address, discord_id, EXISTS (SELECT 1 FROM max_candidates) AS by_gauge
  INTO v_daily_id, v_daily_x_id_display, v_daily_x_id_normalized, v_daily_redemption_rate, v_daily_sol_address, v_daily_discord_id, v_daily_by_gauge
  FROM (
    SELECT * FROM max_candidates
    UNION ALL
    SELECT * FROM candidates WHERE NOT EXISTS (SELECT 1 FROM max_candidates)
  ) picked
  ORDER BY random()
  LIMIT 1;

  WITH candidates AS (
    SELECT p.*
    FROM public.daily_participations dp
    JOIN public.profiles p ON p.id = dp.user_id
    WHERE dp.participation_date = v_date
      AND dp.official_follow_participated = true
  ),
  max_candidates AS (
    SELECT * FROM candidates WHERE confirm_gauge >= 30
  )
  SELECT id, x_id_display, x_id_normalized, redemption_rate, sol_address, discord_id, EXISTS (SELECT 1 FROM max_candidates) AS by_gauge
  INTO v_follow_id, v_follow_x_id_display, v_follow_x_id_normalized, v_follow_redemption_rate, v_follow_sol_address, v_follow_discord_id, v_follow_by_gauge
  FROM (
    SELECT * FROM max_candidates
    UNION ALL
    SELECT * FROM candidates WHERE NOT EXISTS (SELECT 1 FROM max_candidates)
  ) picked
  ORDER BY random()
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'win_count', win_count,
    'confirm_gauge', confirm_gauge
  )), '[]'::jsonb)
  INTO v_snapshot
  FROM public.profiles
  WHERE id IN (SELECT DISTINCT unnest(ARRAY[v_daily_id, v_follow_id]::UUID[]))
    AND id IS NOT NULL;

  INSERT INTO public.lottery_draws (
    draw_date,
    is_test,
    test_snapshot,
    daily_winner_user_id,
    daily_winner_by_gauge,
    daily_participants_count,
    follow_winner_user_id,
    follow_winner_by_gauge,
    follow_participants_count
  )
  VALUES (
    v_date,
    _is_test,
    CASE WHEN _is_test THEN v_snapshot ELSE NULL END,
    v_daily_id,
    COALESCE(v_daily_by_gauge, false),
    v_daily_count,
    v_follow_id,
    COALESCE(v_follow_by_gauge, false),
    v_follow_count
  )
  RETURNING id INTO v_draw_id;

  v_w := v_daily_id IS NOT NULL AND v_follow_id IS NOT NULL AND v_daily_id = v_follow_id;

  IF v_w THEN
    INSERT INTO public.lottery_winners (
      draw_id, draw_date, user_id, x_id_display, x_id_normalized, kind, slot,
      by_gauge, redemption_rate, reward_inmu, sol_address, discord_id, is_test
    )
    VALUES (
      v_draw_id, v_date, v_daily_id, v_daily_x_id_display, v_daily_x_id_normalized, 'w', 'both',
      COALESCE(v_daily_by_gauge, false) OR COALESCE(v_follow_by_gauge, false),
      v_daily_redemption_rate, 200000, v_daily_sol_address, v_daily_discord_id, _is_test
    );

    PERFORM set_config('app.profile_internal_update', 'on', true);
    UPDATE public.profiles
    SET win_count = win_count + 2,
        confirm_gauge = 0,
        updated_at = now()
    WHERE id = v_daily_id;
  ELSE
    IF v_daily_id IS NOT NULL THEN
      INSERT INTO public.lottery_winners (
        draw_id, draw_date, user_id, x_id_display, x_id_normalized, kind, slot,
        by_gauge, redemption_rate, reward_inmu, sol_address, discord_id, is_test
      )
      VALUES (
        v_draw_id, v_date, v_daily_id, v_daily_x_id_display, v_daily_x_id_normalized, 'normal', 'daily',
        COALESCE(v_daily_by_gauge, false), v_daily_redemption_rate,
        10000 + floor(10000 * v_daily_redemption_rate / 100.0)::int,
        v_daily_sol_address, v_daily_discord_id, _is_test
      );

      PERFORM set_config('app.profile_internal_update', 'on', true);
      UPDATE public.profiles
      SET win_count = win_count + 1,
          updated_at = now()
      WHERE id = v_daily_id;
    END IF;

    IF v_follow_id IS NOT NULL THEN
      INSERT INTO public.lottery_winners (
        draw_id, draw_date, user_id, x_id_display, x_id_normalized, kind, slot,
        by_gauge, redemption_rate, reward_inmu, sol_address, discord_id, is_test
      )
      VALUES (
        v_draw_id, v_date, v_follow_id, v_follow_x_id_display, v_follow_x_id_normalized, 'normal', 'follow',
        COALESCE(v_follow_by_gauge, false), v_follow_redemption_rate,
        10000 + floor(10000 * v_follow_redemption_rate / 100.0)::int,
        v_follow_sol_address, v_follow_discord_id, _is_test
      );

      PERFORM set_config('app.profile_internal_update', 'on', true);
      UPDATE public.profiles
      SET win_count = win_count + 1,
          updated_at = now()
      WHERE id = v_follow_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'draw_date', v_date,
    'draw_id', v_draw_id,
    'is_test', _is_test,
    'daily_participants_count', v_daily_count,
    'follow_participants_count', v_follow_count,
    'daily_winner', v_daily_x_id_normalized,
    'follow_winner', v_follow_x_id_normalized,
    'w_win', v_w,
    'daily_by_gauge', COALESCE(v_daily_by_gauge, false),
    'follow_by_gauge', COALESCE(v_follow_by_gauge, false)
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
  v_profile public.profiles%ROWTYPE;
  v_already_confirmed BOOLEAN := false;
  v_had_participation BOOLEAN := false;
  v_gauge_incremented BOOLEAN := false;
  v_gauge_incremented_count INT := 0;
BEGIN
  SELECT * INTO v_draw
  FROM public.lottery_draws
  WHERE id = _draw_id
    AND is_test = false
    AND canceled_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draw_not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('810day-result-confirm-' || _user_id::text || '-' || v_draw.draw_date::text));

  INSERT INTO public.daily_participations (user_id, participation_date)
  VALUES (_user_id, v_draw.draw_date)
  ON CONFLICT (user_id, participation_date) DO NOTHING;

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
      'redemption_rate', v_profile.redemption_rate,
      'win_count', v_profile.win_count
    );
  END IF;

  SELECT (daily_post_participated OR official_follow_participated)
  INTO v_had_participation
  FROM public.daily_participations
  WHERE user_id = _user_id
    AND participation_date = v_draw.draw_date
  FOR UPDATE;

  IF COALESCE(v_had_participation, false) THEN
    UPDATE public.daily_participations
    SET result_confirmed = true,
        confirm_gauge_incremented = true
    WHERE user_id = _user_id
      AND participation_date = v_draw.draw_date
      AND confirm_gauge_incremented = false;

    GET DIAGNOSTICS v_gauge_incremented_count = ROW_COUNT;
    v_gauge_incremented := v_gauge_incremented_count > 0;

    IF v_gauge_incremented THEN
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
  ELSE
    SELECT * INTO v_profile FROM public.profiles WHERE id = _user_id;
  END IF;

  INSERT INTO public.lottery_result_views (draw_id, user_id, seen_at, result_confirmed, confirmed_at)
  VALUES (_draw_id, _user_id, now(), true, now())
  ON CONFLICT (draw_id, user_id) DO UPDATE SET
    seen_at = now(),
    result_confirmed = true,
    confirmed_at = COALESCE(public.lottery_result_views.confirmed_at, now());

  UPDATE public.daily_participations
  SET result_confirmed = true
  WHERE user_id = _user_id
    AND participation_date = v_draw.draw_date;

  RETURN jsonb_build_object(
    'ok', true,
    'already_confirmed', false,
    'stat_updated', v_gauge_incremented,
    'participation_count', v_profile.participation_count,
    'confirm_gauge', v_profile.confirm_gauge,
    'redemption_rate', v_profile.redemption_rate,
    'win_count', v_profile.win_count
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '810day-auto-follow-participation') THEN
      PERFORM cron.unschedule('810day-auto-follow-participation');
    END IF;
    PERFORM cron.schedule(
      '810day-auto-follow-participation',
      '0 15 * * *',
      'SELECT public.record_official_follow_auto_participations((now() AT TIME ZONE ''Asia/Tokyo'')::date);'
    );
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.ensure_daily_participation_count_once(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_official_follow_auto_participations(DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_official_follow_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_daily_participation_count_once(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_official_follow_auto_participations(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_official_follow_participation(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) TO service_role;
