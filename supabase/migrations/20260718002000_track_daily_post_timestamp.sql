ALTER TABLE public.daily_participations
  ADD COLUMN IF NOT EXISTS daily_post_participated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS official_follow_participated_at TIMESTAMPTZ;

UPDATE public.daily_participations
SET official_follow_participated_at = COALESCE(official_follow_participated_at, created_at)
WHERE official_follow_participated = true;

UPDATE public.daily_participations
SET daily_post_participated = false
WHERE participation_date = (now() AT TIME ZONE 'Asia/Tokyo')::date
  AND official_follow_participated = true
  AND daily_post_participated = true
  AND daily_post_participated_at IS NULL;

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
      official_follow_participated,
      official_follow_participated_at
    )
    VALUES (
      v_row.id,
      v_date,
      true,
      now()
    )
    ON CONFLICT (user_id, participation_date) DO UPDATE SET
      official_follow_participated = true,
      official_follow_participated_at = COALESCE(public.daily_participations.official_follow_participated_at, now())
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
    daily_post_participated,
    daily_post_participated_at
  )
  VALUES (
    _user_id,
    v_date,
    true,
    now()
  )
  ON CONFLICT (user_id, participation_date) DO UPDATE SET
    daily_post_participated = true,
    daily_post_participated_at = COALESCE(public.daily_participations.daily_post_participated_at, now())
  WHERE public.daily_participations.daily_post_participated_at IS NULL;

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

REVOKE EXECUTE ON FUNCTION public.record_official_follow_auto_participations(DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_official_follow_auto_participations(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_daily_post_participation(UUID, DATE) TO service_role;
