import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { getMyWinHistory, listRecentDraws } from "@/lib/draw.functions";

const DISCORD_NOTE = "※Discord加入分は確認後反映します。";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "抽選履歴 | 810Day毎日くじ" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { data: recent, isLoading } = useQuery({
    queryKey: ["recent-draws"],
    queryFn: () => listRecentDraws({ data: { limit: 50 } }),
  });
  const { data: mine } = useQuery({
    queryKey: ["my-win-history"],
    queryFn: () => getMyWinHistory(),
  });

  return (
    <main className="min-h-screen bg-luxe pb-28">
      <div className="mx-auto max-w-md px-4 pt-8">
        <h1 className="font-display text-3xl text-gold-gradient text-center mb-6">抽選履歴</h1>

        <section className="card-luxe rounded-2xl p-5 mb-5">
          <h2 className="font-display text-xl text-gold-gradient mb-3">自分の当選履歴</h2>
          <div className="space-y-3">
            {mine?.wins.map((win: any) => (
              <div key={`${win.draw_id}-${win.slot}`} className="rounded-xl border border-[oklch(0.55_0.12_82/0.25)] p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>{win.draw_date}</span>
                  <span className="text-gold-gradient font-display">{win.kind === "w" ? "W当選" : "通常当選"}</span>
                </div>
                <div className="text-muted-foreground mt-1">枠: {slotLabel(win.slot)}</div>
                <div className="mt-1">報酬: {win.reward_inmu.toLocaleString()} INMU</div>
              </div>
            ))}
            {mine && mine.wins.length === 0 && <p className="text-sm text-muted-foreground">当選履歴はまだありません。</p>}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-xl text-gold-gradient">全体履歴</h2>
          {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
          {recent?.draws.map((draw: any) => {
            const winners = (recent.winners ?? []).filter((winner: any) => winner.draw_id === draw.id);
            const w = winners.find((winner: any) => winner.kind === "w");
            const daily = w ?? winners.find((winner: any) => winner.slot === "daily");
            const follow = w ?? winners.find((winner: any) => winner.slot === "follow");
            return (
              <article key={draw.id} className="card-luxe rounded-2xl p-4 text-sm space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg">{draw.draw_date}</h3>
                  {w && <span className="text-gold-gradient font-display">W当選</span>}
                </div>
                <Line label="毎日投稿枠" value={formatWinner(daily)} />
                <Line label="公式Xフォロー枠" value={formatWinner(follow)} />
                <Line label="報酬" value={w ? "200,000 INMU" : winners.map((winner: any) => `${winner.reward_inmu.toLocaleString()} INMU`).join(" / ") || "-"} />
              </article>
            );
          })}
          {recent && recent.draws.length === 0 && <p className="text-sm text-muted-foreground">抽選履歴はまだありません。</p>}
          <p className="text-xs text-muted-foreground">{DISCORD_NOTE}</p>
        </section>
      </div>
      <BottomNav />
    </main>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function slotLabel(slot: string) {
  if (slot === "daily") return "毎日投稿枠";
  if (slot === "follow") return "公式Xフォロー枠";
  return "毎日投稿枠 + 公式Xフォロー枠";
}

function formatWinner(winner: any) {
  if (!winner) return "該当なし";
  return `@${winner.x_id_normalized} / ${winner.kind === "w" ? "W当選" : "通常当選"}`;
}
