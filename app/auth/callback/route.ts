import { createClient } from "@/app/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  // if "next" is in param, use it as the redirect URL
  const next = searchParams.get("next") ?? "/";

  console.log("[auth/callback] Full URL:", request.url);
  console.log("[auth/callback] Origin:", origin);
  console.log("[auth/callback] Code present:", !!code);
  console.log("[auth/callback] Error param:", errorParam);
  console.log("[auth/callback] Error description:", errorDescription);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    console.log("[auth/callback] Exchange result - data:", data);
    console.log("[auth/callback] Exchange result - error:", error);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host"); // original origin before load balancer
      const isLocalEnv = process.env.NODE_ENV === "development";
      console.log("[auth/callback] Success! Redirecting. forwardedHost:", forwardedHost, "isLocalEnv:", isLocalEnv);
      if (isLocalEnv) {
        // we can be sure that there is no load balancer in between, so no need to watch for X-Forwarded-Host
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } else {
      console.log("[auth/callback] Exchange failed with error:", error.message);
    }
  } else {
    console.log("[auth/callback] No code received, redirecting to error page");
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
