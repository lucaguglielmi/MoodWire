import { cookies } from "next/headers";

const COOKIE = "pinterest_access_token";

export async function getPinterestToken() {
  const envToken = process.env.PINTEREST_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;
  const store = await cookies();
  return store.get(COOKIE)?.value;
}

export async function setPinterestToken(token: string, maxAgeSeconds = 2592000) {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}
