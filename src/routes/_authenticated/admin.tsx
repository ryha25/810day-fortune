import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { adminSearchUsers, adminUpdateXId, checkIsAdmin } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "管理 | 810Day毎日くじ" }, { name: "robots", content: "noindex" }] }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

function AdminPage() {
  const searchFn = useServerFn(adminSearchUsers);
  const updateFn = useServerFn(adminUpdateXId);
  const isAdminFn = useServerFn(checkIsAdmin);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn(), staleTime: 60_000 });
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => searchFn({ data: { q } }),
  });

  async function save(id: string) {
    const val = editing[id];
    if (!val) return;
    const res = await updateFn({ data: { user_id: id, x_id_display: val } });
    if (!res.ok) {
      toast.error(res.reason === "duplicate" ? "重複するX IDです" : "形式が正しくありません");
      return;
    }
    toast.success("更新しました");
    setEditing((p) => {
      const { [id]: _, ...rest } = p;
      return rest;
    });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    refetch();
  }

  return (
    <main className="min-h-screen bg-luxe pb-28">
      <div className="mx-auto max-w-md px-4 pt-8">
        <h1 className="font-display text-3xl text-gold-gradient text-center mb-2">管理</h1>
        <p className="text-center text-xs text-muted-foreground mb-6">
          抽選管理系は今後実装予定
        </p>

        <div className="card-luxe rounded-2xl p-4 mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="X IDで検索..."
            className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none focus:border-[oklch(0.82_0.15_88)]"
          />
        </div>

        <div className="space-y-3">
          {isLoading && <div className="text-center text-muted-foreground text-sm">読み込み中...</div>}
          {data?.users.map((u) => {
            const editVal = editing[u.id];
            const isEditing = editVal !== undefined;
            return (
              <div key={u.id} className="card-luxe rounded-2xl p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  {isEditing ? (
                    <input
                      value={editVal}
                      onChange={(e) => setEditing((p) => ({ ...p, [u.id]: e.target.value }))}
                      className="flex-1 rounded bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-2 py-1"
                    />
                  ) : (
                    <div className="font-display text-gold-gradient text-lg">@{u.x_id_normalized}</div>
                  )}
                  {isEditing ? (
                    <>
                      <button onClick={() => save(u.id)} className="btn-gold rounded px-3 py-1 text-xs font-semibold">
                        保存
                      </button>
                      <button
                        onClick={() =>
                          setEditing((p) => {
                            const { [u.id]: _, ...rest } = p;
                            return rest;
                          })
                        }
                        className="text-xs text-muted-foreground px-2"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setEditing((p) => ({ ...p, [u.id]: u.x_id_display }))}
                      className="text-xs text-[oklch(0.82_0.15_88)] px-2"
                    >
                      編集
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>参加: {u.participation_count}</div>
                  <div>当選: {u.win_count}</div>
                  <div>還元率: {u.redemption_rate}%</div>
                  <div>ゲージ: {u.confirm_gauge}/30</div>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">SOL: </span>
                  <span className="break-all">{u.sol_address || "-"}</span>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Discord: </span>
                  <span className="break-all">{u.discord_id || "-"}</span>
                </div>
              </div>
            );
          })}
          {data && data.users.length === 0 && !isLoading && (
            <div className="text-center text-muted-foreground text-sm py-8">該当ユーザーなし</div>
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
