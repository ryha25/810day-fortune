import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { BottomNav } from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "プロフィール | 810Day毎日くじ" },
      { name: "description", content: "X ID・SOLアドレス・Discord IDを編集できます。" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { data: profile, isLoading, refetch } = useProfile();
  const [xid, setXid] = useState("");
  const [sol, setSol] = useState("");
  const [dc, setDc] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (profile) {
      setXid(profile.x_id_display);
      setSol(profile.sol_address ?? "");
      setDc(profile.discord_id ?? "");
    }
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !profile) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          x_id_display: xid.trim(),
          sol_address: sol.trim() || null,
          discord_id: dc.trim() || null,
        })
        .eq("id", profile.id);
      if (error) throw error;
      toast.success("保存しました");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading || !profile) {
    return (
      <main className="min-h-screen bg-luxe flex items-center justify-center">
        <div className="text-muted-foreground">読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-luxe pb-28">
      <div className="mx-auto max-w-md px-4 pt-8">
        <h1 className="font-display text-3xl text-gold-gradient text-center mb-6">プロフィール</h1>
        <form onSubmit={handleSave} className="card-luxe rounded-2xl p-6 space-y-4">
          <Field label="X ID" value={xid} onChange={setXid} placeholder="@sample" />
          <Field
            label="SOLアドレス（本人と管理者のみ閲覧可能）"
            value={sol}
            onChange={setSol}
            placeholder="任意"
          />
          <Field
            label="Discord ID（本人と管理者のみ閲覧可能）"
            value={dc}
            onChange={setDc}
            placeholder="任意"
          />
          <button
            type="submit"
            disabled={saving}
            className="btn-gold w-full rounded-lg py-3 font-semibold disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </form>

        <div className="card-luxe rounded-2xl p-4 mt-4 text-sm text-muted-foreground">
          Discord IDを登録しただけではDiscord参加とは判定されません。
        </div>

        <button
          onClick={handleLogout}
          className="mt-6 w-full flex items-center justify-center gap-2 rounded-lg py-3 border border-[oklch(0.5_0.22_25/0.5)] text-[oklch(0.75_0.18_25)]"
        >
          <LogOut className="h-4 w-4" /> ログアウト
        </button>
      </div>
      <BottomNav />
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none focus:border-[oklch(0.82_0.15_88)]"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
    </div>
  );
}
