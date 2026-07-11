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

  IF NOT _is_test AND EXISTS (SELECT 1 FROM public.lottery_draws WHERE draw_date = v_date AND is_test = false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_drawn', 'draw_date', v_date);
  END IF;

  SELECT count(*) INTO v_daily_count
  FROM public.daily_participations
  WHERE participation_date = v_date;

  SELECT count(*) INTO v_follow_count
  FROM public.profiles
  WHERE official_follow_registered = true;

  IF v_daily_count = 0 AND v_follow_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_candidates', 'draw_date', v_date);
  END IF;

  WITH candidates AS (
    SELECT p.*
    FROM public.daily_participations dp
    JOIN public.profiles p ON p.id = dp.user_id
    WHERE dp.participation_date = v_date
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
    SELECT *
    FROM public.profiles
    WHERE official_follow_registered = true
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

GRANT EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) TO service_role;
