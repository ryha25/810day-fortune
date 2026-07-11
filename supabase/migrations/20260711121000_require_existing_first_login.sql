ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS initial_login_required BOOLEAN NOT NULL DEFAULT false;

GRANT SELECT, UPDATE(initial_login_required) ON public.profiles TO service_role;

DO $$
DECLARE
  v_has_auth_token BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'auth_token'
  )
  INTO v_has_auth_token;

  PERFORM set_config('app.profile_internal_update', 'on', true);

  IF v_has_auth_token THEN
    UPDATE public.profiles p
    SET initial_login_required = true,
        auth_token = NULL,
        official_follow_registered = false,
        official_follow_registered_at = NULL,
        updated_at = now()
    FROM public.existing_participants e
    WHERE p.x_id_normalized = e.x_id_normalized
      AND p.x_id_normalized <> 'ryuyah25';
  ELSE
    UPDATE public.profiles p
    SET initial_login_required = true,
        official_follow_registered = false,
        official_follow_registered_at = NULL,
        updated_at = now()
    FROM public.existing_participants e
    WHERE p.x_id_normalized = e.x_id_normalized
      AND p.x_id_normalized <> 'ryuyah25';
  END IF;

  UPDATE public.profiles
  SET initial_login_required = false,
      updated_at = now()
  WHERE x_id_normalized = 'ryuyah25';
END $$;
