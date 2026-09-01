import { NextResponse } from "next/server";
import webpush from "web-push";
import {
  getBossData,
  getSubscriptions,
  getNotifyState,
  setNotifyState,
  removeSubscription,
} from "@/lib/kv";
import { nextOccurrence, effectiveLeads, fmtAbs, fmtLead } from "@/lib/boss-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called on a schedule (see vercel.json) to check every boss's next spawn
// and push a notification once each configured lead offset (e.g. 5분 전,
// 1분 전, 등장 시) enters its window. notifyState remembers, per
// boss+offset, the ISO timestamp of the occurrence already alerted for —
// so re-running within the same window, or after the offset already
// fired for this occurrence, is a no-op.

function vapidReady() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT
  );
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!vapidReady()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const [data, subs, notifyState] = await Promise.all([
    getBossData(),
    getSubscriptions(),
    getNotifyState(),
  ]);

  const now = new Date();
  const nextState = { ...notifyState };
  const due: { name: string; memo?: string; next: Date; lead: number; tag: string }[] = [];

  // nextOccurrence(boss, X) only ever returns a time strictly after X, so
  // checking from `now` can never catch a lead of 0 ("등장 시") — the exact
  // spawn instant is always excluded by definition. Look slightly into the
  // past instead, wide enough to cover a couple of cron ticks, so a spawn
  // that just happened is still "the occurrence to evaluate" for one more run.
  const lookback = new Date(now.getTime() - 3 * 60_000);

  for (const boss of data.bosses) {
    const next = nextOccurrence(boss, lookback);
    if (!next) continue;
    const occKey = next.toISOString();
    for (const lead of effectiveLeads(boss, data.settings.defaultLeads)) {
      const triggerAt = next.getTime() - lead * 60000;
      const stateKey = `${boss.id}:${lead}`;
      if (now.getTime() >= triggerAt && nextState[stateKey] !== occKey) {
        due.push({ name: boss.name, memo: boss.memo, next, lead, tag: `${boss.id}:${lead}` });
        nextState[stateKey] = occKey;
      }
    }
  }

  // Drop stale entries so notifyState doesn't grow forever.
  const cutoff = now.getTime() - 2 * 24 * 3600_000;
  for (const key of Object.keys(nextState)) {
    const t = Date.parse(nextState[key]);
    if (!Number.isNaN(t) && t < cutoff) delete nextState[key];
  }

  if (!due.length || !subs.length) {
    if (Object.keys(nextState).length !== Object.keys(notifyState).length || due.length) {
      await setNotifyState(nextState);
    }
    return NextResponse.json({ checked: data.bosses.length, notified: due.length, subscribers: subs.length });
  }

  const deadEndpoints = new Set<string>();
  for (const item of due) {
    const label = fmtLead(item.lead);
    const payload = JSON.stringify({
      title: `⚔️ ${item.name} ${label}`,
      body: `${fmtAbs(item.next)} 젠 예정${item.memo ? " · " + item.memo : ""}`,
      tag: item.tag,
      url: "/",
    });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            deadEndpoints.add(sub.endpoint);
          }
        }
      })
    );
  }

  await setNotifyState(nextState);
  for (const endpoint of deadEndpoints) {
    await removeSubscription(endpoint);
  }

  return NextResponse.json({
    checked: data.bosses.length,
    notified: due.length,
    subscribers: subs.length,
    cleaned: deadEndpoints.size,
  });
}
