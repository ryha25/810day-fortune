CREATE TABLE IF NOT EXISTS public.lottery_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_date DATE NOT NULL UNIQUE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  daily_winner_user_id UUID REFERENCES public.profiles(id),
  daily_winner_by_gauge BOOLEAN NOT NULL DEFAULT false,
  daily_participants_count INT NOT NULL DEFAULT 0,
  follow_winner_user_id UUID REFERENCES public.profiles(id),
  follow_winner_by_gauge BOOLEAN NOT NULL DEFAULT false,
  follow_participants_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lottery_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id UUID NOT NULL REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
  draw_date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  x_id_display TEXT NOT NULL,
  x_id_normalized TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('normal', 'w')),
  slot TEXT NOT NULL CHECK (slot IN ('daily', 'follow', 'both')),
  by_gauge BOOLEAN NOT NULL DEFAULT false,
  redemption_rate INT NOT NULL,
  reward_inmu INT NOT NULL,
  sol_address TEXT,
  discord_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draw_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.lottery_result_views (
  draw_id UUID NOT NULL REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (draw_id, user_id)
);

ALTER TABLE public.lottery_draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_result_views ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.lottery_draws TO authenticated;
GRANT SELECT ON public.lottery_winners TO authenticated;
GRANT SELECT, INSERT ON public.lottery_result_views TO authenticated;
GRANT ALL ON public.lottery_draws TO service_role;
GRANT ALL ON public.lottery_winners TO service_role;
GRANT ALL ON public.lottery_result_views TO service_role;

CREATE POLICY "draws readable by signed in users" ON public.lottery_draws
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "winners readable by signed in users" ON public.lottery_winners
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "result views self select" ON public.lottery_result_views
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "result views self insert" ON public.lottery_result_views
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS lottery_draws_draw_date_idx ON public.lottery_draws(draw_date DESC);
CREATE INDEX IF NOT EXISTS lottery_winners_draw_date_idx ON public.lottery_winners(draw_date DESC);
CREATE INDEX IF NOT EXISTS lottery_winners_user_id_idx ON public.lottery_winners(user_id, draw_date DESC);
CREATE INDEX IF NOT EXISTS lottery_winners_kind_idx ON public.lottery_winners(kind, draw_date DESC);

CREATE OR REPLACE FUNCTION public.run_daily_draw(_draw_date DATE DEFAULT NULL)
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('810day-draw-' || v_date::text));

  IF EXISTS (SELECT 1 FROM public.lottery_draws WHERE draw_date = v_date) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_drawn', 'draw_date', v_date);
  END IF;

  SELECT count(*) INTO v_daily_count
  FROM public.daily_participations
  WHERE participation_date = v_date;

  SELECT count(*) INTO v_follow_count
  FROM public.profiles
  WHERE official_follow_registered = true;

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

  INSERT INTO public.lottery_draws (
    draw_date,
    daily_winner_user_id,
    daily_winner_by_gauge,
    daily_participants_count,
    follow_winner_user_id,
    follow_winner_by_gauge,
    follow_participants_count
  )
  VALUES (
    v_date,
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
      by_gauge, redemption_rate, reward_inmu, sol_address, discord_id
    )
    VALUES (
      v_draw_id, v_date, v_daily_id, v_daily_x_id_display, v_daily_x_id_normalized, 'w', 'both',
      COALESCE(v_daily_by_gauge, false) OR COALESCE(v_follow_by_gauge, false),
      v_daily_redemption_rate, 200000, v_daily_sol_address, v_daily_discord_id
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
        by_gauge, redemption_rate, reward_inmu, sol_address, discord_id
      )
      VALUES (
        v_draw_id, v_date, v_daily_id, v_daily_x_id_display, v_daily_x_id_normalized, 'normal', 'daily',
        COALESCE(v_daily_by_gauge, false), v_daily_redemption_rate,
        10000 + floor(10000 * v_daily_redemption_rate / 100.0)::int,
        v_daily_sol_address, v_daily_discord_id
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
        by_gauge, redemption_rate, reward_inmu, sol_address, discord_id
      )
      VALUES (
        v_draw_id, v_date, v_follow_id, v_follow_x_id_display, v_follow_x_id_normalized, 'normal', 'follow',
        COALESCE(v_follow_by_gauge, false), v_follow_redemption_rate,
        10000 + floor(10000 * v_follow_redemption_rate / 100.0)::int,
        v_follow_sol_address, v_follow_discord_id
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
    'daily_winner', v_daily_x_id_normalized,
    'follow_winner', v_follow_x_id_normalized,
    'w_win', v_w,
    'daily_by_gauge', COALESCE(v_daily_by_gauge, false),
    'follow_by_gauge', COALESCE(v_follow_by_gauge, false)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_daily_draw(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_draw(DATE) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '810day-daily-draw') THEN
    PERFORM cron.unschedule('810day-daily-draw');
  END IF;
  PERFORM cron.schedule('810day-daily-draw', '0 3 * * *', 'SELECT public.run_daily_draw();');
END $$;
