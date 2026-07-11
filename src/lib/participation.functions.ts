import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { xIdToEmail, xIdToPassword } from "@/lib/xid";

function logSupabaseError(scope: string, error: any) {
  if (!error) return;
  console.error(`[${scope}] Supabase error`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
    status: error.status,
  });
}

function logUnexpectedError(scope: string, error: unknown) {
  console.error(`[${scope}] Unexpected error`, error);
}

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

async function hasAuthTokenColumn(supabaseAdmin: any): Promise<boolean> {
  const { error } = await supabaseAdmin.from("profiles").select("auth_token").limit(1);
  if (!error) return true;
  return !(error.code === "42703" || /auth_token/i.test(error.message ?? ""));
}

async function hasProfileColumn(supabaseAdmin: any, column: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from("profiles").select(column).limit(1);
  if (!error) return true;
  return !(error.code === "42703" || new RegExp(column, "i").test(error.message ?? ""));
}

async function ensureAdminRoleForKnownAccount(supabaseAdmin: any, userId: string, xId: string) {
  if (xId !== "ryuyah25") return;
  const { error } = await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
  logSupabaseError("ensureAdminRoleForKnownAccount", error);
}

function isKnownAdminXId(xId: string): boolean {
  return xId === "ryuyah25";
}

type ExistingParticipantSeed = {
  x_id_display: string;
  participation_count: number;
  win_count: number;
  confirm_gauge: number;
  redemption_rate: number;
};

async function getExistingParticipantSeed(
  supabaseAdmin: any,
  normalizedXId: string,
): Promise<ExistingParticipantSeed | null> {
  const { data, error } = await supabaseAdmin
    .from("existing_participants")
    .select("x_id_display,participation_count,win_count,confirm_gauge,redemption_rate")
    .eq("x_id_normalized", normalizedXId)
    .maybeSingle();

  if (!error) return data ?? null;
  if (error.code === "42P01" || error.code === "42703" || /existing_participants/i.test(error.message ?? "")) {
    return null;
  }
  throw error;
}

async function deleteOrphanAuthUserByEmail(supabaseAdmin: any, email: string) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return false;
  const user = data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) return false;
  const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  return !deleteErr;
}

export const confirmDailyParticipation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("record_daily_post_participation", {
      _user_id: context.userId,
      _participation_date: todayJst(),
    });
    if (error) {
      logSupabaseError("confirmDailyParticipation.recordDailyPostParticipation", error);
      throw error;
    }
    if (data?.ok === false && data.reason === "cutoff_passed") {
      throw new Error(`参加締切を過ぎています（${String(data.cutoff_time_jst).slice(0, 5)} JST）`);
    }
    return data as {
      ok: true;
      daily_participated: true;
      daily_inserted: boolean;
      participation_count: number;
      confirm_gauge: number;
      redemption_rate: number;
      win_count: number;
      participation_date: string;
    };
  });

export const registerOfficialFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("register_official_follow_participation", {
      _user_id: context.userId,
      _participation_date: todayJst(),
    });
    if (error) {
      logSupabaseError("registerOfficialFollow.registerOfficialFollowParticipation", error);
      throw error;
    }
    return data as {
      ok: true;
      official_follow_registered: true;
      follow_first_registered: boolean;
      participation_count: number;
      confirm_gauge: number;
      redemption_rate: number;
      win_count: number;
      participation_date: string;
    };
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

export const registerNewUser = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        x_id_display: z.string().min(1).max(20),
        x_id_normalized: z.string().regex(/^[a-z0-9_]{1,15}$/),
        existing: z.boolean(),
        past_participation: z.number().int().min(0).max(100000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { randomUUID } = await import("node:crypto");

      const { data: dup, error: dupErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("x_id_normalized", data.x_id_normalized)
        .maybeSingle();
      if (dupErr) {
        logSupabaseError("registerNewUser.duplicateCheck", dupErr);
        return { ok: false as const, reason: "profile_failed" as const };
      }
      if (dup) return { ok: false as const, reason: "duplicate_x_id" as const };

      const seed = await getExistingParticipantSeed(supabaseAdmin, data.x_id_normalized);
      if (data.existing) {
        if (!seed) return { ok: false as const, reason: "existing_not_found" as const };
        if (data.past_participation !== seed.participation_count) {
          return { ok: false as const, reason: "participation_mismatch" as const };
        }
      } else if (seed) {
        return { ok: false as const, reason: "existing_participant" as const };
      }

      const canUseAuthToken = await hasAuthTokenColumn(supabaseAdmin);
      const hasAuthUserId = await hasProfileColumn(supabaseAdmin, "auth_user_id");
      const hasRole = await hasProfileColumn(supabaseAdmin, "role");
      const authToken = randomUUID();
      const email = xIdToEmail(data.x_id_normalized);
      const password = canUseAuthToken ? authToken : xIdToPassword(data.x_id_normalized);

      let { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr && /already|registered|exists/i.test(createErr.message ?? "")) {
        const cleaned = await deleteOrphanAuthUserByEmail(supabaseAdmin, email);
        if (cleaned) {
          const retry = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
          created = retry.data;
          createErr = retry.error;
        }
      }
      if (createErr || !created.user) {
        logSupabaseError("registerNewUser.createAuthUser", createErr);
        return { ok: false as const, reason: "auth_failed" as const };
      }

      const userId = created.user.id;
      const pc = seed?.participation_count ?? 0;
      const gauge = seed?.confirm_gauge ?? calcGauge(pc);
      const rate = seed?.redemption_rate ?? calcRate(pc);
      const displayXId = seed?.x_id_display ?? `@${data.x_id_normalized}`;

      const { error: profErr } = await supabaseAdmin.from("profiles").insert({
        id: userId,
        ...(hasAuthUserId ? { auth_user_id: userId } : {}),
        x_id_normalized: data.x_id_normalized,
        x_id_display: displayXId,
        ...(hasRole ? { role: "user" } : {}),
        ...(canUseAuthToken ? { auth_token: authToken } : {}),
        participation_count: pc,
        win_count: seed?.win_count ?? 0,
        redemption_rate: rate,
        confirm_gauge: gauge,
        official_follow_registered: false,
      });
      if (profErr) {
        logSupabaseError("registerNewUser.insertProfile", profErr);
        await supabaseAdmin.auth.admin.deleteUser(userId);
        if (profErr.code === "23505" || /duplicate|unique/i.test(profErr.message ?? "")) {
          return { ok: false as const, reason: "duplicate_x_id" as const };
        }
        return { ok: false as const, reason: "profile_failed" as const };
      }

      await ensureAdminRoleForKnownAccount(supabaseAdmin, userId, data.x_id_normalized);

      return { ok: true as const };
    } catch (error) {
      logUnexpectedError("registerNewUser", error);
      return { ok: false as const, reason: "profile_failed" as const };
    }
  });

export const loginWithXId = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        x_id_normalized: z.string().regex(/^[a-z0-9_]{1,15}$/),
        past_participation: z.number().int().min(0).max(100000).optional(),
        password: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    let supabaseAdmin: any;
    try {
      ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
    } catch (error) {
      logUnexpectedError("loginWithXId.importSupabase", error);
      return { ok: false as const, reason: "network_error" as const };
    }

    const canUseAuthToken = await hasAuthTokenColumn(supabaseAdmin);
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .select(canUseAuthToken ? "id,auth_token,participation_count" : "id,participation_count")
      .eq("x_id_normalized", data.x_id_normalized)
      .maybeSingle();

    if (error) {
      logSupabaseError("loginWithXId.findProfile", error);
      return { ok: false as const, reason: "not_found" as const };
    }

    if (data.past_participation !== undefined) {
      if (row) {
        if (row.participation_count !== data.past_participation) {
          return { ok: false as const, reason: "participation_mismatch" as const };
        }
      } else {
        const seed = await getExistingParticipantSeed(supabaseAdmin, data.x_id_normalized);
        if (!seed) return { ok: false as const, reason: "existing_not_found" as const };
        if (seed.participation_count !== data.past_participation) {
          return { ok: false as const, reason: "participation_mismatch" as const };
        }
      }
    }

    if (!row) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    const isAdminPasswordLogin =
      !!data.password &&
      isKnownAdminXId(data.x_id_normalized) &&
      !!adminPassword &&
      data.password === adminPassword;

    if (data.password && isKnownAdminXId(data.x_id_normalized) && !adminPassword) {
      return { ok: false as const, reason: "admin_password_not_configured" as const };
    }

    const defaultPassword = canUseAuthToken && row.auth_token ? row.auth_token : xIdToPassword(data.x_id_normalized);
    let password = data.password || defaultPassword;
    if (isAdminPasswordLogin) {
      const { error: updatePasswordErr } = await supabaseAdmin.auth.admin.updateUserById(row.id, {
        password: adminPassword,
      });
      if (updatePasswordErr) {
        logSupabaseError("loginWithXId.updateAdminPassword", updatePasswordErr);
        return { ok: false as const, reason: "auth_failed" as const };
      }
      if (canUseAuthToken) {
        await supabaseAdmin.from("profiles").update({ auth_token: null }).eq("id", row.id);
      }
      password = adminPassword;
    }
    if (!password) return { ok: false as const, reason: "password_required" as const };

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const { createClient } = await import("@supabase/supabase-js");
    const { default: WebSocket } = await import("ws");
    const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      realtime: { transport: WebSocket as any },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    let { data: session, error: signInErr } = await authClient.auth.signInWithPassword({
      email: xIdToEmail(data.x_id_normalized),
      password,
    });

    if (signInErr && data.password && !isKnownAdminXId(data.x_id_normalized) && defaultPassword && defaultPassword !== data.password) {
      const retry = await authClient.auth.signInWithPassword({
        email: xIdToEmail(data.x_id_normalized),
        password: defaultPassword,
      });
      session = retry.data;
      signInErr = retry.error;
    }

    if (signInErr || !session.session) {
      logSupabaseError("loginWithXId.signInWithPassword", signInErr);
      return { ok: false as const, reason: "auth_failed" as const };
    }

    await ensureAdminRoleForKnownAccount(supabaseAdmin, row.id, data.x_id_normalized);

    return {
      ok: true as const,
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
    };
  });

export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        current_password: z.string().min(1),
        new_password: z.string().min(8).max(128),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id,x_id_normalized")
      .eq("id", context.userId)
      .single();
    if (profileErr || !profile) throw new Error("プロフィールが見つかりません");

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const { createClient } = await import("@supabase/supabase-js");
    const { default: WebSocket } = await import("ws");
    const authClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      realtime: { transport: WebSocket as any },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { error: signInErr } = await authClient.auth.signInWithPassword({
      email: xIdToEmail(profile.x_id_normalized),
      password: data.current_password,
    });
    if (signInErr) return { ok: false as const, reason: "current_password_invalid" as const };

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.new_password,
    });
    if (updateErr) throw updateErr;

    const canUseAuthToken = await hasAuthTokenColumn(supabaseAdmin);
    if (canUseAuthToken) {
      await supabaseAdmin.from("profiles").update({ auth_token: null }).eq("id", context.userId);
    }

    return { ok: true as const };
  });

export const xIdExists = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ x_id_normalized: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("x_id_normalized", data.x_id_normalized)
      .maybeSingle();
    return { exists: !!row };
  });
