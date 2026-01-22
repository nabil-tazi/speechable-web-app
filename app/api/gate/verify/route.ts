import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();

    const sitePassword = process.env.SITE_PASSWORD;
    const siteAccessToken = process.env.SITE_ACCESS_TOKEN;

    if (!sitePassword || !siteAccessToken) {
      console.error("SITE_PASSWORD or SITE_ACCESS_TOKEN not configured");
      return NextResponse.json(
        { error: "Site access not configured" },
        { status: 500 }
      );
    }

    if (password !== sitePassword) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    // Set the access token cookie
    const response = NextResponse.json({ success: true });

    response.cookies.set("site_access_token", siteAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Password verification error:", error);
    return NextResponse.json(
      { error: "An error occurred during verification" },
      { status: 500 }
    );
  }
}
