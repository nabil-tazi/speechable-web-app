import { NextResponse } from "next/server";

export async function POST(request: Request) {
  console.log("[Gate API] Received verification request");

  try {
    const { password } = await request.json();
    console.log("[Gate API] Password received (length):", password?.length);

    const sitePassword = process.env.SITE_PASSWORD;
    const siteAccessToken = process.env.SITE_ACCESS_TOKEN;

    console.log("[Gate API] SITE_PASSWORD configured:", !!sitePassword);
    console.log("[Gate API] SITE_ACCESS_TOKEN configured:", !!siteAccessToken);

    if (!sitePassword || !siteAccessToken) {
      console.error("[Gate API] SITE_PASSWORD or SITE_ACCESS_TOKEN not configured");
      return NextResponse.json(
        { error: "Site access not configured" },
        { status: 500 }
      );
    }

    if (password !== sitePassword) {
      console.log("[Gate API] Password mismatch");
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    console.log("[Gate API] Password correct, setting cookie");

    // Set the access token cookie
    const response = NextResponse.json({ success: true });

    response.cookies.set("site_access_token", siteAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    console.log("[Gate API] Cookie set, returning success");
    return response;
  } catch (error) {
    console.error("[Gate API] Password verification error:", error);
    return NextResponse.json(
      { error: "An error occurred during verification" },
      { status: 500 }
    );
  }
}
