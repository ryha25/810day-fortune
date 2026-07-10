import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { registerNewUser, xIdExists } from "@/lib/participation.functions";
import { normalizeXId, xIdToEmail, xIdToPassword, isValidXId } from "@/lib/xid";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "ログイン / 新規登録 | 810Day毎日くじ" },
      { name: "description", content: "X IDだけで参加できる810Day毎日くじ。既存参加者・新規参加者どちらも登録可能。" },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "existing" | "new";

function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [xid, setXid] = useState("");
  const [past, setPast] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const register = useServerFn(registerNewUser);
  const exists = useServerFn(xIdExists);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const normalized = normalizeXId(xid);
    if (!isValidXId(normalized)) {
      toast.error("X IDは半角英数字とアンダースコア（最大15文字）で入力してください");
      return;
    }
    setLoading(true);
    try {
      const email = xIdToEmail(normalized);
      const password = xIdToPassword(normalized);
      if (mode === "login") {
        const check = await exists({ data: { x_id_normalized: normalized } });
        if (!check.exists) {
          toast.error("このX IDは未登録です。新規登録してください");
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("ログインしました");
        navigate({ to: "/dashboard" });
        return;
      }
      // registration
      let pastNum = 0;
      if (mode === "existing") {
        const n = Number(past);
        if (!Number.isInteger(n) || n < 0 || n > 100000) {
          toast.error("参加回数は0以上の整数で入力してください");
          setLoading(false);
          return;
        }
        pastNum = n;
      }
      const res = await register({
        data: {
          x_id_display: xid.trim(),
          x_id_normalized: normalized,
          email,
          password,
          existing: mode === "existing",
          past_participation: pastNum,
        },
      });
      if (!res.ok) {
        if (res.reason === "duplicate_x_id") toast.error("このX IDは既に登録されています");
        else toast.error("登録に失敗しました");
        setLoading(false);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("登録が完了しました");
      navigate({ to: "/dashboard" });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-luxe flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl text-gold-gradient">810Day毎日くじ</h1>
          <p className="mt-2 text-sm text-muted-foreground">X IDだけで参加</p>
        </header>

        <div className="card-luxe rounded-2xl p-1 mb-6">
          <div className="grid grid-cols-3 rounded-xl overflow-hidden text-sm">
            {(
              [
                ["login", "ログイン"],
                ["existing", "既存参加"],
                ["new", "新規参加"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`py-2.5 font-semibold ${
                  mode === m
                    ? "btn-gold"
                    : "text-muted-foreground bg-transparent"
                }`}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card-luxe rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">X ID</label>
            <input
              value={xid}
              onChange={(e) => setXid(e.target.value)}
              placeholder="@sample または sample"
              className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none focus:border-[oklch(0.82_0.15_88)] transition"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>

          {mode === "existing" && (
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">
                今までの参加回数
              </label>
              <input
                value={past}
                onChange={(e) => setPast(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="0"
                className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none focus:border-[oklch(0.82_0.15_88)]"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                還元率・確定ゲージは参加回数から自動で計算されます
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-gold w-full rounded-lg py-3 font-display text-base disabled:opacity-60"
          >
            {loading ? "処理中..." : mode === "login" ? "ログイン" : "登録して開始"}
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground mt-6">
          パスワードは不要。X IDのみで安全にログインできます。
        </p>
      </div>
    </main>
  );
}
