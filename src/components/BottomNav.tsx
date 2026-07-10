import { Link } from "@tanstack/react-router";
import { History, Home, Shield, User } from "lucide-react";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export function BottomNav() {
  const { data: adminData } = useIsAdmin();
  const isAdmin = adminData?.isAdmin ?? false;
  const items = [
    { to: "/dashboard", label: "ホーム", Icon: Home },
    { to: "/history", label: "履歴", Icon: History },
    { to: "/profile", label: "プロフィール", Icon: User },
    ...(isAdmin ? [{ to: "/admin", label: "管理", Icon: Shield }] : []),
  ] as const;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-[oklch(0.55_0.12_82/0.35)] bg-[oklch(0.1_0.01_40/0.92)] backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className={`mx-auto max-w-md grid ${isAdmin ? "grid-cols-4" : "grid-cols-3"}`}>
        {items.map(({ to, label, Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex flex-col items-center justify-center gap-1 py-3 text-xs text-muted-foreground"
              activeProps={{ className: "text-gold-gradient" }}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
