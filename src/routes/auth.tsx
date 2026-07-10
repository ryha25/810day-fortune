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
      { name: "description", content: "X IDで参加できる810Day毎日くじ。" },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "existing" | "new";

function isAdminXId(normalized: string) {
  return normalized === "ryuyah25";
}

function isNetworkError(err: unknown) {
  if (!(err instanceof Error)) return false;
  return /fetch|network|failed to fetch|load failed|通信/i.test(err.message);
}

function registerErrorMessage(res: { reason?: string }) {
  if (res.reason === "duplicate_x_id") return "このX IDはすでに登録されています。";
  if (res.reason === "existing_not_found") return "既存参加者データにこのX IDが見つかりません。";
  if (res.reason === "participation_mismatch") return "X IDと参加回数が一致しません。";
  if (res.reason === "existing_participant") return "既存参加者です。既存ユーザーログインを使ってください。";
  if (res.reason === "network_error") return "通信に失敗しました。時間をおいて再度お試しください。";
  return "現在登録処理を利用できません。管理者へお問い合わせください。";
}

function loginErrorMessage(res: { reason?: string }) {
  if (res.reason === "existing_not_found") return "既存参加者データにこのX IDが見つかりません。";
  if (res.reason === "participation_mismatch") return "X IDと参加回数が一致しません。";
  if (res.reason === "not_found") return "このX IDは未登録です。";
  if (res.reason === "password_required") return "パスワードを入力してください。";
  if (res.reason === "admin_password_not_configured") return "管理者パスワードが設定されていません。";
  if (res.reason === "network_error") return "通信に失敗しました。時間をおいて再度お試しください。";
  return "ログインに失敗しました。";
}

function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [xid, setXid] = useState("");
  const [past, setPast] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const register = useServerFn(registerNewUser);
  const exists = useServerFn(xIdExists);
  const login = useServerFn(loginWithXId);

  async function signIn(normalized: string, pastParticipation?: number) {
    const res = await login({
      data: {
        x_id_normalized: normalized,
        ...(pastParticipation !== undefined ? { past_participation: pastParticipation } : {}),
        ...(password ? { password } : {}),
      },
    });
    if (!res.ok) {
      toast.error(loginErrorMessage(res));
      return false;
    }

    const { error } = await supabase.auth.setSession({
      access_token: res.access_token,
      refresh_token: res.refresh_token,
    });
    if (error) throw error;
    return true;
  }

  function goAfterLogin(normalized: string) {
    navigate({ to: isAdminXId(normalized) ? "/admin" : "/dashboard" });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    const normalized = normalizeXId(xid);
    if (!isValidXId(normalized)) {
      toast.error("X IDは半角英数字とアンダースコア、最大15文字で入力してください。");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const check = await exists({ data: { x_id_normalized: normalized } });
        if (!check.exists) {
          toast.error("このX IDは未登録です。既存ユーザーまたは新規登録を使ってください。");
          return;
        }

        const ok = await signIn(normalized);
        if (ok) goAfterLogin(normalized);
        return;
      }

      let pastNum = 0;
      if (mode === "existing") {
        const n = Number(past);
        if (!Number.isInteger(n) || n < 0 || n > 100000) {
          toast.error("参加回数は0以上の整数で入力してください。");
          return;
        }
        pastNum = n;
      }

      if (mode === "existing") {
        const check = await exists({ data: { x_id_normalized: normalized } });
        if (check.exists) {
          const ok = await signIn(normalized, pastNum);
          if (ok) goAfterLogin(normalized);
          return;
        }
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
        toast.error(registerErrorMessage(res));
        return;
      }

      const ok = await signIn(normalized, mode === "existing" ? pastNum : undefined);
      if (ok) goAfterLogin(normalized);
    } catch (err) {
      console.error("[auth] submit failed", err);
      toast.error(
        isNetworkError(err)
          ? "通信に失敗しました。時間をおいて再度お試しください。"
          : "現在登録処理を利用できません。管理者へお問い合わせください。",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-luxe flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl text-gold-gradient">810Day毎日くじ</h1>
          <p className="mt-2 text-sm text-muted-foreground">X IDで参加できます。</p>
        </header>

        <div className="card-luxe rounded-2xl p-1 mb-6">
          <div className="grid grid-cols-3 rounded-xl overflow-hidden text-sm">
            {[
              ["login", "ログイン"],
              ["existing", "既存ユーザー"],
              ["new", "新規登録"],
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

          {mode === "login" && (
            <Field
              label="パスワード"
              value={password}
              onChange={setPassword}
              placeholder="管理者または変更済みユーザーのみ"
              type="password"
              required={isAdminXId(normalizeXId(xid))}
            />
          )}

          {mode === "existing" && (
            <Field
              label="これまでの参加回数"
              value={past}
              onChange={(v) => setPast(v.replace(/[^0-9]/g, ""))}
              placeholder="例: 34"
              inputMode="numeric"
            />
          )}

          <button type="submit" disabled={loading} className="btn-gold w-full rounded-lg py-3 font-display text-base disabled:opacity-60">
            {loading ? "処理中..." : mode === "login" ? "ログイン" : mode === "existing" ? "確認してログイン" : "登録して開始"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          管理アカウントはX IDと管理者パスワードでログインできます。
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
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">{label}</label>
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none focus:border-[oklch(0.82_0.15_88)] transition"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required={required}
      />
    </div>
  );
}
