
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profiles_block_protected_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_initial_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calc_redemption_rate(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_redemption_rate(int) TO authenticated, service_role;
