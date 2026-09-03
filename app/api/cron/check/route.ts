import { NextResponse } from "next/server";
import webpush from "web-push";
import {
  getBossData,
  getSubscriptions,
  getNotifyState,
  setNotifyState,
  removeSubscription,
} from "@/lib/kv";
import { nextOccurrence, effectiveLeads, fmtAbs } from "@/lib/boss-logic";

// Every boss time in this app ("times": ["13:25"]) is a KST wall-clock
// time, entered/displayed in a browser that's always in Korea. But this
// route runs on Vercel's servers, whose local timezone is NOT Korea (UTC
// by default) — and boss-logic.ts builds occurrences with local-time
// Date getters/constructors, so without this it silently computes
// against the server's timezone instead of KST. Force it here, once, so
// the server agrees with the browser.
process.env.TZ = "Asia/Seoul";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "icn1";

// Called on a schedule (see an external scheduler like cron-job.org,
// since Vercel Hobby only allows daily native crons) to check every
// boss's next spawn and push a notification once each configured lead
// offset (e.g. 5분 전, 1분 전, 등장 시) enters its window. notifyState
// remembers, per boss+offset, the ISO timestamp of the occurrence
// already alerted for — so re-running within the same window, or after
// the offset already fired for this occurrence, is a no-op.

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

  try {
    return await runCheck();
  } catch (err: unknown) {
    // 이전에 이 라우트가 에러를 냈을 때 Vercel 로그엔 아무 상세 정보도 안
    // 남아서(경고 메시지 한 줄뿐) 원인 파악이 불가능했다. 무슨 단계에서
    // 왜 실패했는지 다음엔 바로 알 수 있도록 최대한 자세히 남긴다.
    const e = err as { message?: string; stack?: string; name?: string };
    console.error("[cron/check] unhandled failure:", {
      name: e?.name,
      message: e?.message,
      stack: e?.stack,
      raw: err,
    });
    return NextResponse.json({ error: "internal error", detail: e?.message ?? String(err) }, { status: 500 });
  }
}

async function runCheck() {
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
    if (boss.notifyEnabled === false) continue;
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
    // 설정해둔 lead(5, 3, ...)를 그대로 찍지 않고, 실제 발송 시점에 남은
    // 시간을 다시 계산해서 보여준다 — 외부 크론(cron-job.org)이 정확히
    // 매분 0초에 도는 게 아니라 1~2분 정도 밀릴 수 있어서, "5분 전"이라
    // 찍혀도 실제로는 3분밖에 안 남았을 수 있기 때문.
    const actualMinutesLeft = Math.round((item.next.getTime() - now.getTime()) / 60000);
    const label = actualMinutesLeft > 0 ? `${actualMinutesLeft}분 전` : "등장!";
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
          } else {
            // 죽은 구독이 아닌 다른 이유로 발송이 실패한 것 — 조용히
            // 삼키지 않고 남겨서, 발송 자체가 늦어지거나 실패하는 원인을
            // 나중에 로그로 추적할 수 있게 한다.
            console.error("[cron/check] webpush send failed:", {
              tag: item.tag,
              statusCode,
              message: (err as { message?: string })?.message,
              endpointTail: sub.endpoint.slice(-12),
            });
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
