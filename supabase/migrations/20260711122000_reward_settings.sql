CREATE TABLE IF NOT EXISTS public.lottery_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  draw_time_jst TIME NOT NULL DEFAULT '12:00',
  participation_cutoff_time_jst TIME NOT NULL DEFAULT '11:59',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lottery_settings
  ADD COLUMN IF NOT EXISTS normal_base_reward_inmu INT NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS w_reward_inmu INT NOT NULL DEFAULT 200000;

INSERT INTO public.lottery_settings (id, draw_time_jst, participation_cutoff_time_jst, normal_base_reward_inmu, w_reward_inmu)
VALUES (true, '12:00', '11:59', 10000, 200000)
ON CONFLICT (id) DO NOTHING;

UPDATE public.lottery_settings
SET normal_base_reward_inmu = COALESCE(normal_base_reward_inmu, 10000),
    w_reward_inmu = COALESCE(w_reward_inmu, 200000)
WHERE id = true;

CREATE OR REPLACE FUNCTION public.update_lottery_settings(
  _admin_user_id UUID,
  _draw_time_jst TIME,
  _participation_cutoff_time_jst TIME,
  _normal_base_reward_inmu INT,
  _w_reward_inmu INT
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

  IF _normal_base_reward_inmu < 0 OR _w_reward_inmu < 0 THEN
    RAISE EXCEPTION 'reward must be 0 or greater';
  END IF;

  INSERT INTO public.lottery_settings (
    id,
    draw_time_jst,
    participation_cutoff_time_jst,
    normal_base_reward_inmu,
    w_reward_inmu,
    updated_at
  )
  VALUES (
    true,
    _draw_time_jst,
    _participation_cutoff_time_jst,
    _normal_base_reward_inmu,
    _w_reward_inmu,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    draw_time_jst = EXCLUDED.draw_time_jst,
    participation_cutoff_time_jst = EXCLUDED.participation_cutoff_time_jst,
    normal_base_reward_inmu = EXCLUDED.normal_base_reward_inmu,
    w_reward_inmu = EXCLUDED.w_reward_inmu,
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
    'normal_base_reward_inmu', _normal_base_reward_inmu,
    'w_reward_inmu', _w_reward_inmu,
    'cron_utc', v_cron
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_lottery_settings(UUID, TIME, TIME, INT, INT) TO service_role;

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
  v_normal_base_reward INT := 10000;
  v_w_reward INT := 200000;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-draw-' || v_date::text || '-' || CASE WHEN _is_test THEN 'test' ELSE 'production' END));

  SELECT normal_base_reward_inmu, w_reward_inmu
  INTO v_normal_base_reward, v_w_reward
  FROM public.lottery_settings
  WHERE id = true;

  v_normal_base_reward := COALESCE(v_normal_base_reward, 10000);
  v_w_reward := COALESCE(v_w_reward, 200000);

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
      v_daily_redemption_rate, v_w_reward, v_daily_sol_address, v_daily_discord_id, _is_test
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
        v_normal_base_reward + floor(v_normal_base_reward * v_daily_redemption_rate / 100.0)::int,
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
        v_normal_base_reward + floor(v_normal_base_reward * v_follow_redemption_rate / 100.0)::int,
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
    'normal_base_reward_inmu', v_normal_base_reward,
    'w_reward_inmu', v_w_reward,
    'daily_by_gauge', COALESCE(v_daily_by_gauge, false),
    'follow_by_gauge', COALESCE(v_follow_by_gauge, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) TO service_role;
