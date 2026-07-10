import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent, HTMLAttributes } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isValidXId, normalizeXId } from "@/lib/xid";
import { loginWithXId, registerNewUser, xIdExists } from "@/lib/participation.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "ログイン / 新規登録 | 810Day毎日くじ" },
      { name: "description", content: "X IDだけで参加できる810Day毎日くじ。" },
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
  const login = useServerFn(loginWithXId);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    const normalized = normalizeXId(xid);
    if (!isValidXId(normalized)) {
      toast.error("X IDは半角英数字とアンダースコア、最大15文字で入力してください");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const check = await exists({ data: { x_id_normalized: normalized } });
        if (!check.exists) {
          toast.error("このX IDは未登録です。新規登録してください");
          return;
        }
        const res = await login({ data: { x_id_normalized: normalized } });
        if (!res.ok) {
          toast.error("ログインに失敗しました");
          return;
        }
        await supabase.auth.setSession({
          access_token: res.access_token,
          refresh_token: res.refresh_token,
        });
        navigate({ to: "/dashboard" });
        return;
      }

      let pastNum = 0;
      if (mode === "existing") {
        const n = Number(past);
        if (!Number.isInteger(n) || n < 0 || n > 100000) {
          toast.error("参加回数は0以上の整数で入力してください");
          return;
        }
        pastNum = n;
      }

      const res = await register({
        data: {
          x_id_display: xid.trim(),
          x_id_normalized: normalized,
          existing: mode === "existing",
          past_participation: pastNum,
        },
      });
      if (!res.ok) {
        toast.error(res.reason === "duplicate_x_id" ? "このX IDは既に登録されています" : "登録に失敗しました");
        return;
      }

      // Sign in after registration using the same server-side path
      const loginRes = await login({ data: { x_id_normalized: normalized } });
      if (!loginRes.ok) {
        toast.error("登録は完了しましたが、ログインに失敗しました。ログインページからお試しください");
        return;
      }
      await supabase.auth.setSession({
        access_token: loginRes.access_token,
        refresh_token: loginRes.refresh_token,
      });
      navigate({ to: "/dashboard" });
    } catch (err) {
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
            {[
              ["login", "ログイン"],
              ["existing", "既存参加"],
              ["new", "新規参加"],
            ].map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m as Mode)}
                className={`py-2.5 font-semibold ${mode === m ? "btn-gold" : "text-muted-foreground bg-transparent"}`}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card-luxe rounded-2xl p-6 space-y-4">
          <Field label="X ID" value={xid} onChange={setXid} placeholder="@sample または sample" />

          {mode === "existing" && (
            <Field
              label="今までの参加回数"
              value={past}
              onChange={(v) => setPast(v.replace(/[^0-9]/g, ""))}
              placeholder="0"
              inputMode="numeric"
            />
          )}

          <button type="submit" disabled={loading} className="btn-gold w-full rounded-lg py-3 font-display text-base disabled:opacity-60">
            {loading ? "処理中..." : mode === "login" ? "ログイン" : "登録して開始"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          パスワードは不要。X IDのみで安全にログインできます。
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none focus:border-[oklch(0.82_0.15_88)] transition"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required
      />
    </div>
  );
}
