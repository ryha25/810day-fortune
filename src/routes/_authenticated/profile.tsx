import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { changeMyPassword } from "@/lib/participation.functions";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "プロフィール | 810Day毎日くじ" },
      { name: "description", content: "X ID、SOLアドレス、Discord IDを編集できます。" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { data: profile, isLoading, refetch } = useProfile();
  const [xid, setXid] = useState("");
  const [sol, setSol] = useState("");
  const [dc, setDc] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!profile) return;
    setXid(profile.x_id_display);
    setSol(profile.sol_address ?? "");
    setDc(profile.discord_id ?? "");
  }, [profile]);

  async function handleSave(e: FormEvent) {
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

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    if (changingPassword) return;
    if (newPassword !== newPasswordConfirm) {
      toast.error("新しいパスワードが一致しません。");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("新しいパスワードは8文字以上で入力してください。");
      return;
    }

    setChangingPassword(true);
    try {
      const res = await changeMyPassword({
        data: {
          current_password: currentPassword,
          new_password: newPassword,
        },
      });
      if (!res.ok) {
        toast.error("現在のパスワードが正しくありません。");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      toast.success("パスワードを変更しました。");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "パスワード変更に失敗しました");
    } finally {
      setChangingPassword(false);
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
          <Field label="SOLアドレス" value={sol} onChange={setSol} placeholder="任意" />
          <Field label="Discord ID" value={dc} onChange={setDc} placeholder="任意" />
          <button type="submit" disabled={saving} className="btn-gold w-full rounded-lg py-3 font-semibold disabled:opacity-60">
            {saving ? "保存中..." : "保存する"}
          </button>
        </form>

        <form onSubmit={handlePasswordChange} className="card-luxe rounded-2xl p-6 space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[oklch(0.82_0.15_88)]" />
            <h2 className="font-display text-xl text-gold-gradient">パスワード変更</h2>
          </div>
          <Field label="現在のパスワード" value={currentPassword} onChange={setCurrentPassword} type="password" />
          <Field label="新しいパスワード" value={newPassword} onChange={setNewPassword} type="password" />
          <Field label="新しいパスワード確認" value={newPasswordConfirm} onChange={setNewPasswordConfirm} type="password" />
          <button type="submit" disabled={changingPassword} className="btn-gold w-full rounded-lg py-3 font-semibold disabled:opacity-60">
            {changingPassword ? "変更中..." : "パスワードを変更する"}
          </button>
          <p className="text-xs text-muted-foreground">
            変更後はログイン画面でX IDと新しいパスワードを入力してください。
          </p>
        </form>

        <div className="card-luxe rounded-2xl p-4 mt-4 text-sm text-muted-foreground">
          Discord加入分は今回の抽選報酬には加算されません。確認後に反映します。
        </div>

        <button onClick={handleLogout} className="mt-6 w-full flex items-center justify-center gap-2 rounded-lg py-3 border border-[oklch(0.5_0.22_25/0.5)] text-[oklch(0.75_0.18_25)]">
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
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">{label}</label>
      <input
        value={value}
        type={type}
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
