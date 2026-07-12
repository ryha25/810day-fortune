import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";

  return {
    publicKey,
    enabled: !!publicKey && !!privateKey,
    missing: [
      !publicKey ? "VAPID_PUBLIC_KEY" : null,
      !privateKey ? "VAPID_PRIVATE_KEY" : null,
    ].filter(Boolean),
  };
});

export const getMyPushStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error } = await (supabaseAdmin as any)
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("enabled", true);
    if (error) {
      if (error.code === "42P01") return { enabled: false, configured: false };
      throw error;
    }
    return { enabled: (count ?? 0) > 0, configured: true };
  });

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        subscription: subscriptionSchema,
        user_agent: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        endpoint: data.subscription.endpoint,
        p256dh: data.subscription.keys.p256dh,
        auth: data.subscription.keys.auth,
        user_agent: data.user_agent ?? null,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
    return { ok: true as const };
  });

export const disablePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ endpoint: z.string().url().optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = (supabaseAdmin as any)
      .from("push_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    if (data.endpoint) query = query.eq("endpoint", data.endpoint);
    const { error } = await query;
    if (error) throw error;
    return { ok: true as const };
  });
