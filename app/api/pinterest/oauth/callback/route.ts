import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { setPinterestToken } from "@/lib/token";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const store = await cookies();
  const expectedState = store.get("pinterest_oauth_state")?.value;

  if (!code || !state || state !== expectedState) {
    return NextResponse.json({ error: "Invalid Pinterest OAuth callback/state." }, { status: 400 });
  }

  const clientId = process.env.PINTEREST_CLIENT_ID;
  const clientSecret = process.env.PINTEREST_CLIENT_SECRET;
  const redirectUri = process.env.PINTEREST_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Pinterest OAuth environment variables are incomplete." }, { status: 500 });
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  const response = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    return NextResponse.json({ error: "Pinterest token exchange failed", details: payload }, { status: response.status || 500 });
  }

  await setPinterestToken(payload.access_token, payload.expires_in ?? 2592000);
  store.delete("pinterest_oauth_state");
  return NextResponse.redirect(new URL("/?connected=1", request.url));
}
