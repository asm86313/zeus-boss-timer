import { NextResponse } from "next/server";
import { getBossData, setBossData } from "@/lib/kv";
import { normalizeBossData, type BossData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Upstash Redis DB is in Tokyo; icn1(서울)이 클라이언트(한국)에도 가깝고
// Redis와의 왕복도 짧아서 기본 리전(iad1, 미국 동부)보다 훨씬 빠르다.
export const preferredRegion = "icn1";

export async function GET() {
  const data = await getBossData();
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  let body: BossData;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !Array.isArray(body.bosses) || !body.settings) {
    return NextResponse.json({ error: "invalid boss data shape" }, { status: 400 });
  }

  await setBossData(normalizeBossData(body));
  return NextResponse.json({ ok: true });
}
