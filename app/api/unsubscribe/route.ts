import { NextResponse } from "next/server";
import { removeSubscription } from "@/lib/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  await removeSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
