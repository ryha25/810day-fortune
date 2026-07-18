import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function todayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

const DEFAULT_LOTTERY_SETTINGS = {
  draw_time_jst: "12:00",
  participation_cutoff_time_jst: "11:59",
  normal_base_reward_inmu: 10000,
  w_reward_inmu: 200000,
};

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("管理者権限がありません");
}

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ password: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) return { ok: false as const, reason: "not_configured" as const };
    const ok = data.password === expected;
    return { ok, reason: ok ? null : ("invalid_password" as const) };
  });

export const getLotterySettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("lottery_settings")
    .select("draw_time_jst,participation_cutoff_time_jst,normal_base_reward_inmu,w_reward_inmu,updated_at")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.code === "42703") return DEFAULT_LOTTERY_SETTINGS;
    throw error;
  }

  return {
    ...DEFAULT_LOTTERY_SETTINGS,
    ...(data ?? {}),
  };
});

export const adminUpdateLotterySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        draw_time_jst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        participation_cutoff_time_jst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        normal_base_reward_inmu: z.number().int().min(0).max(1000000000),
        w_reward_inmu: z.number().int().min(0).max(1000000000),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("update_lottery_settings", {
      _admin_user_id: context.userId,
      _draw_time_jst: data.draw_time_jst,
      _participation_cutoff_time_jst: data.participation_cutoff_time_jst,
      _normal_base_reward_inmu: data.normal_base_reward_inmu,
      _w_reward_inmu: data.w_reward_inmu,
    });
    if (error) throw error;
    return result as Record<string, unknown>;
  });

export const listRecentDraws = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(100).default(30) }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: draws, error } = await supabaseAdmin
      .from("lottery_draws")
      .select(
        "id,draw_date,executed_at,is_test,canceled_at,daily_winner_user_id,daily_winner_by_gauge,daily_participants_count,follow_winner_user_id,follow_winner_by_gauge,follow_participants_count",
      )
      .eq("is_test", false)
      .is("canceled_at", null)
      .order("draw_date", { ascending: false })
      .limit(data.limit);
    if (error) throw error;

    const drawIds = (draws ?? []).map((d: any) => d.id);
    const { data: winners, error: wErr } = drawIds.length
      ? await supabaseAdmin
          .from("lottery_winners")
          .select("draw_id,user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,is_test,canceled_at")
          .in("draw_id", drawIds)
          .eq("is_test", false)
          .is("canceled_at", null)
      : { data: [], error: null };
    if (wErr) throw wErr;

    return { draws: draws ?? [], winners: winners ?? [] };
  });

export const getMyWinHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("lottery_winners")
      .select("draw_id,draw_date,kind,slot,by_gauge,redemption_rate,reward_inmu,created_at")
      .eq("user_id", context.userId)
      .eq("is_test", false)
      .is("canceled_at", null)
      .order("draw_date", { ascending: false });
    if (error) throw error;
    return { wins: data ?? [] };
  });

export const getTodayDrawForMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();
    const { data: myTestWinner, error: testWinnerErr } = await supabaseAdmin
      .from("lottery_winners")
      .select("draw_id,user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,is_test")
      .eq("user_id", context.userId)
      .eq("is_test", true)
      .is("canceled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (testWinnerErr) throw testWinnerErr;

    const testDrawId = myTestWinner?.draw_id;
    const { data: testSeenRow } = testDrawId
      ? await supabaseAdmin
          .from("lottery_result_views")
          .select("seen_at,result_confirmed")
          .eq("draw_id", testDrawId)
          .eq("user_id", context.userId)
          .maybeSingle()
      : { data: null };

    if (myTestWinner && !testSeenRow?.result_confirmed) {
      const { data: testDraw, error: testDrawErr } = await supabaseAdmin
        .from("lottery_draws")
        .select("id,draw_date,executed_at,is_test,daily_winner_user_id,daily_winner_by_gauge,follow_winner_user_id,follow_winner_by_gauge")
        .eq("id", myTestWinner.draw_id)
        .eq("is_test", true)
        .is("canceled_at", null)
        .maybeSingle();
      if (testDrawErr) throw testDrawErr;

      const { data: testWinners, error: testWinnersErr } = await supabaseAdmin
        .from("lottery_winners")
        .select("user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,is_test")
        .eq("draw_id", myTestWinner.draw_id)
        .eq("is_test", true)
        .is("canceled_at", null);
      if (testWinnersErr) throw testWinnersErr;

      return {
        date,
        draw: testDraw,
        winners: testWinners ?? [],
        myWin: myTestWinner,
        seen: !!testSeenRow,
        resultConfirmed: !!testSeenRow?.result_confirmed,
        isTest: true,
      };
    }

    const { data: draw, error: drawErr } = await supabaseAdmin
      .from("lottery_draws")
      .select("id,draw_date,executed_at,is_test,daily_winner_user_id,daily_winner_by_gauge,follow_winner_user_id,follow_winner_by_gauge")
      .eq("draw_date", date)
      .eq("is_test", false)
      .is("canceled_at", null)
      .maybeSingle();
    if (drawErr) throw drawErr;
    if (!draw) return { date, draw: null, winners: [], myWin: null, seen: true, resultConfirmed: true, isTest: false };

    const { data: winners, error: wErr } = await supabaseAdmin
      .from("lottery_winners")
      .select("user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,is_test")
      .eq("draw_id", draw.id)
      .eq("is_test", false)
      .is("canceled_at", null);
    if (wErr) throw wErr;

    const mine = (winners ?? []).find((w: any) => w.user_id === context.userId) ?? null;
    const { data: seenRow } = await supabaseAdmin
      .from("lottery_result_views")
      .select("seen_at,result_confirmed")
      .eq("draw_id", draw.id)
      .eq("user_id", context.userId)
      .maybeSingle();

    return {
      date,
      draw,
      winners: winners ?? [],
      myWin: mine,
      seen: !!seenRow,
      resultConfirmed: !!seenRow?.result_confirmed,
      isTest: false,
    };
  });

export const markDrawSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ draw_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: draw, error: drawErr } = await supabaseAdmin
      .from("lottery_draws")
      .select("id,is_test")
      .eq("id", data.draw_id)
      .maybeSingle();
    if (drawErr) throw drawErr;
    if (!draw) return { ok: false, reason: "draw_not_found" };

    if (draw.is_test) {
      const { data: testWinner, error: winnerErr } = await supabaseAdmin
        .from("lottery_winners")
        .select("id")
        .eq("draw_id", data.draw_id)
        .eq("user_id", context.userId)
        .eq("is_test", true)
        .is("canceled_at", null)
        .maybeSingle();
      if (winnerErr) throw winnerErr;
      if (!testWinner) return { ok: false, reason: "winner_not_found" };

      const { error: viewErr } = await supabaseAdmin.from("lottery_result_views").upsert(
        {
          draw_id: data.draw_id,
          user_id: context.userId,
          seen_at: new Date().toISOString(),
          result_confirmed: true,
          confirmed_at: new Date().toISOString(),
        },
        { onConflict: "draw_id,user_id" },
      );
      if (viewErr) throw viewErr;
      return { ok: true, already_confirmed: false, stat_updated: false, is_test: true };
    }

    const { data: result, error } = await (supabaseAdmin as any).rpc("confirm_draw_result", {
      _user_id: context.userId,
      _draw_id: data.draw_id,
    });
    if (error) throw error;
    return result as Record<string, unknown>;
  });

export const adminTodayEligible = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();
    await (supabaseAdmin as any).rpc("record_official_follow_auto_participations", {
      _participation_date: date,
    });

    const { data: dailyRows, error: dailyErr } = await supabaseAdmin
      .from("daily_participations")
      .select("user_id, profiles!inner(x_id_display,x_id_normalized,confirm_gauge,redemption_rate)")
      .eq("participation_date", date)
      .eq("daily_post_participated", true);
    if (dailyErr) throw dailyErr;

    const { data: followRows, error: followErr } = await supabaseAdmin
      .from("daily_participations")
      .select("user_id, profiles!inner(x_id_display,x_id_normalized,confirm_gauge,redemption_rate)")
      .eq("participation_date", date)
      .eq("official_follow_participated", true);
    if (followErr) throw followErr;

    const daily = (dailyRows ?? []).map((r: any) => ({
      user_id: r.user_id,
      x_id_display: r.profiles.x_id_display,
      x_id_normalized: r.profiles.x_id_normalized,
      confirm_gauge: r.profiles.confirm_gauge,
      redemption_rate: r.profiles.redemption_rate,
    }));

    const follow = (followRows ?? []).map((r: any) => ({
      id: r.user_id,
      x_id_display: r.profiles.x_id_display,
      x_id_normalized: r.profiles.x_id_normalized,
      confirm_gauge: r.profiles.confirm_gauge,
      redemption_rate: r.profiles.redemption_rate,
    }));

    return { date, daily, follow };
  });

export const adminListWinners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("lottery_winners")
      .select("id,draw_id,draw_date,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,sol_address,discord_id,is_test,canceled_at,created_at")
      .is("canceled_at", null)
      .order("draw_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { winners: data ?? [] };
  });

export const adminListParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        q: z.string().default(""),
        sort: z.enum(["newest", "participation", "wins"]).default("newest"),
        todayOnly: z.boolean().default(false),
        followOnly: z.boolean().default(false),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();
    const q = data.q.trim().replace(/^@+/, "").toLowerCase();

    let query = supabaseAdmin
      .from("profiles")
      .select("id,x_id_display,x_id_normalized,participation_count,win_count,redemption_rate,confirm_gauge,official_follow_registered,sol_address,discord_id,created_at");
    if (q) query = query.ilike("x_id_normalized", `%${q}%`);
    if (data.followOnly) query = query.eq("official_follow_registered", true);
    if (data.sort === "participation") query = query.order("participation_count", { ascending: false });
    else if (data.sort === "wins") query = query.order("win_count", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    const { data: profiles, error } = await query.limit(300);
    if (error) throw error;
    const userIds = (profiles ?? []).map((p: any) => p.id);

    const [{ data: todayRows, error: todayErr }, { data: existingRows, error: existingErr }] = await Promise.all([
      userIds.length
        ? supabaseAdmin
            .from("daily_participations")
            .select("user_id")
            .eq("participation_date", date)
            .not("daily_post_participated_at", "is", null)
            .in("user_id", userIds)
        : { data: [], error: null },
      supabaseAdmin.from("existing_participants").select("x_id_normalized"),
    ]);
    if (todayErr) throw todayErr;
    if (existingErr && existingErr.code !== "42P01") throw existingErr;

    const todaySet = new Set((todayRows ?? []).map((r: any) => r.user_id));
    const existingSet = new Set((existingRows ?? []).map((r: any) => r.x_id_normalized));
    const users = (profiles ?? [])
      .map((p: any) => ({
        ...p,
        participant_type: existingSet.has(p.x_id_normalized) ? "existing" : "new",
        today_participated: todaySet.has(p.id),
      }))
      .filter((p: any) => !data.todayOnly || p.today_participated);

    return { date, users };
  });

export const adminUpdateParticipantStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        participation_count: z.number().int().min(0),
        win_count: z.number().int().min(0),
        redemption_rate: z.number().int().min(0).max(50),
        confirm_gauge: z.number().int().min(0).max(30),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("admin_update_profile_stats", {
      _admin_user_id: context.userId,
      _target_user_id: data.user_id,
      _participation_count: data.participation_count,
      _win_count: data.win_count,
      _redemption_rate: data.redemption_rate,
      _confirm_gauge: data.confirm_gauge,
    });
    if (error) throw error;
    return result as { ok: true };
  });

export const adminDeleteParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      return { ok: false as const, reason: "self_delete_blocked" as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRole, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw roleErr;
    if (targetRole) return { ok: false as const, reason: "admin_delete_blocked" as const };

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id,x_id_normalized")
      .eq("id", data.user_id)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) return { ok: false as const, reason: "not_found" as const };

    const { error: dailyDrawErr } = await supabaseAdmin
      .from("lottery_draws")
      .update({ daily_winner_user_id: null })
      .eq("daily_winner_user_id", data.user_id);
    if (dailyDrawErr) throw dailyDrawErr;

    const { error: followDrawErr } = await supabaseAdmin
      .from("lottery_draws")
      .update({ follow_winner_user_id: null })
      .eq("follow_winner_user_id", data.user_id);
    if (followDrawErr) throw followDrawErr;

    const { error: deleteAuthErr } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (deleteAuthErr) throw deleteAuthErr;

    return { ok: true as const, deleted_x_id: profile.x_id_normalized as string };
  });

export const adminRunTestDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any).rpc("run_test_draw", { _draw_date: todayJst() });
    if (error) throw error;
    return data as Record<string, unknown>;
  });

export const adminCancelTestDraw = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ draw_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("cancel_test_draw", { _draw_id: data.draw_id });
    if (error) throw error;
    return result as Record<string, unknown>;
  });
