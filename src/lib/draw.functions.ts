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
/** Run the draw for a given (or today's) JST date. Idempotent via unique(draw_date). */
export const runDrawNow = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ draw_date: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("run_daily_draw", {
      _draw_date: data.draw_date ?? null,
    });
    if (error) throw error;
    return res as {
      ok: boolean;
      reason?: string;
      draw_date: string;
      draw_id?: string;
      daily_winner?: string | null;
      follow_winner?: string | null;
      w_win?: boolean;
      daily_by_gauge?: boolean;
      follow_by_gauge?: boolean;
    };
  });
/** Public: latest N draws with winner summary (safe columns only). */
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
    const drawIds = (draws ?? []).map((d) => d.id);
    let winners: Array<{
      draw_id: string;
      user_id: string;
      x_id_display: string;
      x_id_normalized: string;
      kind: string;
      slot: string;
      by_gauge: boolean;
      redemption_rate: number;
      reward_inmu: number;
    }> = [];
    if (drawIds.length) {
      const { data: w, error: wErr } = await supabaseAdmin
        .from("lottery_winners")
        .select("draw_id,user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu")
        .in("draw_id", drawIds);
      if (wErr) throw wErr;
      winners = w ?? [];
    }
    return { draws: draws ?? [], winners };
  });
/** Signed-in user: personal history (all past wins). */
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
/** Signed-in user: today's draw result summary + whether they won. */
export const getTodayDrawForMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();
    const { data: draw } = await supabaseAdmin
      .from("lottery_draws")
      .select(
        "id,draw_date,executed_at,daily_winner_user_id,daily_winner_by_gauge,follow_winner_user_id,follow_winner_by_gauge",
      )
      .eq("draw_date", date)
      .maybeSingle();
    if (!draw) return { date, draw: null, winners: [], myWin: null };
    const { data: winners } = await supabaseAdmin
      .from("lottery_winners")
      .select("user_id,x_id_display,x_id_normalized,kind,slot,by_gauge,redemption_rate,reward_inmu")
      .eq("draw_id", draw.id);
    const mine = (winners ?? []).find((w) => w.user_id === context.userId) ?? null;
    return { date, draw, winners: winners ?? [], myWin: mine };
  });
// ============ ADMIN ============
/** Admin: today's eligible users grouped by slot. */
export const adminTodayEligible = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const date = todayJst();
    const { data: dailyRows } = await supabaseAdmin
      .from("daily_participations")
      .select("user_id, profiles!inner(x_id_display,x_id_normalized,confirm_gauge,redemption_rate)")
      .eq("participation_date", date);
    const { data: followRows } = await supabaseAdmin
      .from("profiles")
      .select("id,x_id_display,x_id_normalized,confirm_gauge,redemption_rate")
      .eq("official_follow_registered", true);
    const daily = (dailyRows ?? []).map((r: any) => ({
      user_id: r.user_id,
      x_id_display: r.profiles.x_id_display,
      x_id_normalized: r.profiles.x_id_normalized,
      confirm_gauge: r.profiles.confirm_gauge,
      redemption_rate: r.profiles.redemption_rate,
    }));
    return { date, daily, follow: followRows ?? [] };
  });
/** Admin: all winners with sensitive columns (SOL / Discord). */
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
export const adminManualRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ draw_date: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: res, error } = await supabaseAdmin.rpc("run_daily_draw", {
      _draw_date: data.draw_date ?? null,
    });
    if (error) throw error;
    return res;
  });
