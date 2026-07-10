import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("管理者権限がありません");
}

export const adminSearchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ q: z.string().default("") }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = data.q.trim().replace(/^@/, "").toLowerCase();
    let query = supabaseAdmin
      .from("profiles")
      .select(
        "id,x_id_display,x_id_normalized,participation_count,win_count,redemption_rate,confirm_gauge,sol_address,discord_id,official_follow_registered,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (q) query = query.ilike("x_id_normalized", `%${q}%`);
    const { data: rows, error } = await query;
    if (error) throw error;
    return { users: rows ?? [] };
  });

export const adminUpdateXId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        user_id: z.string().uuid(),
        x_id_display: z.string().min(1).max(20),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const normalized = data.x_id_display.trim().replace(/^@+/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(normalized)) {
      return { ok: false as const, reason: "invalid_format" as const };
    }
    const { data: dup } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("x_id_normalized", normalized)
      .neq("id", data.user_id)
      .maybeSingle();
    if (dup) return { ok: false as const, reason: "duplicate" as const };

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ x_id_display: data.x_id_display.trim(), x_id_normalized: normalized })
      .eq("id", data.user_id);
    if (error) throw error;
    return { ok: true as const };
  });

export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });
