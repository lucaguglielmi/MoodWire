import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.PINTEREST_CLIENT_ID;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "Set PINTEREST_CLIENT_ID and PINTEREST_REDIRECT_URI first." }, { status: 500 });
  }

  const state = crypto.randomBytes(24).toString("hex");
  const store = await cookies();
  store.set("pinterest_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });

  const url = new URL("https://www.pinterest.com/oauth/");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "boards:read,pins:read");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
