import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const preferredRegion = "icn1";

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return NextResponse.json({ error: "VAPID_PUBLIC_KEY not configured" }, { status: 500 });
  }
  return NextResponse.json({ publicKey });
}
