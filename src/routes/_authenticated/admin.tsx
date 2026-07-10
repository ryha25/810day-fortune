import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import { adminListWinners, adminTodayEligible, listRecentDraws } from "@/lib/draw.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "管理 | 810Day毎日くじ" }, { name: "robots", content: "noindex" }] }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "admin").maybeSingle();
    if (!role) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

function AdminPage() {
  const eligibleFn = useServerFn(adminTodayEligible);
  const recentFn = useServerFn(listRecentDraws);
  const winnersFn = useServerFn(adminListWinners);
  const { data: eligible } = useQuery({ queryKey: ["admin-eligible"], queryFn: () => eligibleFn() });
  const { data: recent } = useQuery({ queryKey: ["admin-recent-draws"], queryFn: () => recentFn({ data: { limit: 100 } }) });
  const { data: winnerData } = useQuery({ queryKey: ["admin-winners"], queryFn: () => winnersFn() });
  const winners = winnerData?.winners ?? [];

  return (
    <main className="min-h-screen bg-luxe pb-28">
      <div className="mx-auto max-w-md px-4 pt-8 space-y-5">
        <h1 className="font-display text-3xl text-gold-gradient text-center">管理</h1>

        <section className="card-luxe rounded-2xl p-5">
          <h2 className="font-display text-xl text-gold-gradient mb-3">当日の抽選対象者</h2>
          <p className="text-xs text-muted-foreground mb-3">抽選日: {eligible?.date ?? "-"}</p>
          <EligibleList title="毎日投稿枠" rows={eligible?.daily ?? []} />
          <EligibleList title="公式Xフォロー枠" rows={eligible?.follow ?? []} />
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl text-gold-gradient">抽選結果 / 履歴</h2>
          {recent?.draws.map((draw: any) => {
            const drawWinners = (recent.winners ?? []).filter((winner: any) => winner.draw_id === draw.id);
            const w = drawWinners.find((winner: any) => winner.kind === "w");
            const daily = w ?? drawWinners.find((winner: any) => winner.slot === "daily");
            const follow = w ?? drawWinners.find((winner: any) => winner.slot === "follow");
            return (
              <article key={draw.id} className="card-luxe rounded-2xl p-4 text-sm space-y-2">
                <div className="flex justify-between gap-3">
                  <span className="font-display text-lg">{draw.draw_date}</span>
                  <span>{w ? "W当選" : "通常当選"}</span>
                </div>
                <Line label="毎日投稿枠" value={formatWinner(daily)} />
                <Line label="公式Xフォロー枠" value={formatWinner(follow)} />
                <Line label="抽選時点の報酬" value={drawWinners.map((winner: any) => `${winner.reward_inmu.toLocaleString()} INMU`).join(" / ") || "-"} />
              </article>
            );
          })}
          {recent && recent.draws.length === 0 && <p className="text-sm text-muted-foreground">抽選履歴はまだありません。</p>}
        </section>

        <section className="card-luxe rounded-2xl p-5">
          <h2 className="font-display text-xl text-gold-gradient mb-3">W当選一覧</h2>
          <WinnerRows winners={winners.filter((winner: any) => winner.kind === "w")} compact />
        </section>

        <section className="card-luxe rounded-2xl p-5">
          <h2 className="font-display text-xl text-gold-gradient mb-3">当選者一覧</h2>
          <WinnerRows winners={winners} />
        </section>
      </div>
      <BottomNav />
    </main>
  );
}

function EligibleList({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.user_id ?? row.id} className="rounded-lg border border-[oklch(0.55_0.12_82/0.25)] px-3 py-2 text-xs">
            <div>@{row.x_id_normalized}</div>
            <div className="text-muted-foreground">ゲージ {row.confirm_gauge}/30 / 還元率 {row.redemption_rate}%</div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted-foreground">対象者はいません。</p>}
      </div>
    </div>
  );
}

function WinnerRows({ winners, compact = false }: { winners: any[]; compact?: boolean }) {
  if (winners.length === 0) return <p className="text-sm text-muted-foreground">該当なし</p>;
  return (
    <div className="space-y-3">
      {winners.map((winner) => (
        <article key={winner.id} className="rounded-xl border border-[oklch(0.55_0.12_82/0.25)] p-3 text-sm space-y-1">
          <div className="flex justify-between gap-3">
            <span>{winner.draw_date}</span>
            <span className="text-gold-gradient font-display">@{winner.x_id_normalized}</span>
          </div>
          <Line label="当選枠" value={slotLabel(winner.slot)} />
          <Line label="種別" value={winner.kind === "w" ? "W当選" : "通常当選"} />
          <Line label="還元率" value={`${winner.redemption_rate}%`} />
          <Line label="抽選時点の報酬" value={`${winner.reward_inmu.toLocaleString()} INMU`} />
          {!compact && (
            <>
              <Line label="SOLアドレス" value={winner.sol_address || "-"} />
              <Line label="Discord ID" value={winner.discord_id || "-"} />
            </>
          )}
        </article>
      ))}
    </div>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  );
}

function formatWinner(winner: any) {
  if (!winner) return "該当なし";
  return `@${winner.x_id_normalized} / ${winner.kind === "w" ? "W当選" : "通常当選"} / ${winner.reward_inmu.toLocaleString()} INMU`;
}

function slotLabel(slot: string) {
  if (slot === "daily") return "毎日投稿枠";
  if (slot === "follow") return "公式Xフォロー枠";
  return "毎日投稿枠 + 公式Xフォロー枠";
}
