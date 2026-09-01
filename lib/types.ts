export type BossType = "fixed" | "interval";

export interface Boss {
  id: string;
  name: string;
  type: BossType;
  memo?: string;
  /**
   * minutes-before-spawn offsets to alert at, e.g. [5, 1, 0] = 5분 전 / 1분 전 / 등장 시.
   * null/undefined/empty = use settings.defaultLeads
   */
  leadMinutes?: number[] | null;

  // type === "fixed"
  /** "HH:MM" 24h, repeats daily unless `days` narrows it */
  times?: string[];
  /** 0=Sun..6=Sat; empty/omitted = every day */
  days?: number[];

  // type === "interval"
  /** minutes between spawns, counted from lastSpawnAt */
  intervalMinutes?: number;
  /** ISO timestamp of the last confirmed kill/spawn */
  lastSpawnAt?: string;
}

export interface Settings {
  /** minutes-before-spawn offsets used by bosses that don't override leadMinutes */
  defaultLeads: number[];
}

export interface BossData {
  settings: Settings;
  bosses: Boss[];
}

export const DEFAULT_BOSS_DATA: BossData = {
  settings: { defaultLeads: [5, 1, 0] },
  bosses: [],
};

export interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  addedAt: string;
  label?: string;
}

// --- migration helpers -----------------------------------------------
// Older stored data used a single `defaultLead: number` / `leadMinutes:
// number` instead of arrays. Normalize on read so old KV data (or a
// stale client payload) doesn't break new code.

function normalizeLeads(v: unknown): number[] | undefined {
  if (Array.isArray(v)) {
    const nums = v.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    return nums.length ? nums : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return [v];
  return undefined;
}

export function normalizeBossData(raw: unknown): BossData {
  const r = (raw ?? {}) as { settings?: Record<string, unknown>; bosses?: unknown[] };
  const rawSettings = r.settings ?? {};
  const defaultLeads = normalizeLeads(rawSettings.defaultLeads ?? rawSettings.defaultLead) ??
    DEFAULT_BOSS_DATA.settings.defaultLeads;

  const bosses = Array.isArray(r.bosses)
    ? r.bosses.map((b) => {
        const boss = b as Boss;
        return { ...boss, leadMinutes: normalizeLeads(boss.leadMinutes) ?? null };
      })
    : [];

  return { settings: { defaultLeads }, bosses };
}
