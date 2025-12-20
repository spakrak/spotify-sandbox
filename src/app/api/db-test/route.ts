import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const tracks = await prisma.track.count();
  const users = await prisma.user.count();
  return NextResponse.json({ ok: true, tracks, users });
}
