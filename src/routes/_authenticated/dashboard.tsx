import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { BottomNav } from "@/components/BottomNav";
import { daysUntilNext810 } from "@/lib/date-jst";
import {
  checkTodayParticipation,
  confirmDailyParticipation,
  registerOfficialFollow,
} from "@/lib/participation.functions";

const OFFICIAL_X = "810Day_official";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "ダッシュボード | 810Day毎日くじ" },
      { name: "description", content: "毎日参加してポイントを貯めよう。810Dayカウントダウン付きダッシュボード。" },
    ],
  }),
  component: Dashboard,
});

function Card({ label, value, accent = false }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="card-luxe rounded-2xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl ${accent ? "text-gold-gradient" : ""}`}>{value}</div>
    </div>
  );
}

function Dashboard() {
  const { data: profile, isLoading } = useProfile();
  const checkFn = useServerFn(checkTodayParticipation);
  const participateFn = useServerFn(confirmDailyParticipation);
  const followFn = useServerFn(registerOfficialFollow);
  const qc = useQueryClient();
  const { data: todayStatus } = useQuery({
    queryKey: ["today-participation"],
    queryFn: () => checkFn(),
  });
  const [confirmMode, setConfirmMode] = useState<null | "daily" | "follow">(null);
  const [submitting, setSubmitting] = useState(false);
  const days = daysUntilNext810();

  if (isLoading || !profile) {
    return (
      <main className="min-h-screen bg-luxe flex items-center justify-center">
        <div className="text-muted-foreground">読み込み中...</div>
      </main>
    );
  }

  function openDailyPost() {
    const text = encodeURIComponent(
      `810Dayまであと${days}日！\n810Day毎日くじに参加します🎯\n#810Day毎日宝くじ`,
    );
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
      if (!res.ok) {
        toast.error("本日は既に参加済みです");
      } else {
        toast.success("参加を確定しました！");
      }
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
      if (!res.ok) toast.error("既に登録済みです");
      else toast.success("公式フォロー参加を登録しました！");
      qc.invalidateQueries({ queryKey: ["profile", "self"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "エラー");
    } finally {
      setSubmitting(false);
      setConfirmMode(null);
    }
  }

  const gaugePct = Math.round(((profile.confirm_gauge ?? 0) / 30) * 100);

  return (
    <main className="min-h-screen bg-luxe pb-28">
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
          <button
            onClick={openDailyPost}
            disabled={todayStatus?.participated}
            className="btn-gold w-full rounded-xl py-4 font-display text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {todayStatus?.participated ? "本日の投稿参加済み" : "① 毎日参加する"}
          </button>
          <button
            onClick={openOfficialX}
            disabled={profile.official_follow_registered}
            className="btn-crimson w-full rounded-xl py-4 font-display text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {profile.official_follow_registered
              ? "公式Xフォロー参加登録済み"
              : "② 公式Xをフォローして参加"}
          </button>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Card label="参加回数" value={`${profile.participation_count} 回`} />
          <Card label="当選回数" value={`${profile.win_count} 回`} />
          <Card label="還元率" value={`${profile.redemption_rate}%`} accent />
          <div className="card-luxe rounded-2xl p-4">
            <div className="text-xs text-muted-foreground">確定ゲージ</div>
            <div className="mt-1 font-display text-2xl text-gold-gradient">
              {profile.confirm_gauge}/30
            </div>
            <div className="mt-2 h-2 rounded-full bg-[oklch(0.09_0.01_40)] overflow-hidden border border-[oklch(0.55_0.12_82/0.25)]">
              <div
                className="h-full transition-all"
                style={{
                  width: `${gaugePct}%`,
                  background:
                    "linear-gradient(90deg, oklch(0.55 0.22 25) 0%, oklch(0.82 0.15 88) 100%)",
                }}
              />
            </div>
          </div>
        </section>
      </div>

      {confirmMode && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
          onClick={() => !submitting && setConfirmMode(null)}
        >
          <div
            className="card-luxe rounded-2xl p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-xl text-gold-gradient text-center">
              {confirmMode === "daily" ? "投稿は完了しましたか？" : "フォローは完了しましたか？"}
            </h2>
            <p className="text-sm text-muted-foreground text-center mt-2">
              {confirmMode === "daily"
                ? "投稿を確認してから参加を確定してください"
                : "フォローを確認してから登録してください"}
            </p>
            <div className="mt-6 space-y-2">
              <button
                onClick={confirmMode === "daily" ? confirmDaily : confirmFollow}
                disabled={submitting}
                className="btn-gold w-full rounded-lg py-3 font-semibold disabled:opacity-60"
              >
                {submitting ? "送信中..." : confirmMode === "daily" ? "参加を確定する" : "登録する"}
              </button>
              <button
                onClick={() => setConfirmMode(null)}
                disabled={submitting}
                className="w-full rounded-lg py-2.5 text-sm text-muted-foreground"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
