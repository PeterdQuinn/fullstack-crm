import { NextRequest, NextResponse } from "next/server";

// Single-user HTTP Basic Auth for the CRM UI and its private API surface.
// Protected prefixes are defined in `config.matcher` below:
//   /crm, /api/admin, /api/crm, /api/email, /api/ai
// Intentionally NOT covered here:
//   /api/cron/*     -> protected by CRON_SECRET inside each route
//   /api/webhooks/* -> protected by provider signature (e.g. Svix) inside the route

// Constant-time comparison to avoid leaking match length via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function requireAuth(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Full Stack CRM", charset="UTF-8"',
    },
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Defensive: cron routes use CRON_SECRET and webhooks use signatures.
  // These are also excluded by the matcher, but guard here too.
  if (pathname.startsWith("/api/cron") || pathname.startsWith("/api/webhooks")) {
    return NextResponse.next();
  }

  const expectedUser = process.env.APP_USERNAME;
  const expectedPass = process.env.APP_PASSWORD;

  // Fail closed: if credentials are not configured, deny access.
  if (!expectedUser || !expectedPass) {
    return requireAuth();
  }

  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) {
    return requireAuth();
  }

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return requireAuth();
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) {
    return requireAuth();
  }

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  // Evaluate both comparisons without short-circuiting.
  const userOk = safeEqual(user, expectedUser);
  const passOk = safeEqual(pass, expectedPass);
  if (!userOk || !passOk) {
    return requireAuth();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/crm",
    "/crm/:path*",
    "/api/admin/:path*",
    "/api/crm/:path*",
    "/api/email/:path*",
    "/api/ai/:path*",
  ],
};
