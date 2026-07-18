CREATE TABLE IF NOT EXISTS public.planned_lottery_draws (
  draw_date DATE PRIMARY KEY,
  daily_winner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  follow_winner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  planned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  planned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.planned_lottery_draws ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.planned_lottery_draws TO service_role;

DROP POLICY IF EXISTS "planned draws admin select" ON public.planned_lottery_draws;
CREATE POLICY "planned draws admin select"
ON public.planned_lottery_draws
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.plan_daily_draw_winners(
  _admin_user_id UUID,
  _draw_date DATE,
  _daily_winner_user_id UUID DEFAULT NULL,
  _follow_winner_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(_draw_date, (now() AT TIME ZONE 'Asia/Tokyo')::date);
BEGIN
  IF NOT public.has_role(_admin_user_id, 'admin') THEN
    RAISE EXCEPTION 'admin permission required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lottery_draws
    WHERE draw_date = v_date
      AND is_test = false
      AND canceled_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_drawn', 'draw_date', v_date);
  END IF;

  PERFORM public.record_official_follow_auto_participations(v_date);

  IF _daily_winner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.daily_participations
    WHERE user_id = _daily_winner_user_id
      AND participation_date = v_date
      AND daily_post_participated = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_not_eligible', 'draw_date', v_date);
  END IF;

  IF _follow_winner_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.daily_participations
    WHERE user_id = _follow_winner_user_id
      AND participation_date = v_date
      AND official_follow_participated = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'follow_not_eligible', 'draw_date', v_date);
  END IF;

  INSERT INTO public.planned_lottery_draws (
    draw_date,
    daily_winner_user_id,
    follow_winner_user_id,
    planned_by,
    planned_at,
    updated_at
  )
  VALUES (
    v_date,
    _daily_winner_user_id,
    _follow_winner_user_id,
    _admin_user_id,
    now(),
    now()
  )
  ON CONFLICT (draw_date) DO UPDATE SET
    daily_winner_user_id = EXCLUDED.daily_winner_user_id,
    follow_winner_user_id = EXCLUDED.follow_winner_user_id,
    planned_by = EXCLUDED.planned_by,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'draw_date', v_date,
    'daily_winner_user_id', _daily_winner_user_id,
    'follow_winner_user_id', _follow_winner_user_id
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
  v_planned_daily_id UUID;
  v_planned_follow_id UUID;
  v_planned_daily_used BOOLEAN := false;
  v_planned_follow_used BOOLEAN := false;
  v_w BOOLEAN := false;
  v_snapshot JSONB := '[]'::jsonb;
  v_normal_reward INT := 10000;
  v_w_reward INT := 200000;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-draw-' || v_date::text || '-' || CASE WHEN _is_test THEN 'test' ELSE 'production' END));

  PERFORM public.record_official_follow_auto_participations(v_date);

  IF NOT _is_test AND EXISTS (SELECT 1 FROM public.lottery_draws WHERE draw_date = v_date AND is_test = false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_drawn', 'draw_date', v_date);
  END IF;

  SELECT COALESCE(normal_base_reward_inmu, 10000), COALESCE(w_reward_inmu, 200000)
  INTO v_normal_reward, v_w_reward
  FROM public.lottery_settings
  WHERE id = true;

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

  IF NOT _is_test THEN
    SELECT daily_winner_user_id, follow_winner_user_id
    INTO v_planned_daily_id, v_planned_follow_id
    FROM public.planned_lottery_draws
    WHERE draw_date = v_date;
  END IF;

  IF v_planned_daily_id IS NOT NULL THEN
    SELECT p.id, p.x_id_display, p.x_id_normalized, p.redemption_rate, p.sol_address, p.discord_id, p.confirm_gauge >= 30
    INTO v_daily_id, v_daily_x_id_display, v_daily_x_id_normalized, v_daily_redemption_rate, v_daily_sol_address, v_daily_discord_id, v_daily_by_gauge
    FROM public.daily_participations dp
    JOIN public.profiles p ON p.id = dp.user_id
    WHERE dp.participation_date = v_date
      AND dp.daily_post_participated = true
      AND dp.user_id = v_planned_daily_id
    LIMIT 1;
    v_planned_daily_used := v_daily_id IS NOT NULL;
  END IF;

  IF v_daily_id IS NULL THEN
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
  END IF;

  IF v_planned_follow_id IS NOT NULL THEN
    SELECT p.id, p.x_id_display, p.x_id_normalized, p.redemption_rate, p.sol_address, p.discord_id, p.confirm_gauge >= 30
    INTO v_follow_id, v_follow_x_id_display, v_follow_x_id_normalized, v_follow_redemption_rate, v_follow_sol_address, v_follow_discord_id, v_follow_by_gauge
    FROM public.daily_participations dp
    JOIN public.profiles p ON p.id = dp.user_id
    WHERE dp.participation_date = v_date
      AND dp.official_follow_participated = true
      AND dp.user_id = v_planned_follow_id
    LIMIT 1;
    v_planned_follow_used := v_follow_id IS NOT NULL;
  END IF;

  IF v_follow_id IS NULL THEN
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
  END IF;

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
        v_normal_reward + floor(v_normal_reward * v_daily_redemption_rate / 100.0)::int,
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
        v_normal_reward + floor(v_normal_reward * v_follow_redemption_rate / 100.0)::int,
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
    'follow_by_gauge', COALESCE(v_follow_by_gauge, false),
    'planned_daily_used', v_planned_daily_used,
    'planned_follow_used', v_planned_follow_used
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.plan_daily_draw_winners(UUID, DATE, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_daily_draw_winners(UUID, DATE, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) TO service_role;
