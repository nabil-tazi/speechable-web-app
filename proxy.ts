import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PASSWORD_GATE_COOKIE = "site_access_token";

function checkPasswordGate(request: NextRequest): NextResponse | null {
  const isPublic = process.env.IS_PUBLIC === "true";

  // If site is public, no gate needed
  if (isPublic) {
    return null;
  }

  const pathname = request.nextUrl.pathname;

  // Allow access to the password gate page and all API routes
  if (pathname === "/gate" || pathname.startsWith("/api/")) {
    return null;
  }

  // Check for valid access token
  const accessToken = request.cookies.get(PASSWORD_GATE_COOKIE)?.value;
  const expectedToken = process.env.SITE_ACCESS_TOKEN;

  if (!accessToken || accessToken !== expectedToken) {
    const gateUrl = new URL("/gate", request.url);
    gateUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(gateUrl);
  }

  return null;
}

export async function updateSession(request: NextRequest) {
  // Check password gate first (before any other auth)
  const gateResponse = checkPasswordGate(request);
  if (gateResponse) {
    return gateResponse;
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  // IMPORTANT: This refreshes the session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPaths = ["/library", "/profile", "/admin", "/settings"];
  const authPaths = ["/login", "/signup", "/auth"];
  const pathname = request.nextUrl.pathname;

  const isProtectedPath = protectedPaths.some((path) =>
    pathname.startsWith(path),
  );
  const isAuthPath = authPaths.some((path) => pathname.startsWith(path));

  if (isProtectedPath && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPath && user) {
    return NextResponse.redirect(new URL("/library", request.url));
  }

  // Redirect root path based on auth status
  if (pathname === "/") {
    if (user) {
      return NextResponse.redirect(new URL("/library", request.url));
    } else {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return supabaseResponse;
}

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2|woff|ttf|eot)$).*)",
  ],
};
