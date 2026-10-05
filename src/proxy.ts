import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { basicAuthAllows } from "@/lib/site-auth";

const REALM = "Time gap review";

/**
 * Shared HTTP Basic gate. No matcher: this runs for every path, including `/api` and static files.
 * `SITE_PASSWORD` is read per request. Leave it unset and the gate stays off.
 */
export function proxy(request: NextRequest) {
  if (basicAuthAllows(request.headers.get("authorization"))) {
    return NextResponse.next();
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}
