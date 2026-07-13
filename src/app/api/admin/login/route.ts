import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    const expectedUsername = process.env.ADMIN_USERNAME;
    const passwordHash = process.env.ADMIN_PASSWORD_HASH;
    // Fallback: plain-text password for local dev only (set ADMIN_PASSWORD in .env.local)
    const plainPassword = process.env.ADMIN_PASSWORD;

    const usernameMatch = expectedUsername && username === expectedUsername;
    let passwordMatch = false;

    if (passwordHash) {
      passwordMatch = await bcrypt.compare(password, passwordHash);
    } else if (plainPassword) {
      // Dev-only plain text fallback — never use in production
      passwordMatch = password === plainPassword;
    }

    if (!usernameMatch || !passwordMatch) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const token = await createSessionToken();
    const response = NextResponse.json({ success: true });

    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
