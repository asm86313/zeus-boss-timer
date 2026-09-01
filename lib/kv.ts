import { Redis } from "@upstash/redis";
import { DEFAULT_BOSS_DATA, normalizeBossData, type BossData, type StoredPushSubscription } from "./types";

// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the environment.
// Set these in Vercel project settings (the Upstash integration fills them in
// automatically if you add the Redis database through the Vercel Marketplace).
const redis = Redis.fromEnv();

const KEY_BOSS_DATA = "zeus:boss-data";
const KEY_SUBSCRIPTIONS = "zeus:subscriptions";
const KEY_NOTIFY_STATE = "zeus:notify-state";

export async function getBossData(): Promise<BossData> {
  const data = await redis.get<BossData>(KEY_BOSS_DATA);
  return data ? normalizeBossData(data) : DEFAULT_BOSS_DATA;
}

export async function setBossData(data: BossData): Promise<void> {
  await redis.set(KEY_BOSS_DATA, data);
}

export async function getSubscriptions(): Promise<StoredPushSubscription[]> {
  const subs = await redis.get<StoredPushSubscription[]>(KEY_SUBSCRIPTIONS);
  return subs ?? [];
}

export async function addSubscription(sub: StoredPushSubscription): Promise<void> {
  const subs = await getSubscriptions();
  const filtered = subs.filter((s) => s.endpoint !== sub.endpoint);
  filtered.push(sub);
  await redis.set(KEY_SUBSCRIPTIONS, filtered);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await getSubscriptions();
  await redis.set(
    KEY_SUBSCRIPTIONS,
    subs.filter((s) => s.endpoint !== endpoint)
  );
}

/** bossId -> ISO timestamp of the spawn occurrence we already alerted for */
export type NotifyState = Record<string, string>;

export async function getNotifyState(): Promise<NotifyState> {
  const state = await redis.get<NotifyState>(KEY_NOTIFY_STATE);
  return state ?? {};
}

export async function setNotifyState(state: NotifyState): Promise<void> {
  await redis.set(KEY_NOTIFY_STATE, state);
}
