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

  PERFORM set_config('app.profile_internal_update', 'on', true);
  UPDATE public.profiles
  SET participation_count = _participation_count,
      win_count = _win_count,
      redemption_rate = _redemption_rate,
      confirm_gauge = _confirm_gauge,
      updated_at = now()
  WHERE id = _target_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'participation_count', _participation_count,
    'win_count', _win_count,
    'redemption_rate', _redemption_rate,
    'confirm_gauge', _confirm_gauge
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
  v_had_daily_participation BOOLEAN := false;
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
      'redemption_rate', v_profile.redemption_rate,
      'win_count', v_profile.win_count
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
    'redemption_rate', v_profile.redemption_rate,
    'win_count', v_profile.win_count
  );
END;
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
    RETURN jsonb_build_object('ok', false, 'reason', 'draw_not_found');
  END IF;
  IF NOT v_draw.is_test THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_test_draw');
  END IF;
  IF v_draw.canceled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_canceled');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_draw.test_snapshot, '[]'::jsonb))
  LOOP
    PERFORM set_config('app.profile_internal_update', 'on', true);
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

REVOKE EXECUTE ON FUNCTION public.admin_update_profile_stats(UUID, UUID, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_test_draw(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_stats(UUID, UUID, INT, INT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_draw_result(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_test_draw(UUID) TO service_role;
