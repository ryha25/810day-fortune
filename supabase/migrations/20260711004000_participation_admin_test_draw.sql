CREATE TABLE IF NOT EXISTS public.participation_stat_days (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participation_date DATE NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('daily', 'follow')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, participation_date)
);

ALTER TABLE public.participation_stat_days ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.participation_stat_days TO authenticated;
GRANT ALL ON public.participation_stat_days TO service_role;

DROP POLICY IF EXISTS "participation stat days self select" ON public.participation_stat_days;
CREATE POLICY "participation stat days self select"
ON public.participation_stat_days
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.profile_stat_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL CHECK (field_name IN ('participation_count', 'win_count', 'redemption_rate', 'confirm_gauge')),
  old_value INT NOT NULL,
  new_value INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_stat_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profile_stat_audit_logs TO authenticated;
GRANT ALL ON public.profile_stat_audit_logs TO service_role;

DROP POLICY IF EXISTS "audit logs admin select" ON public.profile_stat_audit_logs;
CREATE POLICY "audit logs admin select"
ON public.profile_stat_audit_logs
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.lottery_draws
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_snapshot JSONB;

ALTER TABLE public.lottery_winners
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lottery_draws_draw_date_key'
      AND conrelid = 'public.lottery_draws'::regclass
  ) THEN
    ALTER TABLE public.lottery_draws DROP CONSTRAINT lottery_draws_draw_date_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lottery_draws_production_draw_date_key
ON public.lottery_draws(draw_date)
WHERE is_test = false;

CREATE INDEX IF NOT EXISTS lottery_draws_test_idx
ON public.lottery_draws(is_test, canceled_at, executed_at DESC);

CREATE OR REPLACE FUNCTION public.apply_daily_participation_increment(
  _user_id UUID,
  _participation_date DATE,
  _source TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count INT := 0;
  v_inserted BOOLEAN := false;
  v_profile public.profiles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-participation-' || _user_id::text || '-' || _participation_date::text));

  INSERT INTO public.participation_stat_days (user_id, participation_date, source)
  VALUES (_user_id, _participation_date, _source)
  ON CONFLICT (user_id, participation_date) DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  v_inserted := v_inserted_count > 0;

  IF v_inserted THEN
    UPDATE public.profiles
    SET participation_count = participation_count + 1,
        confirm_gauge = LEAST(30, confirm_gauge + 1),
        redemption_rate = public.calc_redemption_rate(participation_count + 1),
        updated_at = now()
    WHERE id = _user_id;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = _user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'stat_incremented', v_inserted,
    'participation_count', v_profile.participation_count,
    'confirm_gauge', v_profile.confirm_gauge,
    'redemption_rate', v_profile.redemption_rate,
    'win_count', v_profile.win_count
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
  v_stats JSONB;
BEGIN
  INSERT INTO public.daily_participations (user_id, participation_date)
  VALUES (_user_id, v_date)
  ON CONFLICT (user_id, participation_date) DO NOTHING;

  GET DIAGNOSTICS v_daily_inserted_count = ROW_COUNT;
  v_daily_inserted := v_daily_inserted_count > 0;

  v_stats := public.apply_daily_participation_increment(_user_id, v_date, 'daily');

  RETURN v_stats || jsonb_build_object(
    'daily_participated', true,
    'daily_inserted', v_daily_inserted,
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
  v_was_registered BOOLEAN := false;
  v_stats JSONB;
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT official_follow_registered INTO v_was_registered
  FROM public.profiles
  WHERE id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF NOT v_was_registered THEN
    UPDATE public.profiles
    SET official_follow_registered = true,
        updated_at = now()
    WHERE id = _user_id;

    v_stats := public.apply_daily_participation_increment(_user_id, v_date, 'follow');
  ELSE
    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = _user_id;

    v_stats := jsonb_build_object(
      'ok', true,
      'stat_incremented', false,
      'participation_count', v_profile.participation_count,
      'confirm_gauge', v_profile.confirm_gauge,
      'redemption_rate', v_profile.redemption_rate,
      'win_count', v_profile.win_count
    );
  END IF;

  RETURN v_stats || jsonb_build_object(
    'official_follow_registered', true,
    'follow_first_registered', NOT v_was_registered,
    'participation_date', v_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_profile_stats(
  _admin_user_id UUID,
  _target_user_id UUID,
  _participation_count INT,
  _win_count INT,
  _redemption_rate INT,
  _confirm_gauge INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.profiles%ROWTYPE;
BEGIN
  IF NOT public.has_role(_admin_user_id, 'admin') THEN
    RAISE EXCEPTION 'admin permission required';
  END IF;

  IF _participation_count < 0 OR _win_count < 0 OR _redemption_rate < 0 OR _redemption_rate > 50 OR _confirm_gauge < 0 OR _confirm_gauge > 30 THEN
    RAISE EXCEPTION 'invalid profile stats';
  END IF;

  SELECT * INTO v_old
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target profile not found';
  END IF;

  IF v_old.participation_count IS DISTINCT FROM _participation_count THEN
    INSERT INTO public.profile_stat_audit_logs (target_user_id, admin_user_id, field_name, old_value, new_value)
    VALUES (_target_user_id, _admin_user_id, 'participation_count', v_old.participation_count, _participation_count);
  END IF;
  IF v_old.win_count IS DISTINCT FROM _win_count THEN
    INSERT INTO public.profile_stat_audit_logs (target_user_id, admin_user_id, field_name, old_value, new_value)
    VALUES (_target_user_id, _admin_user_id, 'win_count', v_old.win_count, _win_count);
  END IF;
  IF v_old.redemption_rate IS DISTINCT FROM _redemption_rate THEN
    INSERT INTO public.profile_stat_audit_logs (target_user_id, admin_user_id, field_name, old_value, new_value)
    VALUES (_target_user_id, _admin_user_id, 'redemption_rate', v_old.redemption_rate, _redemption_rate);
  END IF;
  IF v_old.confirm_gauge IS DISTINCT FROM _confirm_gauge THEN
    INSERT INTO public.profile_stat_audit_logs (target_user_id, admin_user_id, field_name, old_value, new_value)
    VALUES (_target_user_id, _admin_user_id, 'confirm_gauge', v_old.confirm_gauge, _confirm_gauge);
  END IF;

  UPDATE public.profiles
  SET participation_count = _participation_count,
      win_count = _win_count,
      redemption_rate = _redemption_rate,
      confirm_gauge = _confirm_gauge,
      updated_at = now()
  WHERE id = _target_user_id;

  RETURN jsonb_build_object('ok', true);
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

    UPDATE public.profiles
    SET win_count = win_count + 2,
        confirm_gauge = CASE
          WHEN COALESCE(v_daily_by_gauge, false) OR COALESCE(v_follow_by_gauge, false) THEN 0
          ELSE confirm_gauge
        END,
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

      UPDATE public.profiles
      SET win_count = win_count + 1,
          confirm_gauge = CASE WHEN COALESCE(v_daily_by_gauge, false) THEN 0 ELSE confirm_gauge END,
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

      UPDATE public.profiles
      SET win_count = win_count + 1,
          confirm_gauge = CASE WHEN COALESCE(v_follow_by_gauge, false) THEN 0 ELSE confirm_gauge END,
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

CREATE OR REPLACE FUNCTION public.run_daily_draw(_draw_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.run_daily_draw_core(_draw_date, false)
$$;

CREATE OR REPLACE FUNCTION public.run_test_draw(_draw_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.run_daily_draw_core(_draw_date, true)
$$;

CREATE OR REPLACE FUNCTION public.cancel_test_draw(_draw_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draw public.lottery_draws%ROWTYPE;
  v_item JSONB;
BEGIN
  SELECT * INTO v_draw
  FROM public.lottery_draws
  WHERE id = _draw_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT v_draw.is_test THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_test');
  END IF;
  IF v_draw.canceled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_canceled');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_draw.test_snapshot, '[]'::jsonb))
  LOOP
    UPDATE public.profiles
    SET win_count = (v_item->>'win_count')::INT,
        confirm_gauge = (v_item->>'confirm_gauge')::INT,
        updated_at = now()
    WHERE id = (v_item->>'id')::UUID;
  END LOOP;

  UPDATE public.lottery_winners
  SET canceled_at = now()
  WHERE draw_id = _draw_id
    AND is_test = true
    AND canceled_at IS NULL;

  UPDATE public.lottery_draws
  SET canceled_at = now()
  WHERE id = _draw_id;

  RETURN jsonb_build_object('ok', true, 'draw_id', _draw_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_daily_participation_increment(UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_official_follow_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_profile_stats(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_daily_draw_core(DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_test_draw(DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_test_draw(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_official_follow_participation(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_stats(UUID, UUID, INT, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_test_draw(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_test_draw(UUID) TO service_role;
