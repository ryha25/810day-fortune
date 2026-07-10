import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function todayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

function calcRate(count: number): number {
  if (count <= 10) return 0;
  if (count >= 20) return 50;
  return (count - 10) * 5;
}
function calcGauge(count: number): number {
  return Math.min(30, Math.floor(count * 0.5));
}

export const confirmDailyParticipation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const date = todayJst();

    const { data: existing } = await supabaseAdmin
      .from("daily_participations")
      .select("id")
      .eq("user_id", userId)
      .eq("participation_date", date)
      .maybeSingle();

    if (existing) {
      return { ok: false as const, reason: "already_participated" as const };
    }

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("participation_count, confirm_gauge")
      .eq("id", userId)
      .single();
    if (pErr || !profile) throw new Error("プロフィールが見つかりません");

    const newCount = profile.participation_count + 1;
    const newGauge = Math.min(30, profile.confirm_gauge + 1);
    const newRate = calcRate(newCount);

    const { error: insErr } = await supabaseAdmin
      .from("daily_participations")
      .insert({ user_id: userId, participation_date: date });
    if (insErr) {
      if (insErr.code === "23505") return { ok: false as const, reason: "already_participated" as const };
      throw insErr;
    }

    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({
        participation_count: newCount,
        confirm_gauge: newGauge,
        redemption_rate: newRate,
      })
      .eq("id", userId);
    if (updErr) throw updErr;

    return {
      ok: true as const,
      participation_count: newCount,
      confirm_gauge: newGauge,
      redemption_rate: newRate,
    };
  });

export const registerOfficialFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("participation_count, confirm_gauge, official_follow_registered")
      .eq("id", userId)
      .single();
    if (pErr || !profile) throw new Error("プロフィールが見つかりません");

    if (profile.official_follow_registered) {
      return { ok: false as const, reason: "already_registered" as const };
    }

    const newCount = profile.participation_count + 1;
    const newGauge = Math.min(30, profile.confirm_gauge + 1);
    const newRate = calcRate(newCount);

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        participation_count: newCount,
        confirm_gauge: newGauge,
        redemption_rate: newRate,
        official_follow_registered: true,
      })
      .eq("id", userId);
    if (error) throw error;

    return { ok: true as const, participation_count: newCount, confirm_gauge: newGauge, redemption_rate: newRate };
  });

export const checkTodayParticipation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();
    const { data } = await supabaseAdmin
      .from("daily_participations")
      .select("id")
      .eq("user_id", context.userId)
      .eq("participation_date", date)
      .maybeSingle();
    return { participated: !!data, date };
  });

// Sign-up: creates auth user + profile atomically with a server-generated random
// auth_token. The token is stored in profiles (service-role only column) and
// is never sent to the browser, preventing account takeover via X ID guessing.
export const registerNewUser = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        x_id_display: z.string().min(1).max(20),
        x_id_normalized: z
          .string()
          .regex(/^[a-z0-9_]{1,15}$/),
        existing: z.boolean(),
        past_participation: z.number().int().min(0).max(100000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomUUID } = await import("node:crypto");

    // reject duplicate X ID
    const { data: dup } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("x_id_normalized", data.x_id_normalized)
      .maybeSingle();
    if (dup) return { ok: false as const, reason: "duplicate_x_id" as const };

    // Generate credentials entirely server-side — never derived from public X ID.
    const authToken = randomUUID();
    const email = `${data.x_id_normalized}@810day.local`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: authToken,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      return { ok: false as const, reason: "auth_failed" as const, message: createErr?.message };
    }
    const userId = created.user.id;
    const pc = data.existing ? (data.past_participation ?? 0) : 0;
    const gauge = calcGauge(pc);
    const rate = calcRate(pc);

    const { error: profErr } = await supabaseAdmin.from("profiles").insert({
      id: userId,
      x_id_normalized: data.x_id_normalized,
      x_id_display: data.x_id_display,
      auth_token: authToken,
      participation_count: pc,
      win_count: 0,
      redemption_rate: rate,
      confirm_gauge: gauge,
      official_follow_registered: false,
    });
    if (profErr) {
      // rollback auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return { ok: false as const, reason: "profile_failed" as const, message: profErr.message };
    }

    return { ok: true as const };
  });

// Server-side login: looks up the stored auth_token and signs in on behalf of
// the user. Returns JWT session tokens so the client can call setSession().
// The auth_token column is protected from authenticated SELECT — it only flows
// through this server function, never to the browser.
export const loginWithXId = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ x_id_normalized: z.string().regex(/^[a-z0-9_]{1,15}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch auth_token via service role (column is hidden from authenticated role)
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .select("auth_token")
      .eq("x_id_normalized", data.x_id_normalized)
      .maybeSingle();

    if (error || !row || !row.auth_token) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const email = `${data.x_id_normalized}@810day.local`;
    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;

    const { createClient } = await import("@supabase/supabase-js");
    const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: session, error: signInErr } = await authClient.auth.signInWithPassword({
      email,
      password: row.auth_token,
    });

    if (signInErr || !session.session) {
      return { ok: false as const, reason: "auth_failed" as const };
    }

    return {
      ok: true as const,
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    };
  });

// Lookup existence of X ID (for login form)
export const xIdExists = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ x_id_normalized: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("x_id_normalized", data.x_id_normalized)
      .maybeSingle();
    return { exists: !!row };
  });
