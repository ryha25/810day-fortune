// Asia/Tokyo date utilities
export function todayJst(): string {
  // returns YYYY-MM-DD in JST
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

export function daysUntilNext810(): number {
  const nowStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" });
  const now = new Date(nowStr);
  const y = now.getFullYear();
  let target = new Date(y, 7, 10); // Aug is month index 7
  const todayMidnight = new Date(y, now.getMonth(), now.getDate());
  if (todayMidnight.getTime() > target.getTime()) {
    target = new Date(y + 1, 7, 10);
  }
  const ms = target.getTime() - todayMidnight.getTime();
  const remainingDays = Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
  return remainingDays === 0 ? 0 : remainingDays + 1;
}

export function calcRedemptionRate(count: number): number {
  if (count <= 10) return 0;
  if (count >= 20) return 50;
  return (count - 10) * 5;
}

export function calcConfirmGauge(count: number): number {
  return Math.min(30, Math.floor(count * 0.5));
}
