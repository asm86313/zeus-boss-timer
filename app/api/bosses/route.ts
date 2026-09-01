import { NextResponse } from "next/server";
import { getBossData, setBossData } from "@/lib/kv";
import { normalizeBossData, type BossData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
