import { NextResponse } from "next/server";
import { addSubscription } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  await addSubscription({
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    addedAt: new Date().toISOString(),
    label: body.label,
  });

  return NextResponse.json({ ok: true });
}
