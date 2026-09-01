import type { Boss } from "./types";

export const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function nextForFixed(boss: Boss, from: Date): Date | null {
  const candidates: number[] = [];
  for (let d = 0; d < 14; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    const dow = day.getDay();
    if (boss.days && boss.days.length && !boss.days.includes(dow)) continue;
    for (const t of boss.times || []) {
      const [hh, mm] = t.split(":").map(Number);
      const cand = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0);
      if (cand.getTime() > from.getTime()) candidates.push(cand.getTime());
    }
  }
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates));
}

function nextForInterval(boss: Boss, from: Date): Date | null {
  if (!boss.lastSpawnAt || !boss.intervalMinutes) return null;
  const intervalMs = boss.intervalMinutes * 60000;
  if (intervalMs <= 0) return null;
  let next = new Date(boss.lastSpawnAt).getTime() + intervalMs;
  const fromMs = from.getTime();
  if (next <= fromMs) {
    const steps = Math.floor((fromMs - next) / intervalMs) + 1;
    next += steps * intervalMs;
  }
  return new Date(next);
}

/** The single next spawn time strictly after `from`. */
export function nextOccurrence(boss: Boss, from: Date): Date | null {
  return boss.type === "interval" ? nextForInterval(boss, from) : nextForFixed(boss, from);
}

export type Urgency = "danger" | "warn" | "ok" | "none";

/** The configured alert offsets for a boss, e.g. [5, 1, 0] = 5분 전 / 1분 전 / 등장 시. */
export function effectiveLeads(boss: Boss, defaultLeads: number[]): number[] {
  return boss.leadMinutes && boss.leadMinutes.length ? boss.leadMinutes : defaultLeads;
}

export function urgencyOf(leads: number[], next: Date | null, now: Date): Urgency {
  if (!next || !leads.length) return "none";
  const left = next.getTime() - now.getTime();
  const sorted = [...leads].sort((a, b) => a - b);
  // 0(등장 시) alone shouldn't collapse the "about to happen" window to zero width.
  const soonest = Math.max(sorted[0], 1);
  const widest = Math.max(sorted[sorted.length - 1], soonest);
  if (left <= soonest * 60000) return "danger";
  if (left <= widest * 60000) return "warn";
  return "ok";
}

export function fmtLead(lead: number): string {
  return lead > 0 ? `${lead}분 전` : "등장 시";
}

export function fmtLeads(leads: number[]): string {
  return leads.map(fmtLead).join(" · ");
}

export function fmtCountdown(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hh = Math.floor((totalSec % 86400) / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return days > 0 ? `${days}일 ${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export function fmtAbs(d: Date | null): string {
  if (!d) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_LABELS[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function typeLabel(boss: Boss): string {
  if (boss.type === "interval") {
    return boss.intervalMinutes ? `${Math.round((boss.intervalMinutes / 60) * 10) / 10}시간 주기` : "주기";
  }
  const days = boss.days && boss.days.length ? [...boss.days].sort().map((d) => DAY_LABELS[d]).join("") : "매일";
  return `${days} 고정`;
}
