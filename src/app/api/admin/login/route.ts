import { NextResponse } from "next/server";
import {
  createSessionToken,
  verifyAdminPassword,
  ADMIN_SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { password?: string };
  const password = String(body.password ?? "").trim();

  if (!password || !verifyAdminPassword(password)) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const token = await createSessionToken();
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return response;
}
