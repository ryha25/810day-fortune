ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS official_follow_registered_at TIMESTAMPTZ;

ALTER TABLE public.lottery_result_views
  ADD COLUMN IF NOT EXISTS result_confirmed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

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
  v_profile public.profiles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-daily-participation-' || _user_id::text || '-' || v_date::text));

  INSERT INTO public.daily_participations (user_id, participation_date)
  VALUES (_user_id, v_date)
  ON CONFLICT (user_id, participation_date) DO NOTHING;

  GET DIAGNOSTICS v_daily_inserted_count = ROW_COUNT;
  v_daily_inserted := v_daily_inserted_count > 0;

  IF v_daily_inserted THEN
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
    'win_count', v_profile.win_count
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

REVOKE EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) TO service_role;
