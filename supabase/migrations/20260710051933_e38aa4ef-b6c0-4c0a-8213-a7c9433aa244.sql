
-- Roles enum + user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Redemption rate calc
CREATE OR REPLACE FUNCTION public.calc_redemption_rate(_count int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _count <= 10 THEN 0
    WHEN _count >= 20 THEN 50
    ELSE (_count - 10) * 5
  END
$$;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  x_id_normalized TEXT NOT NULL UNIQUE,
  x_id_display TEXT NOT NULL,
  participation_count INT NOT NULL DEFAULT 0,
  win_count INT NOT NULL DEFAULT 0,
  redemption_rate INT NOT NULL DEFAULT 0,
  confirm_gauge INT NOT NULL DEFAULT 0,
  official_follow_registered BOOLEAN NOT NULL DEFAULT false,
  sol_address TEXT,
  discord_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Only self or admin can read full row. (Column-level protection for sol/discord is enforced
-- by never exposing those columns to non-owner via app queries; admin uses server functions.)
CREATE POLICY "profiles self select" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- Restrict which columns a user can update: use trigger to block internal counters
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.profiles_block_protected_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.participation_count IS DISTINCT FROM OLD.participation_count
     OR NEW.win_count IS DISTINCT FROM OLD.win_count
     OR NEW.redemption_rate IS DISTINCT FROM OLD.redemption_rate
     OR NEW.confirm_gauge IS DISTINCT FROM OLD.confirm_gauge
     OR NEW.official_follow_registered IS DISTINCT FROM OLD.official_follow_registered
     OR NEW.x_id_normalized IS DISTINCT FROM OLD.x_id_normalized
  THEN
    -- Only allow if called by service_role (server functions)
    IF current_setting('request.jwt.claim.role', true) = 'service_role'
       OR (SELECT rolname FROM pg_roles WHERE oid = current_user::regrole) = 'service_role'
    THEN
      RETURN NEW;
    END IF;
    -- Allow x_id_normalized update when it matches new display (via server), otherwise block protected
    NEW.participation_count := OLD.participation_count;
    NEW.win_count := OLD.win_count;
    NEW.redemption_rate := OLD.redemption_rate;
    NEW.confirm_gauge := OLD.confirm_gauge;
    NEW.official_follow_registered := OLD.official_follow_registered;
    -- allow x_id changes but re-normalize on server; keep normalized in sync
    IF NEW.x_id_display IS DISTINCT FROM OLD.x_id_display THEN
      NEW.x_id_normalized := lower(regexp_replace(NEW.x_id_display, '^@', ''));
    ELSE
      NEW.x_id_normalized := OLD.x_id_normalized;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER profiles_protect_update BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_block_protected_columns();

-- daily participations (JST date)
CREATE TABLE public.daily_participations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  participation_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, participation_date)
);
GRANT SELECT ON public.daily_participations TO authenticated;
GRANT ALL ON public.daily_participations TO service_role;
ALTER TABLE public.daily_participations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily self select" ON public.daily_participations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Auto-assign admin role for known admin X ID on profile insert
CREATE OR REPLACE FUNCTION public.assign_initial_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;
  IF NEW.x_id_normalized = 'ryuyah25' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_assign_role AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_initial_role();
