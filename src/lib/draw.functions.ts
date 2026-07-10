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
        "id,draw_date,executed_at,daily_winner_user_id,daily_winner_by_gauge,daily_participants_count,follow_winner_user_id,follow_winner_by_gauge,follow_participants_count",
      )
      .order("draw_date", { ascending: false })
      .limit(data.limit);
    if (error) throw error;

    const drawIds = (draws ?? []).map((d: any) => d.id);
    const { data: winners, error: wErr } = drawIds.length
      ? await supabaseAdmin
          .from("lottery_winners")
          .select("draw_id,user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu")
          .in("draw_id", drawIds)
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
      .maybeSingle();
    if (drawErr) throw drawErr;
    if (!draw) return { date, draw: null, winners: [], myWin: null, seen: true };

    const { data: winners, error: wErr } = await supabaseAdmin
      .from("lottery_winners")
      .select("user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu")
      .eq("draw_id", draw.id);
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
        "id,draw_date,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu,sol_address,discord_id,created_at",
      )
      .order("draw_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { winners: data ?? [] };
  });
