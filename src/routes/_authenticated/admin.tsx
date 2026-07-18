import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Play, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import {
  adminCancelTestDraw,
  adminDeleteParticipant,
  adminGetPlannedDraw,
  adminListParticipants,
  adminListWinners,
  adminPlanTodayDraw,
  adminRunTestDraw,
  adminTodayEligible,
  adminUpdateLotterySettings,
  adminUpdateParticipantStats,
  getLotterySettings,
  listRecentDraws,
} from "@/lib/draw.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "管理 | 810Day毎日くじ" }, { name: "robots", content: "noindex" }] }),
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

type SortKey = "newest" | "participation" | "wins";

function AdminPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [todayOnly, setTodayOnly] = useState(false);
  const [followOnly, setFollowOnly] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [drawTime, setDrawTime] = useState("12:00");
  const [cutoffTime, setCutoffTime] = useState("11:59");
  const [normalReward, setNormalReward] = useState("10000");
  const [wReward, setWReward] = useState("200000");
  const [plannedDailyId, setPlannedDailyId] = useState("");
  const [plannedFollowId, setPlannedFollowId] = useState("");

  const { data: eligible, refetch: refetchEligible } = useQuery({
    queryKey: ["admin-eligible"],
    queryFn: () => adminTodayEligible(),
  });
  const { data: recent } = useQuery({
    queryKey: ["admin-recent-draws"],
    queryFn: () => listRecentDraws({ data: { limit: 100 } }),
  });
  const { data: winnerData } = useQuery({
    queryKey: ["admin-winners"],
    queryFn: () => adminListWinners(),
  });
  const { data: participantData, refetch: refetchParticipants } = useQuery({
    queryKey: ["admin-participants", q, sort, todayOnly, followOnly],
    queryFn: () => adminListParticipants({ data: { q, sort, todayOnly, followOnly } }),
  });
  const { data: lotterySettings } = useQuery({
    queryKey: ["lottery-settings"],
    queryFn: () => getLotterySettings(),
  });
  const { data: plannedDraw } = useQuery({
    queryKey: ["admin-planned-draw"],
    queryFn: () => adminGetPlannedDraw(),
  });

  useEffect(() => {
    if (!lotterySettings) return;
    setDrawTime((lotterySettings.draw_time_jst ?? "12:00").slice(0, 5));
    setCutoffTime((lotterySettings.participation_cutoff_time_jst ?? "11:59").slice(0, 5));
    setNormalReward(String(lotterySettings.normal_base_reward_inmu ?? 10000));
    setWReward(String(lotterySettings.w_reward_inmu ?? 200000));
  }, [lotterySettings]);

  useEffect(() => {
    const planned = plannedDraw?.planned as any;
    setPlannedDailyId(planned?.daily_winner_user_id ?? "");
    setPlannedFollowId(planned?.follow_winner_user_id ?? "");
  }, [plannedDraw?.planned]);

  const updateSettings = useMutation({
    mutationFn: () => {
      const normal = Number(normalReward);
      const w = Number(wReward);
      if (!Number.isInteger(normal) || normal < 0) throw new Error("通常当選の基本報酬は0以上の整数で入力してください");
      if (!Number.isInteger(w) || w < 0) throw new Error("W当選報酬は0以上の整数で入力してください");
      return adminUpdateLotterySettings({
        data: {
          draw_time_jst: drawTime,
          participation_cutoff_time_jst: cutoffTime,
          normal_base_reward_inmu: normal,
          w_reward_inmu: w,
        },
      });
    },
    onSuccess: () => {
      toast.success("抽選設定を保存しました");
      qc.invalidateQueries({ queryKey: ["lottery-settings"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "抽選設定の保存に失敗しました"),
  });

  const runTest = useMutation({
    mutationFn: () => adminRunTestDraw(),
    onSuccess: (res: any) => {
      if (res?.ok === false && res.reason === "no_candidates") toast.error("抽選対象者がいません。");
      else toast.success("テスト抽選を実行しました");
      refreshAdmin(qc);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "テスト抽選に失敗しました"),
  });

  const planDraw = useMutation({
    mutationFn: () =>
      adminPlanTodayDraw({
        data: {
          daily_user_id: plannedDailyId || null,
          follow_user_id: plannedFollowId || null,
        },
      }),
    onSuccess: (res: any) => {
      if (res?.ok === false && res.reason === "already_drawn") toast.error("本日の本番抽選はすでに確定済みです。");
      else if (res?.ok === false && res.reason === "daily_not_eligible") toast.error("毎日投稿枠の指定ユーザーが対象外です。");
      else if (res?.ok === false && res.reason === "follow_not_eligible") toast.error("公式フォロー枠の指定ユーザーが対象外です。");
      else toast.success("本日の当選予定を保存しました");
      refreshAdmin(qc);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "当選予定の保存に失敗しました"),
  });

  const cancelTest = useMutation({
    mutationFn: (drawId: string) => adminCancelTestDraw({ data: { draw_id: drawId } }),
    onSuccess: (res: any) => {
      if (res?.ok) toast.success("テスト結果を取り消しました");
      else toast.error("取り消しできませんでした");
      refreshAdmin(qc);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "取り消しに失敗しました"),
  });

  const winners = winnerData?.winners ?? [];
  const testWinners = winners.filter((winner: any) => winner.is_test);
  const productionWinners = winners.filter((winner: any) => !winner.is_test);

  const testDrawIds = useMemo(() => [...new Set(testWinners.map((winner: any) => winner.draw_id))], [testWinners]);

  function handleRunTestDraw() {
    if (!window.confirm("現在の抽選対象者でテスト抽選を実行します。ユーザーデータへテスト結果が反映されます。よろしいですか？")) return;
    runTest.mutate();
  }

  function handlePlanDraw() {
    if (!plannedDailyId && !plannedFollowId) {
      if (!window.confirm("当選者指定を空にして保存します。抽選時刻には通常のランダム抽選になります。よろしいですか？")) return;
    } else if (!window.confirm("本日の当選者を事前指定します。ユーザーには抽選時刻まで通常通り未発表に見えます。よろしいですか？")) {
      return;
    }
    planDraw.mutate();
  }

  return (
    <main className="min-h-screen bg-luxe pb-28">
      <div className="mx-auto max-w-md px-4 pt-8 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl text-gold-gradient">管理</h1>
          <button onClick={() => refetchEligible()} className="text-xs text-[oklch(0.82_0.15_88)]">
            更新
          </button>
        </div>

        <section className="card-luxe rounded-2xl p-5 space-y-3">
          <h2 className="font-display text-xl text-gold-gradient">抽選設定</h2>
          <p className="text-xs text-muted-foreground">時間はすべてJST基準です。</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">抽選時間</span>
              <input
                type="time"
                value={drawTime}
                onChange={(e) => setDrawTime(e.target.value)}
                className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">参加締切</span>
              <input
                type="time"
                value={cutoffTime}
                onChange={(e) => setCutoffTime(e.target.value)}
                className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">通常基本報酬</span>
              <input
                value={normalReward}
                onChange={(e) => setNormalReward(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">W当選報酬</span>
              <input
                value={wReward}
                onChange={(e) => setWReward(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            通常当選は「基本報酬 + 還元率」で計算、W当選は固定報酬です。
          </p>
          <button
            onClick={() => updateSettings.mutate()}
            disabled={updateSettings.isPending}
            className="btn-gold w-full rounded-lg py-3 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> 保存
          </button>
        </section>

        <section className="card-luxe rounded-2xl p-5">
          <h2 className="font-display text-xl text-gold-gradient mb-3">当日の抽選対象者</h2>
          <p className="text-xs text-muted-foreground mb-3">抽選日: {eligible?.date ?? "-"}</p>
          <EligibleList title="毎日投稿枠" rows={eligible?.daily ?? []} empty="毎日投稿枠：対象者なし" />
          <EligibleList title="公式Xフォロー枠" rows={eligible?.follow ?? []} empty="公式Xフォロー枠：対象者なし" />
        </section>

        <section className="card-luxe rounded-2xl p-5 space-y-3">
          <h2 className="font-display text-xl text-gold-gradient">本番抽選の事前指定</h2>
          <p className="text-xs text-muted-foreground">
            ここで選んだ当選者は保存だけされ、抽選時刻に通常の本番抽選結果として発表されます。
          </p>
          <label className="block text-sm">
            <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">毎日投稿枠</span>
            <select
              value={plannedDailyId}
              onChange={(e) => setPlannedDailyId(e.target.value)}
              className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
            >
              <option value="">指定なし</option>
              {(eligible?.daily ?? []).map((row: any) => (
                <option key={row.user_id} value={row.user_id}>
                  @{row.x_id_normalized}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">公式フォロー枠</span>
            <select
              value={plannedFollowId}
              onChange={(e) => setPlannedFollowId(e.target.value)}
              className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
            >
              <option value="">指定なし</option>
              {(eligible?.follow ?? []).map((row: any) => (
                <option key={row.id ?? row.user_id} value={row.id ?? row.user_id}>
                  @{row.x_id_normalized}
                </option>
              ))}
            </select>
          </label>
          {plannedDraw?.planned && (
            <p className="text-xs text-muted-foreground">
              保存済み: {new Date((plannedDraw.planned as any).updated_at).toLocaleString("ja-JP")}
            </p>
          )}
          <button
            onClick={handlePlanDraw}
            disabled={planDraw.isPending}
            className="btn-gold w-full rounded-lg py-3 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> 当選予定を保存
          </button>
        </section>

        <section className="card-luxe rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl text-gold-gradient">テスト抽選</h2>
            <button onClick={handleRunTestDraw} disabled={runTest.isPending} className="btn-gold rounded-lg px-3 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-60">
              <Play className="h-4 w-4" /> 実行
            </button>
          </div>
          <p className="text-xs text-muted-foreground">テスト抽選で作成したデータには is_test = true を保存します。</p>
          {testWinners.length > 0 ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">テスト抽選結果</h3>
              <WinnerRows winners={testWinners} compact />
              {testDrawIds.map((drawId) => (
                <button
                  key={drawId}
                  onClick={() => {
                    if (window.confirm("このテスト結果を取り消しますか？")) cancelTest.mutate(drawId);
                  }}
                  disabled={cancelTest.isPending}
                  className="w-full rounded-lg py-2 border border-[oklch(0.5_0.22_25/0.5)] text-[oklch(0.75_0.18_25)] inline-flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <RotateCcw className="h-4 w-4" /> テスト結果を取り消す
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">テスト抽選結果はありません。</p>
          )}
        </section>

        <section className="card-luxe rounded-2xl p-5 space-y-3">
          <h2 className="font-display text-xl text-gold-gradient">総参加ユーザーリスト</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="X ID検索"
            className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
          />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <SelectButton active={sort === "newest"} onClick={() => setSort("newest")}>新しい順</SelectButton>
            <SelectButton active={sort === "participation"} onClick={() => setSort("participation")}>参加回数順</SelectButton>
            <SelectButton active={sort === "wins"} onClick={() => setSort("wins")}>当選回数順</SelectButton>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} /> 本日参加済みのみ
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={followOnly} onChange={(e) => setFollowOnly(e.target.checked)} /> 公式Xフォロー登録済みのみ
          </label>
          <div className="space-y-3">
            {(participantData?.users ?? []).map((user: any) => (
              <ParticipantRow key={user.id} user={user} onEdit={() => setEditing(user)} />
            ))}
            {participantData && participantData.users.length === 0 && <p className="text-sm text-muted-foreground">該当ユーザーはいません。</p>}
          </div>
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
          <WinnerRows winners={productionWinners.filter((winner: any) => winner.kind === "w")} compact />
        </section>

        <section className="card-luxe rounded-2xl p-5">
          <h2 className="font-display text-xl text-gold-gradient mb-3">当選者一覧</h2>
          <WinnerRows winners={productionWinners} />
        </section>
      </div>

      {editing && <EditDialog user={editing} onClose={() => setEditing(null)} onSaved={() => refetchParticipants()} />}
      <BottomNav />
    </main>
  );
}

function refreshAdmin(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["admin-eligible"] });
  qc.invalidateQueries({ queryKey: ["admin-planned-draw"] });
  qc.invalidateQueries({ queryKey: ["admin-recent-draws"] });
  qc.invalidateQueries({ queryKey: ["admin-winners"] });
  qc.invalidateQueries({ queryKey: ["admin-participants"] });
  qc.invalidateQueries({ queryKey: ["profile", "self"] });
}

function EligibleList({ title, rows, empty }: { title: string; rows: any[]; empty: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.user_id ?? row.id} className="rounded-lg border border-[oklch(0.55_0.12_82/0.25)] px-3 py-2 text-xs">
            <div>@{row.x_id_normalized}</div>
            <div className="text-muted-foreground">
              ゲージ {row.confirm_gauge}/30 / 還元率 {row.redemption_rate}%
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

function ParticipantRow({ user, onEdit }: { user: any; onEdit: () => void }) {
  return (
    <article className="rounded-xl border border-[oklch(0.55_0.12_82/0.25)] p-3 text-sm space-y-1">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg text-gold-gradient">@{user.x_id_normalized}</div>
          <div className="text-xs text-muted-foreground">{user.participant_type === "existing" ? "既存参加者" : "新規参加者"}</div>
        </div>
        <button onClick={onEdit} className="text-xs text-[oklch(0.82_0.15_88)]">編集</button>
      </div>
      <Line label="参加回数" value={`${user.participation_count} 回`} />
      <Line label="当選回数" value={`${user.win_count} 回`} />
      <Line label="還元率" value={`${user.redemption_rate}%`} />
      <Line label="確定ゲージ" value={`${user.confirm_gauge}/30`} />
      <Line label="公式X" value={user.official_follow_registered ? "登録済み" : "未登録"} />
      <Line label="本日投稿" value={user.today_participated ? "参加済み" : "未参加"} />
      <Line label="SOL" value={user.sol_address || "-"} />
      <Line label="Discord" value={user.discord_id || "-"} />
      <Line label="登録日時" value={new Date(user.created_at).toLocaleString("ja-JP")} />
    </article>
  );
}

function EditDialog({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [participationCount, setParticipationCount] = useState(String(user.participation_count));
  const [winCount, setWinCount] = useState(String(user.win_count));
  const [redemptionRate, setRedemptionRate] = useState(String(user.redemption_rate));
  const [confirmGauge, setConfirmGauge] = useState(String(user.confirm_gauge));
  const [rateTouched, setRateTouched] = useState(false);
  const updateStats = useMutation({
    mutationFn: (payload: any) => adminUpdateParticipantStats({ data: payload }),
    onSuccess: () => {
      toast.success("保存しました");
      refreshAdmin(qc);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "保存に失敗しました"),
  });
  const deleteParticipant = useMutation({
    mutationFn: () => adminDeleteParticipant({ data: { user_id: user.id } }),
    onSuccess: (res: any) => {
      if (res?.ok) {
        toast.success(`@${res.deleted_x_id ?? user.x_id_normalized} を削除しました`);
        refreshAdmin(qc);
        onSaved();
        onClose();
        return;
      }
      if (res?.reason === "self_delete_blocked") return toast.error("ログイン中の管理者アカウントは削除できません");
      if (res?.reason === "admin_delete_blocked") return toast.error("管理者アカウントは削除できません");
      if (res?.reason === "not_found") return toast.error("対象ユーザーが見つかりません");
      toast.error("削除できませんでした");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "削除に失敗しました"),
  });

  function autoRate(nextParticipation: string) {
    setParticipationCount(nextParticipation);
    if (rateTouched) return;
    const count = Number(nextParticipation);
    if (!Number.isInteger(count) || count < 0) return;
    const rate = count <= 10 ? 0 : count >= 20 ? 50 : (count - 10) * 5;
    setRedemptionRate(String(rate));
  }

  function save() {
    const payload = {
      user_id: user.id,
      participation_count: Number(participationCount),
      win_count: Number(winCount),
      redemption_rate: Number(redemptionRate),
      confirm_gauge: Number(confirmGauge),
    };
    if (!Number.isInteger(payload.participation_count) || payload.participation_count < 0) return toast.error("参加回数は0以上の整数で入力してください");
    if (!Number.isInteger(payload.win_count) || payload.win_count < 0) return toast.error("当選回数は0以上の整数で入力してください");
    if (!Number.isInteger(payload.redemption_rate) || payload.redemption_rate < 0 || payload.redemption_rate > 50) return toast.error("還元率は0〜50で入力してください");
    if (!Number.isInteger(payload.confirm_gauge) || payload.confirm_gauge < 0 || payload.confirm_gauge > 30) return toast.error("確定ゲージは0〜30で入力してください");
    if (!window.confirm(`@${user.x_id_normalized}のデータを変更しますか？`)) return;
    updateStats.mutate(payload);
  }

  function remove() {
    if (!window.confirm(`@${user.x_id_normalized} を削除しますか？\nログイン情報、参加記録、当選者データも削除されます。`)) return;
    deleteParticipant.mutate();
  }

  return (
    <div role="dialog" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card-luxe rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-gold-gradient">@{user.x_id_normalized}</h2>
        <EditField label="参加回数" value={participationCount} onChange={autoRate} />
        <EditField label="当選回数" value={winCount} onChange={setWinCount} />
        <EditField label="還元率" value={redemptionRate} onChange={(v) => { setRateTouched(true); setRedemptionRate(v); }} />
        <EditField label="確定ゲージ" value={confirmGauge} onChange={setConfirmGauge} />
        <button onClick={save} disabled={updateStats.isPending} className="btn-gold w-full rounded-lg py-3 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          <Save className="h-4 w-4" /> 保存
        </button>
        <button
          onClick={remove}
          disabled={updateStats.isPending || deleteParticipant.isPending}
          className="w-full rounded-lg py-2.5 text-sm border border-red-500/40 text-red-300 disabled:opacity-60"
        >
          ユーザー削除
        </button>
        <button onClick={onClose} disabled={updateStats.isPending || deleteParticipant.isPending} className="w-full rounded-lg py-2.5 text-sm text-muted-foreground">キャンセル</button>
      </div>
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="block text-xs font-semibold mb-1.5 text-[oklch(0.82_0.15_88)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
        className="w-full rounded-lg bg-[oklch(0.09_0.01_40)] border border-[oklch(0.55_0.12_82/0.35)] px-3 py-2.5 outline-none"
      />
    </label>
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

function SelectButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-lg px-2 py-2 border ${active ? "btn-gold border-transparent" : "border-[oklch(0.55_0.12_82/0.25)] text-muted-foreground"}`}>
      {children}
    </button>
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
