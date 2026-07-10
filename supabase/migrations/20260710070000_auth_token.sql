-- Add per-user auth_token to profiles.
-- This is a server-side-only secret used to authenticate users; it is never
-- exposed to browser clients. Column-level privilege revocation ensures
-- authenticated (anon/user) sessions cannot SELECT this column.

ALTER TABLE public.profiles ADD COLUMN auth_token TEXT;

-- Prevent authenticated users from reading this column directly.
-- Server functions use the service_role key (supabaseAdmin) to read it.
REVOKE SELECT (auth_token) ON public.profiles FROM authenticated;
