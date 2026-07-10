import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { History, Share2, Sparkles, Trophy } from "lucide-react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { useProfile } from "@/hooks/useProfile";
import { daysUntilNext810 } from "@/lib/date-jst";
import { checkTodayParticipation, confirmDailyParticipation, registerOfficialFollow } from "@/lib/participation.functions";
import { getTodayDrawForMe, markDrawSeen } from "@/lib/draw.functions";

const OFFICIAL_X = "810Day_official";
const DISCORD_NOTE = "※Discord加入分は確認後反映します。";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "ダッシュボード | 810Day毎日くじ" },
      { name: "description", content: "毎日参加してポイントを貯める810Day毎日くじ。" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: profile, isLoading } = useProfile();
  const checkFn = useServerFn(checkTodayParticipation);
  const participateFn = useServerFn(confirmDailyParticipation);
  const followFn = useServerFn(registerOfficialFollow);
  const todayDrawFn = useServerFn(getTodayDrawForMe);
  const markSeenFn = useServerFn(markDrawSeen);
  const qc = useQueryClient();
  const [confirmMode, setConfirmMode] = useState<null | "daily" | "follow">(null);
  const [submitting, setSubmitting] = useState(false);
  const days = daysUntilNext810();

  const { data: todayStatus } = useQuery({
    queryKey: ["today-participation"],
    queryFn: () => checkFn(),
  });
  const { data: todayDraw } = useQuery({
    queryKey: ["today-draw-for-me"],
    queryFn: () => todayDrawFn(),
    refetchInterval: 60_000,
  });

  const myWin = todayDraw?.myWin;
  const shouldCelebrate = !!myWin && !todayDraw?.seen;

  useEffect(() => {
    if (!todayDraw?.draw?.id || !shouldCelebrate) return;
    const timer = window.setTimeout(() => {
      markSeenFn({ data: { draw_id: todayDraw.draw.id } }).then(() => {
        qc.invalidateQueries({ queryKey: ["today-draw-for-me"] });
      });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [markSeenFn, qc, shouldCelebrate, todayDraw?.draw?.id]);

  const winnersBySlot = useMemo(() => {
    const winners = todayDraw?.winners ?? [];
    const w = winners.find((winner: any) => winner.kind === "w");
    return {
      daily: w ?? winners.find((winner: any) => winner.slot === "daily"),
      follow: w ?? winners.find((winner: any) => winner.slot === "follow"),
    };
  }, [todayDraw?.winners]);

  if (isLoading || !profile) {
    return (
      <main className="min-h-screen bg-luxe flex items-center justify-center">
        <div className="text-muted-foreground">読み込み中...</div>
      </main>
    );
  }

  function openDailyPost() {
    const text = encodeURIComponent(`810Dayまであと${days}日\n810Day毎日くじに参加します\n#810Day毎日宝くじ`);
    window.open(`https://x.com/intent/post?text=${text}`, "_blank", "noopener,noreferrer");
    setConfirmMode("daily");
  }

  function openOfficialX() {
    window.open(`https://x.com/${OFFICIAL_X}`, "_blank", "noopener,noreferrer");
    setConfirmMode("follow");
  }

  async function confirmDaily() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await participateFn();
      toast[res.ok ? "success" : "error"](res.ok ? "参加を確定しました" : "本日は既に参加済みです");
      qc.invalidateQueries({ queryKey: ["today-participation"] });
      qc.invalidateQueries({ queryKey: ["profile", "self"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "エラー");
    } finally {
      setSubmitting(false);
      setConfirmMode(null);
    }
  }

  async function confirmFollow() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await followFn();
      toast[res.ok ? "success" : "error"](res.ok ? "公式Xフォロー参加を登録しました" : "既に登録済みです");
      qc.invalidateQueries({ queryKey: ["profile", "self"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "エラー");
    } finally {
      setSubmitting(false);
      setConfirmMode(null);
    }
  }

  function shareWin() {
    if (!myWin) return;
    const text =
      myWin.kind === "w"
        ? `810Day毎日くじでW当選しました🎯🎯\n当選報酬\n200000INMU\n${DISCORD_NOTE}\n#810Day毎日宝くじ`
        : `810Day毎日くじに当選しました🎯\n当選報酬\n${myWin.reward_inmu}INMU\n${DISCORD_NOTE}\n#810Day毎日宝くじ`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  const gaugePct = Math.round(((profile.confirm_gauge ?? 0) / 30) * 100);

  return (
    <main className="min-h-screen bg-luxe pb-28">
      {shouldCelebrate && <Celebration kind={myWin.kind} />}
      <div className="mx-auto max-w-md px-4 pt-8">
        <header className="text-center mb-6">
          <h1 className="font-display text-4xl text-gold-gradient">810Day毎日くじ</h1>
          <p className="mt-2 text-lg">
            <span className="text-muted-foreground">810Dayまであと</span>
            <span className="mx-1.5 font-display text-3xl text-gold-gradient">{days}</span>
            <span className="text-muted-foreground">日</span>
          </p>
        </header>

        <section className="space-y-3 mb-6">
          <button onClick={openDailyPost} disabled={todayStatus?.participated} className="btn-gold w-full rounded-xl py-4 font-display text-lg disabled:opacity-50">
            {todayStatus?.participated ? "本日の投稿参加済み" : "毎日参加する"}
          </button>
          <button onClick={openOfficialX} disabled={profile.official_follow_registered} className="btn-crimson w-full rounded-xl py-4 font-display text-lg disabled:opacity-50">
            {profile.official_follow_registered ? "公式Xフォロー参加登録済み" : "公式Xをフォローして参加"}
          </button>
        </section>

        <section className="grid grid-cols-2 gap-3 mb-6">
          <Card label="参加回数" value={`${profile.participation_count} 回`} />
          <Card label="当選回数" value={`${profile.win_count} 回`} />
          <Card label="還元率" value={`${profile.redemption_rate}%`} accent />
          <div className="card-luxe rounded-2xl p-4">
            <div className="text-xs text-muted-foreground">確定ゲージ</div>
            <div className="mt-1 font-display text-2xl text-gold-gradient">{profile.confirm_gauge}/30</div>
            <div className="mt-2 h-2 rounded-full bg-[oklch(0.09_0.01_40)] overflow-hidden border border-[oklch(0.55_0.12_82/0.25)]">
              <div className="h-full transition-all bg-[oklch(0.82_0.15_88)]" style={{ width: `${gaugePct}%` }} />
            </div>
          </div>
        </section>

        <section className="card-luxe rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-gold-gradient">本日の抽選結果</h2>
            <Link to="/history" className="inline-flex items-center gap-1 text-xs text-[oklch(0.82_0.15_88)]">
              <History className="h-4 w-4" /> 履歴
            </Link>
          </div>
          {!todayDraw?.draw ? (
            <p className="text-sm text-muted-foreground">本日の抽選はまだ実行されていません。</p>
          ) : (
            <>
              <ResultLine label="抽選日" value={todayDraw.draw.draw_date} />
              <ResultLine label="毎日投稿枠" value={formatWinner(winnersBySlot.daily)} />
              <ResultLine label="公式Xフォロー枠" value={formatWinner(winnersBySlot.follow)} />
              {myWin ? (
                <div className="rounded-xl border border-[oklch(0.82_0.15_88/0.45)] p-3">
                  <div className="font-display text-lg text-gold-gradient">{myWin.kind === "w" ? "W当選" : "通常当選"}</div>
                  <div className="text-sm mt-1">当選報酬 {myWin.reward_inmu.toLocaleString()} INMU</div>
                  <button onClick={shareWin} className="btn-gold mt-3 w-full rounded-lg py-2 text-sm font-semibold inline-flex items-center justify-center gap-2">
                    <Share2 className="h-4 w-4" /> Xでシェア
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">今回は未当選です。</p>
              )}
              <p className="text-xs text-muted-foreground">{DISCORD_NOTE}</p>
            </>
          )}
        </section>
      </div>

      {confirmMode && (
        <ConfirmDialog
          mode={confirmMode}
          submitting={submitting}
          onCancel={() => setConfirmMode(null)}
          onConfirm={confirmMode === "daily" ? confirmDaily : confirmFollow}
        />
      )}

      <BottomNav />
    </main>
  );
}

function Card({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="card-luxe rounded-2xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl ${accent ? "text-gold-gradient" : ""}`}>{value}</div>
    </div>
  );
}

function ResultLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function formatWinner(winner: any) {
  if (!winner) return "該当なし";
  return `@${winner.x_id_normalized} / ${winner.kind === "w" ? "W当選" : "通常当選"} / ${winner.reward_inmu.toLocaleString()} INMU`;
}

function Celebration({ kind }: { kind: string }) {
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-black/55">
      <div className={`card-luxe rounded-2xl p-8 mx-4 text-center ${kind === "w" ? "scale-110" : ""}`}>
        {kind === "w" ? <Sparkles className="h-12 w-12 mx-auto text-[oklch(0.82_0.15_88)]" /> : <Trophy className="h-12 w-12 mx-auto text-[oklch(0.82_0.15_88)]" />}
        <div className="font-display text-3xl text-gold-gradient mt-4">{kind === "w" ? "W当選" : "当選"}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  mode,
  submitting,
  onCancel,
  onConfirm,
}: {
  mode: "daily" | "follow";
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div role="dialog" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={() => !submitting && onCancel()}>
      <div className="card-luxe rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-gold-gradient text-center">{mode === "daily" ? "投稿は完了しましたか？" : "フォローは完了しましたか？"}</h2>
        <p className="text-sm text-muted-foreground text-center mt-2">確認後、参加を確定してください。</p>
        <div className="mt-6 space-y-2">
          <button onClick={onConfirm} disabled={submitting} className="btn-gold w-full rounded-lg py-3 font-semibold disabled:opacity-60">
            {submitting ? "送信中..." : "参加を確定する"}
          </button>
          <button onClick={onCancel} disabled={submitting} className="w-full rounded-lg py-2.5 text-sm text-muted-foreground">
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
