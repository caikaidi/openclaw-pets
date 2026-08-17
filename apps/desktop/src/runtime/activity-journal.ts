import type { ActivityPage, ActivitySource } from "@openclaw-pets/protocol";

export function todayActivityWindow(now = new Date()): { startAt: string; endAt: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

const sourceLabels: Partial<Record<ActivitySource, string>> = {
  voice: "桌宠语音",
  text: "桌宠文字",
  desktop: "桌面端",
  import: "导入",
};

export function activitySourceLabel(source: ActivitySource): string {
  const builtInLabel = sourceLabels[source];
  if (builtInLabel) return builtInLabel;
  return source
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function activityGapMessage(
  page: Pick<ActivityPage, "observations"> & Partial<Pick<ActivityPage, "status" | "gaps">>,
): string {
  const gaps = page.gaps ?? [];
  if ((page.status ?? "ok") === "ok" && gaps.length === 0) return "";
  const reason = gaps.map((gap) => gap.reason).filter(Boolean).join("；");
  return `流水账暂时无法完整读取${reason ? `：${reason}` : ""}`;
}
