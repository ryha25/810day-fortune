import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, KeyRound, LogOut } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { changeMyPassword } from "@/lib/participation.functions";
import { disablePushSubscription, getMyPushStatus, getPushPublicKey, savePushSubscription } from "@/lib/push.functions";

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
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!profile) return;
    setXid(profile.x_id_display);
    setSol(profile.sol_address ?? "");
    setDc(profile.discord_id ?? "");
  }, [profile]);

  useEffect(() => {
    getMyPushStatus()
      .then((status) => setPushEnabled(!!status.enabled))
      .catch(() => setPushEnabled(false));
  }, []);

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

  async function enablePushNotifications() {
    if (pushSaving) return;
    const isEmbeddedPreview = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    if (isEmbeddedPreview) {
      toast.error("埋め込みPreviewでは通知を許可できません。New tabまたは公開URLで開いてください。");
      return;
    }

    if (!window.isSecureContext) {
      toast.error("通知はHTTPSの公開URLでのみ許可できます。公開URLから開いてください。");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      toast.error("このブラウザはプッシュ通知に対応していません。");
      return;
    }

    if (Notification.permission === "denied") {
      toast.error("ブラウザ側で通知がブロックされています。URL左の鍵アイコンから通知を許可してください。");
      return;
    }

    setPushSaving(true);
    try {
      const { publicKey, enabled } = await getPushPublicKey();
      const cleanPublicKey = publicKey.trim();
      if (!enabled || !cleanPublicKey) {
        toast.error("通知設定がまだ完了していません。管理者側でVAPIDキーを設定してください。");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("通知が許可されませんでした。");
        return;
      }

      await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cleanPublicKey),
        }));
      const subscriptionPayload = subscription.toJSON();
      if (!subscriptionPayload.endpoint || !subscriptionPayload.keys?.p256dh || !subscriptionPayload.keys?.auth) {
        throw new Error("通知購読情報を取得できませんでした。ページを再読み込みして再度お試しください。");
      }

      await savePushSubscription({
        data: {
          subscription: subscriptionPayload as any,
          user_agent: navigator.userAgent,
        },
      });
      setPushEnabled(true);
      toast.success("プッシュ通知を有効にしました。");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "プッシュ通知の設定に失敗しました。");
    } finally {
      setPushSaving(false);
    }
  }

  async function disablePushNotifications() {
    if (pushSaving) return;
    setPushSaving(true);
    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/push-sw.js") : null;
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) await subscription.unsubscribe();
      await disablePushSubscription({ data: { endpoint: subscription?.endpoint } });
      setPushEnabled(false);
      toast.success("プッシュ通知を停止しました。");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "プッシュ通知の停止に失敗しました。");
    } finally {
      setPushSaving(false);
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

        <section className="card-luxe rounded-2xl p-6 space-y-3 mt-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-[oklch(0.82_0.15_88)]" />
            <h2 className="font-display text-xl text-gold-gradient">プッシュ通知</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            抽選結果、抽選締切10分前、本日の締切後に通知します。
          </p>
          <button
            type="button"
            onClick={pushEnabled ? disablePushNotifications : enablePushNotifications}
            disabled={pushSaving}
            className="btn-gold w-full rounded-lg py-3 font-semibold disabled:opacity-60"
          >
            {pushSaving ? "処理中..." : pushEnabled ? "通知を停止する" : "通知を有効にする"}
          </button>
        </section>

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

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}
