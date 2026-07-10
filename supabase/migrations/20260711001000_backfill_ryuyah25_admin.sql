INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM public.profiles
WHERE x_id_normalized = 'ryuyah25'
ON CONFLICT (user_id, role) DO NOTHING;
