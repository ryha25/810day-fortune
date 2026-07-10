import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkIsAdmin } from "@/lib/admin.functions";

export function useIsAdmin() {
  const fn = useServerFn(checkIsAdmin);
  return useQuery({
    queryKey: ["is-admin"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}
