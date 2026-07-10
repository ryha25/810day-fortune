import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function todayJst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("管理者権限がありません");
}

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
    const { data: draw, error: drawErr } = await supabaseAdmin
      .from("lottery_draws")
      .select(
        "id,draw_date,executed_at,daily_winner_user_id,daily_winner_by_gauge,follow_winner_user_id,follow_winner_by_gauge",
      )
      .eq("draw_date", date)
      .eq("is_test", false)
      .is("canceled_at", null)
      .maybeSingle();
    if (drawErr) throw drawErr;
    if (!draw) return { date, draw: null, winners: [], myWin: null, seen: true };

    const { data: winners, error: wErr } = await supabaseAdmin
      .from("lottery_winners")
      .select("user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu")
      .eq("draw_id", draw.id)
      .eq("is_test", false)
      .is("canceled_at", null);
    if (wErr) throw wErr;

    const mine = (winners ?? []).find((w: any) => w.user_id === context.userId) ?? null;
    const { data: seenRow } = await supabaseAdmin
      .from("lottery_result_views")
      .select("seen_at")
      .eq("draw_id", draw.id)
      .eq("user_id", context.userId)
      .maybeSingle();

    return { date, draw, winners: winners ?? [], myWin: mine, seen: !!seenRow };
  });

export const markDrawSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ draw_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("lottery_result_views")
      .upsert({ draw_id: data.draw_id, user_id: context.userId, seen_at: new Date().toISOString() });
    if (error) throw error;
    return { ok: true as const };
  });

export const adminTodayEligible = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();

    const { data: dailyRows, error: dailyErr } = await supabaseAdmin
      .from("daily_participations")
      .select("user_id, profiles!inner(x_id_display,x_id_normalized,confirm_gauge,redemption_rate)")
      .eq("participation_date", date);
    if (dailyErr) throw dailyErr;

    const { data: followRows, error: followErr } = await supabaseAdmin
      .from("profiles")
      .select("id,x_id_display,x_id_normalized,confirm_gauge,redemption_rate")
      .eq("official_follow_registered", true)
      .order("x_id_normalized", { ascending: true });
    if (followErr) throw followErr;

    const daily = (dailyRows ?? []).map((r: any) => ({
      user_id: r.user_id,
      x_id_display: r.profiles.x_id_display,
      x_id_normalized: r.profiles.x_id_normalized,
      confirm_gauge: r.profiles.confirm_gauge,
      redemption_rate: r.profiles.redemption_rate,
    }));

    return { date, daily, follow: followRows ?? [] };
  });

export const adminListWinners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("lottery_winners")
      .select(
        "id,draw_id,draw_date,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,sol_address,discord_id,is_test,canceled_at,created_at",
      )
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
      .select(
        "id,x_id_display,x_id_normalized,participation_count,win_count,redemption_rate,confirm_gauge,official_follow_registered,sol_address,discord_id,created_at",
      );
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
        ? supabaseAdmin.from("daily_participations").select("user_id").eq("participation_date", date).in("user_id", userIds)
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
