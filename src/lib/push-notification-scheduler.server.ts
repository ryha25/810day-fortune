import * as webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type PushEventType = "new_day" | "cutoff_10min" | "cutoff_closed" | "draw_result";

const POLL_INTERVAL_MS = 60_000;
const WINDOW_MS = 90_000;
const TITLE = "\u0038\u0031\u0030\u0044\u0061\u0079\u6bce\u65e5\u304f\u3058";

let started = false;
let running = false;

export function startPushNotificationScheduler() {
  if (started || typeof process === "undefined") return;
  started = true;

  void runOnce();
  const interval = setInterval(() => void runOnce(), POLL_INTERVAL_MS);
  (interval as any).unref?.();
}

async function runOnce() {
  if (running) return;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  running = true;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:admin@810day.local",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );

    const now = new Date();
    const date = jstDate(now);
    const settings = await getLotterySettings();
    const newDayAt = jstDateTime(date, "00:00");
    const cutoffAt = jstDateTime(date, settings.participation_cutoff_time_jst ?? "11:59");
    const tenMinBeforeCutoff = new Date(cutoffAt.getTime() - 10 * 60_000);

    if (isWithinWindow(now, newDayAt)) {
      await sendEventOnce("new_day", date, newDayAt, {
        title: TITLE,
        body: "日付が変わりました。本日の810Day毎日くじに参加できます。",
        url: "/dashboard",
      });
    }

    if (isWithinWindow(now, tenMinBeforeCutoff)) {
      await sendEventOnce("cutoff_10min", date, tenMinBeforeCutoff, {
        title: TITLE,
        body: "\u62bd\u9078\u7de0\u5207\u307e\u3067\u3042\u3068\u0031\u0030\u5206\u3067\u3059\u3002",
        url: "/dashboard",
      });
    }

    if (isWithinWindow(now, cutoffAt)) {
      await sendEventOnce("cutoff_closed", date, cutoffAt, {
        title: TITLE,
        body: "\u672c\u65e5\u306e\u304f\u3058\u306f\u7de0\u3081\u5207\u308a\u307e\u3057\u305f\u3002",
        url: "/dashboard",
      });
    }

    const draw = await getProductionDraw(date);
    if (draw?.executed_at) {
      await sendEventOnce("draw_result", date, new Date(draw.executed_at), {
        title: TITLE,
        body: "\u672c\u65e5\u306e\u62bd\u9078\u7d50\u679c\u304c\u767a\u8868\u3055\u308c\u307e\u3057\u305f\u3002",
        url: "/dashboard",
      });
    }
  } catch (error) {
    console.error("[push] scheduler failed", error);
  } finally {
    running = false;
  }
}

async function getLotterySettings() {
  const { data, error } = await (supabaseAdmin as any)
    .from("lottery_settings")
    .select("participation_cutoff_time_jst")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "42703") return { participation_cutoff_time_jst: "11:59" };
    throw error;
  }
  return data ?? { participation_cutoff_time_jst: "11:59" };
}

async function getProductionDraw(date: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from("lottery_draws")
    .select("id,executed_at")
    .eq("draw_date", date)
    .eq("is_test", false)
    .is("canceled_at", null)
    .maybeSingle();
  if (error) {
    if (error.code === "42703") {
      const fallback = await (supabaseAdmin as any)
        .from("lottery_draws")
        .select("id,executed_at")
        .eq("draw_date", date)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      return fallback.data;
    }
    throw error;
  }
  return data;
}

async function sendEventOnce(
  eventType: PushEventType,
  eventDate: string,
  scheduledAt: Date,
  payload: { title: string; body: string; url: string },
) {
  const { data: event, error: eventErr } = await (supabaseAdmin as any)
    .from("push_notification_events")
    .insert({
      event_type: eventType,
      event_date: eventDate,
      scheduled_at_jst: scheduledAt.toISOString(),
    })
    .select("id")
    .single();

  if (eventErr) {
    if (eventErr.code === "23505") return;
    if (eventErr.code === "42P01") {
      console.warn("[push] notification tables are not migrated yet");
      return;
    }
    throw eventErr;
  }

  const { data: subscriptions, error: subErr } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("enabled", true);
  if (subErr) throw subErr;

  await Promise.all(
    (subscriptions ?? []).map(async (subscription: any) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify(payload),
        );
        await recordDelivery(event.id, subscription, "sent");
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await (supabaseAdmin as any)
            .from("push_subscriptions")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", subscription.id);
        }
        await recordDelivery(event.id, subscription, "failed", String(error?.message ?? error));
      }
    }),
  );
}

async function recordDelivery(eventId: string, subscription: any, status: "sent" | "failed", errorMessage?: string) {
  const { error } = await (supabaseAdmin as any).from("push_notification_deliveries").upsert(
    {
      event_id: eventId,
      subscription_id: subscription.id,
      user_id: subscription.user_id,
      status,
      error_message: errorMessage ?? null,
    },
    { onConflict: "event_id,subscription_id" },
  );
  if (error) console.error("[push] failed to record delivery", error);
}

function isWithinWindow(now: Date, target: Date) {
  const diff = now.getTime() - target.getTime();
  return diff >= 0 && diff <= WINDOW_MS;
}

function jstDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function jstDateTime(date: string, time: string) {
  const normalizedTime = time.slice(0, 5);
  return new Date(`${date}T${normalizedTime}:00+09:00`);
}
